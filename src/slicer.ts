import ts, { isDeclarationStatement } from 'typescript';
import path from 'path';
import fs from 'fs';

/**
 * El "cerebro" de la herramienta.
 * Contiene el TypeChecker y los sets de seguimiento.
 */
class Slicer {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private requiredDeclarations = new Set<ts.Declaration>();
  private visitedSymbols = new Set<ts.Symbol>();

  constructor(projectRoot: string) {
    const configPath = ts.findConfigFile(
      projectRoot,
      ts.sys.fileExists,
      "tsconfig.json"
    );
    if (!configPath) {
      throw new Error("No se pudo encontrar 'tsconfig.json'");
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const configDir = path.dirname(configPath);

    // Parsear la configuración inicial
    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      configDir
    );

    // Verificar si el tsconfig tiene "references" (TypeScript Project References)
    let allFiles = parsedConfig.fileNames;
    let mergedOptions = parsedConfig.options;

    if (configFile.config.references && Array.isArray(configFile.config.references)) {
      console.log(`📚 Detectadas ${configFile.config.references.length} referencias de proyecto. Cargando...`);

      // Cargar cada referencia y combinar los archivos
      const referencedFiles: string[] = [];
      const referencedOptions: ts.CompilerOptions[] = [];

      for (const reference of configFile.config.references) {
        const refPath = path.resolve(configDir, reference.path);

        // Buscar el archivo tsconfig en la referencia
        let refConfigPath = refPath;
        if (!refConfigPath.endsWith('.json')) {
          refConfigPath = path.join(refPath, 'tsconfig.json');
        }

        if (ts.sys.fileExists(refConfigPath)) {
          console.log(`  ├─ Cargando: ${path.basename(refConfigPath)}`);

          const refConfigFile = ts.readConfigFile(refConfigPath, ts.sys.readFile);
          const refParsedConfig = ts.parseJsonConfigFileContent(
            refConfigFile.config,
            ts.sys,
            path.dirname(refConfigPath)
          );

          referencedFiles.push(...refParsedConfig.fileNames);
          referencedOptions.push(refParsedConfig.options);

          console.log(`  │  └─ ${refParsedConfig.fileNames.length} archivos encontrados`);
        }
      }

      // Combinar todos los archivos
      allFiles = [...parsedConfig.fileNames, ...referencedFiles];

      // Fusionar las opciones del compilador (prioridad a las opciones del proyecto raíz)
      if (referencedOptions.length > 0) {
        // Tomar la primera referencia como base y fusionar con las demás
        mergedOptions = { ...referencedOptions[0], ...parsedConfig.options };

        // Fusionar paths de todos los proyectos
        if (mergedOptions.paths) {
          for (const refOptions of referencedOptions.slice(1)) {
            if (refOptions.paths) {
              mergedOptions.paths = { ...refOptions.paths, ...mergedOptions.paths };
            }
          }
        }
      }

      console.log(`✅ Total: ${allFiles.length} archivos cargados desde todas las referencias\n`);
    }

    this.program = ts.createProgram(allFiles, mergedOptions);
    this.checker = this.program.getTypeChecker();
  }

  /**
   * Encuentra la declaración raíz basada en el nombre del símbolo en un archivo.
   * SOLO busca símbolos exportados o de nivel superior (no locales).
   */
  private findRootDeclaration(sourceFile: ts.SourceFile, symbolName: string): ts.Declaration | undefined {
    let rootDeclaration: ts.Declaration | undefined;

    const visitor = (node: ts.Node) => {
      // Solo procesar nodos de nivel superior (no dentro de funciones/clases)
      if (node.parent !== sourceFile && !ts.isSourceFile(node.parent)) {
        return; // No recorrer más profundo que el nivel superior
      }

      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach((declaration) => {
          if (declaration.name.getText() === symbolName) {
            rootDeclaration = declaration;
          }
        });
      } else if (
        (ts.isFunctionDeclaration(node) ||
         ts.isClassDeclaration(node) ||
         ts.isInterfaceDeclaration(node) ||
         ts.isTypeAliasDeclaration(node) ||
         ts.isEnumDeclaration(node)) &&
        node.name &&
        node.name.getText() === symbolName
      ) {
        rootDeclaration = node;
      }

      ts.forEachChild(node, visitor);
    };

    ts.forEachChild(sourceFile, visitor);
    return rootDeclaration;
  }

  /**
   * Comprueba si 'child' es un descendiente de 'ancestor' en el AST.
   * Se usa para determinar si un símbolo es una variable local.
   */
  private isAncestor(ancestor: ts.Node, child: ts.Node): boolean {
    // Protección adicional: si son el mismo nodo, no es un descendiente
    if (ancestor === child) {
      return true;
    }

    let current = child.parent;
    let depth = 0;
    const MAX_DEPTH = 100; // Protección contra bucles infinitos

    while (current && depth < MAX_DEPTH) {
      if (current === ancestor) {
        return true;
      }
      current = current.parent;
      depth++;
    }
    return false;
  }

  /**
   * Resuelve un identificador (uso de un símbolo) y, si es una dependencia válida,
   * la añade y sigue recursivamente sus dependencias.
   */
  private handleIdentifier(identifier: ts.Identifier, ancestor: ts.Declaration) {
    const symbol = this.checker.getSymbolAtLocation(identifier);
    if (!symbol) return;

    // Sigue los alias (como imports) hasta el símbolo original
    let aliasedSymbol = symbol;
    if (symbol.getFlags() & ts.SymbolFlags.Alias) {
      aliasedSymbol = this.checker.getAliasedSymbol(symbol);
    }

    // 1. Filtrar símbolos ya visitados (PRIMERO, antes de cualquier otra cosa)
    if (this.visitedSymbols.has(aliasedSymbol)) {
      return;
    }

    // Obtenemos todas las declaraciones (ej. interfaces fusionadas)
    const declarations = aliasedSymbol.getDeclarations();
    if (!declarations || declarations.length === 0) return;

    for (const declaration of declarations) {
      // 2. Filtrar variables locales (declaradas dentro del símbolo que estamos analizando)
      // IMPORTANTE: Comparar con el ancestor (la declaración que estamos analizando actualmente)
      if (this.isAncestor(ancestor, declaration)) {
        continue;
      }

      // 3. Filtrar bibliotecas (node_modules o lib.d.ts nativas)
      const sourceFile = declaration.getSourceFile();
      if (
        sourceFile.fileName.includes("node_modules") ||
        this.program.isSourceFileDefaultLibrary(sourceFile)
      ) {
        continue;
      }

      // 4. Para ciertos tipos de declaraciones, usar el contenedor completo
      let nodeToProcess: ts.Node = declaration;

      // Si es una PropertySignature, queremos toda la interface/type
      if (ts.isPropertySignature(declaration)) {
        const parent = declaration.parent;
        if (parent && (ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent))) {
          nodeToProcess = parent;
        }
      }

      // Si es una VariableDeclaration, queremos todo el VariableStatement
      if (ts.isVariableDeclaration(declaration)) {
        const parent = declaration.parent?.parent; // VariableDeclarationList -> VariableStatement
        if (parent && ts.isVariableStatement(parent)) {
          nodeToProcess = parent as any; // VariableStatement no es Declaration, pero lo procesaremos igual
        }
      }

      // ¡Es una dependencia válida! La procesamos.
      this.collectDependencies(nodeToProcess as ts.Declaration);
    }
  }

  /**
   * Proceso recursivo principal.
   * 1. Verifica si ya fue visitado (prevenir recursión infinita).
   * 2. Marca el símbolo como visitado.
   * 3. Añade la declaración actual.
   * 4. Recorre todos los nodos hijos, buscando identificadores.
   */
  private collectDependencies(declaration: ts.Declaration) {
    // Obtenemos el símbolo semántico de esta declaración
    // Usamos 'declaration.name' si existe, o la propia 'declaration' (ej. para 'export default')
    const symbolNode = isDeclarationStatement(declaration) && (declaration as any).name ? declaration.name : declaration;
    const symbol = this.checker.getSymbolAtLocation(symbolNode!);

    // CRÍTICO: Verificar PRIMERO si ya fue visitado, ANTES de hacer cualquier cosa
    if (symbol && this.visitedSymbols.has(symbol)) {
        return; // Ya procesado, evitar recursión infinita
    }

    // Marcar como visitado INMEDIATAMENTE después de la verificación
    if (symbol) {
        this.visitedSymbols.add(symbol);
    }

    // Añadir la declaración a los resultados
    this.requiredDeclarations.add(declaration);

    // Definimos un visitante para encontrar todos los identificadores *dentro* de esta declaración
    const visitor = (node: ts.Node) => {
      // Evitar procesar el nombre de la propia declaración
      if (ts.isIdentifier(node) && node !== symbolNode) {
        this.handleIdentifier(node, declaration);
      }
      ts.forEachChild(node, visitor);
    };

    // Iniciamos el recorrido
    ts.forEachChild(declaration, visitor);
  }

  /**
   * Punto de entrada público para ejecutar el slicer.
   */
  public slice(entryFilePath: string, symbolName: string): Map<string, ts.Declaration[]> {
    const entryFileAbs = path.resolve(entryFilePath);
    const sourceFile = this.program.getSourceFile(entryFileAbs);

    if (!sourceFile) {
      throw new Error(`Archivo no encontrado en el programa: ${entryFilePath}`);
    }

    const rootDeclaration = this.findRootDeclaration(sourceFile, symbolName);
    if (!rootDeclaration) {
      throw new Error(`Símbolo '${symbolName}' no encontrado en ${entryFilePath}`);
    }

    // Iniciar el proceso recursivo
    this.collectDependencies(rootDeclaration);

    // Agrupar los resultados por archivo
    const nodesByFile = new Map<string, ts.Declaration[]>();
    for (const node of this.requiredDeclarations) {
      const fileName = node.getSourceFile().fileName;
      if (!nodesByFile.has(fileName)) {
        nodesByFile.set(fileName, []);
      }
      nodesByFile.get(fileName)!.push(node);
    }

    // Ordenar los nodos dentro de cada archivo por su posición de inicio
    for (const [fileName, nodes] of nodesByFile.entries()) {
        nodes.sort((a, b) => a.getStart() - b.getStart());
    }

    return nodesByFile;
  }
}

// --- Ejecución del CLI ---

function printHelp() {
    console.log("Uso: ts-node slicer.ts <projectRoot> <entryFile> <symbolName>");
    console.log("\nArgumentos:");
    console.log("  <projectRoot>  Ruta al directorio que contiene el tsconfig.json del proyecto.");
    console.log("  <entryFile>    Ruta al archivo que contiene el símbolo de inicio.");
    console.log("  <symbolName>   Nombre del símbolo (función, clase, etc.) a extraer.");
    console.log("\nEjemplo (usando el script 'start' de package.json):");
    console.log("  npm start");
}


function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    printHelp();
    process.exit(1);
  }

  const [projectRoot, entryFile, symbolName] = args;

  try {
    const slicer = new Slicer(projectRoot);
    const result = slicer.slice(entryFile, symbolName);

    console.log(`--- Slicing completo para el símbolo: ${symbolName} ---\n`);

    for (const [fileName, nodes] of result.entries()) {
      const relativePath = path.relative(process.cwd(), fileName);
      console.log(`//==================================================`);
      console.log(`// Archivo: ${relativePath}`);
      console.log(`//==================================================\n`);
      
      for (const node of nodes) {
        console.log(node.getText());
        console.log("\n//--------------------------------------------------\n");
      }
    }
  } catch (error) {
    console.error("Error durante el slicing:", error);
    process.exit(1);
  }
}

main();
