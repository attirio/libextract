import ts, { isDeclarationStatement } from 'typescript';
import path from 'path';
import fs from 'fs';
import { Command } from 'commander';
import { ImportGenerator, ExternalDependency } from './utils/importGenerator';
import { ProjectDetector, ProjectContext } from './utils/projectDetector';
import { ManifestGenerator } from './utils/manifestGenerator';

/**
 * El "cerebro" de la herramienta.
 * Contiene el TypeChecker y los sets de seguimiento.
 */
class Slicer {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private requiredDeclarations = new Set<ts.Declaration>();
  private visitedSymbols = new Set<ts.Symbol>();
  private projectContext: ProjectContext;
  private manifestGenerator: ManifestGenerator;

  constructor(projectRoot: string) {
    // Detectar ambiente del proyecto
    const detector = new ProjectDetector(projectRoot);
    this.projectContext = detector.detect();

    console.log(`📋 Ambiente: ${this.projectContext.environment} | Package manager: ${this.projectContext.packageManager}`);
    if (this.projectContext.dependencies.size > 0) {
      console.log(`📦 Dependencias originales: ${this.projectContext.dependencies.size}`);
    }
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

    // Inicializar ManifestGenerator
    this.manifestGenerator = new ManifestGenerator(this.projectContext);
  }

  /**
   * Obtiene el program de TypeScript (útil para análisis externos)
   */
  public getProgram(): ts.Program {
    return this.program;
  }

  /**
   * Obtiene el contexto del proyecto
   */
  public getProjectContext(): ProjectContext {
    return this.projectContext;
  }

  /**
   * Obtiene el generador de manifiestos
   */
  public getManifestGenerator(): ManifestGenerator {
    return this.manifestGenerator;
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

    // Filtrar parámetros de tipo genérico (TypeParameter)
    // Estos son símbolos locales a la declaración, no dependencias externas
    if (symbol.getFlags() & ts.SymbolFlags.TypeParameter) {
      return;
    }

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

      // Si es una PropertySignature (interface/type), queremos toda la interface/type
      if (ts.isPropertySignature(declaration)) {
        const parent = declaration.parent;
        if (parent && (ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent))) {
          nodeToProcess = parent;
        }
      }

      // Si es una PropertyDeclaration (class), queremos toda la clase
      if (ts.isPropertyDeclaration(declaration)) {
        const parent = declaration.parent;
        if (parent && ts.isClassDeclaration(parent)) {
          nodeToProcess = parent;
        }
      }

      // Si es un MethodDeclaration (método de clase), queremos toda la clase
      if (ts.isMethodDeclaration(declaration)) {
        const parent = declaration.parent;
        if (parent && ts.isClassDeclaration(parent)) {
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
        // Filtrar identificadores que son parte de la declaración misma, no referencias externas
        const parent = node.parent;

        // 1. Evitar nombres de parámetros de tipo genérico (TypeParameter)
        if (parent && ts.isTypeParameterDeclaration(parent) && parent.name === node) {
          ts.forEachChild(node, visitor);
          return;
        }

        // 2. Evitar nombres de propiedades de clase/interface
        if (parent && (ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) {
          ts.forEachChild(node, visitor);
          return;
        }

        // 3. Evitar nombres de métodos
        if (parent && (ts.isMethodDeclaration(parent) || ts.isMethodSignature(parent)) && parent.name === node) {
          ts.forEachChild(node, visitor);
          return;
        }

        // 4. Evitar nombres de parámetros de función/método/constructor
        if (parent && ts.isParameter(parent) && parent.name === node) {
          ts.forEachChild(node, visitor);
          return;
        }

        // 5. Evitar nombres de variables locales (BindingElement en destructuring)
        if (parent && ts.isBindingElement(parent) && parent.name === node) {
          ts.forEachChild(node, visitor);
          return;
        }

        // 6. Evitar nombres en VariableDeclaration
        if (parent && ts.isVariableDeclaration(parent) && parent.name === node) {
          ts.forEachChild(node, visitor);
          return;
        }

        // Este es un identificador que referencia algo externo
        this.handleIdentifier(node, declaration);
      }
      ts.forEachChild(node, visitor);
    };

    // Iniciamos el recorrido
    ts.forEachChild(declaration, visitor);
  }

  /**
   * Punto de entrada público para ejecutar el slicer.
   * Acepta múltiples archivos y símbolos.
   */
  public slice(entryFiles: string[], symbolNames: string[]): Map<string, ts.Declaration[]> {
    // Validar que tengamos archivos y símbolos
    if (entryFiles.length === 0) {
      throw new Error('Debe proporcionar al menos un archivo de entrada');
    }
    if (symbolNames.length === 0) {
      throw new Error('Debe proporcionar al menos un símbolo');
    }

    // Si solo hay un archivo, usarlo para todos los símbolos
    // Si hay múltiples archivos, debe haber el mismo número de símbolos o uno solo
    let filesToProcess: Array<{ file: string; symbol: string }> = [];

    if (entryFiles.length === 1) {
      // Un archivo, múltiples símbolos
      for (const symbolName of symbolNames) {
        filesToProcess.push({ file: entryFiles[0], symbol: symbolName });
      }
    } else if (symbolNames.length === 1) {
      // Múltiples archivos, un símbolo
      for (const file of entryFiles) {
        filesToProcess.push({ file, symbol: symbolNames[0] });
      }
    } else if (entryFiles.length === symbolNames.length) {
      // Mismo número de archivos y símbolos (pares)
      for (let i = 0; i < entryFiles.length; i++) {
        filesToProcess.push({ file: entryFiles[i], symbol: symbolNames[i] });
      }
    } else {
      throw new Error(`Número inconsistente de archivos (${entryFiles.length}) y símbolos (${symbolNames.length}). Debe ser 1:N, N:1 o N:N`);
    }

    // Procesar cada par archivo-símbolo
    for (const { file, symbol } of filesToProcess) {
      const entryFileAbs = path.resolve(file);
      const sourceFile = this.program.getSourceFile(entryFileAbs);

      if (!sourceFile) {
        throw new Error(`Archivo no encontrado en el programa: ${file}`);
      }

      const rootDeclaration = this.findRootDeclaration(sourceFile, symbol);
      if (!rootDeclaration) {
        throw new Error(`Símbolo '${symbol}' no encontrado en ${file}`);
      }

      // Iniciar el proceso recursivo para este símbolo
      this.collectDependencies(rootDeclaration);
    }

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

// --- Funciones auxiliares ---

/**
 * Extrae todos los símbolos exportados de un archivo.
 */
function extractExportedSymbols(sourceFile: ts.SourceFile): string[] {
  const exportedSymbols: string[] = [];

  ts.forEachChild(sourceFile, (node) => {
    // Export named declarations (export function, export class, etc.)
    if (ts.isExportAssignment(node)) {
      // export default ...
      exportedSymbols.push('default');
    } else if (ts.canHaveModifiers(node)) {
      const modifiers = ts.getModifiers(node);
      if (modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        // Es una declaración exportada
        let name: string | undefined;

        if (ts.isFunctionDeclaration(node) && node.name) {
          name = node.name.text;
        } else if (ts.isClassDeclaration(node) && node.name) {
          name = node.name.text;
        } else if (ts.isVariableStatement(node)) {
          // export const foo = ...
          node.declarationList.declarations.forEach(decl => {
            if (ts.isIdentifier(decl.name)) {
              exportedSymbols.push(decl.name.text);
            }
          });
        } else if (ts.isInterfaceDeclaration(node)) {
          name = node.name.text;
        } else if (ts.isTypeAliasDeclaration(node)) {
          name = node.name.text;
        } else if (ts.isEnumDeclaration(node)) {
          name = node.name.text;
        }

        if (name) {
          exportedSymbols.push(name);
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      // export { foo, bar }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach(element => {
          exportedSymbols.push(element.name.text);
        });
      }
    }
  });

  return exportedSymbols;
}

// --- Ejecución del CLI ---

/**
 * Extrae los imports necesarios de un archivo basándose en el análisis de símbolos realmente usados.
 */
function extractImports(
  program: ts.Program,
  projectContext: ProjectContext,
  sourceFile: ts.SourceFile,
  extractedNodes: ts.Declaration[],
  allExtractedFiles: Set<string>,
  projectRoot: string,
  outputDir: string
): {
  imports: string[];
  missingIdentifiers: Set<string>;
  externalDeps: Map<string, ExternalDependency>;
} {
  const generator = new ImportGenerator();

  // Configurar el contexto y el program
  generator.setProjectContext(projectContext);
  generator.setProgram(program);

  // Generar imports necesarios basados en uso real
  const { imports, externalDeps } = generator.generateImports(
    sourceFile,
    extractedNodes,
    allExtractedFiles,
    projectRoot,
    outputDir
  );

  // Detectar identificadores usados sin import (funciones del mismo archivo)
  const missingIdentifiers = generator.findMissingImports(sourceFile, extractedNodes);

  return { imports, missingIdentifiers, externalDeps };
}


/**
 * Escribe el resultado del slicing a archivos en el directorio de salida,
 * respetando la estructura de directorios del proyecto original.
 */
function writeToOutputDirectory(
  program: ts.Program,
  projectContext: ProjectContext,
  manifestGenerator: ManifestGenerator,
  result: Map<string, ts.Declaration[]>,
  outputDir: string,
  projectRoot: string
) {
  const absoluteProjectRoot = path.resolve(projectRoot);
  const absoluteOutputDir = path.resolve(outputDir);

  console.log(`\n📁 Escribiendo archivos a: ${outputDir}\n`);

  // Obtener set de todos los archivos extraídos (normalizados a rutas absolutas)
  const allExtractedFiles = new Set<string>();
  for (const fileName of result.keys()) {
    const absolutePath = path.isAbsolute(fileName) ? fileName : path.resolve(fileName);
    allExtractedFiles.add(absolutePath);
  }

  // Acumular todas las dependencias externas
  const allExternalDeps = new Map<string, ExternalDependency>();

  for (const [fileName, nodes] of result.entries()) {
    // Calcular la ruta relativa desde el proyecto raíz
    const relativeFromRoot = path.relative(absoluteProjectRoot, fileName);

    // Construir la ruta de salida manteniendo la estructura
    const outputFilePath = path.join(absoluteOutputDir, relativeFromRoot);

    // Crear los directorios necesarios
    const outputFileDir = path.dirname(outputFilePath);
    if (!fs.existsSync(outputFileDir)) {
      fs.mkdirSync(outputFileDir, { recursive: true });
    }

    // Ordenar nodos por posición para mantener el orden original
    const sortedNodes = [...nodes].sort((a, b) => a.getStart() - b.getStart());

    // Obtener el sourceFile para extraer imports
    const sourceFile = sortedNodes[0].getSourceFile();

    // Extraer imports necesarios basados en análisis real de uso
    const { imports, missingIdentifiers, externalDeps } = extractImports(
      program,
      projectContext,
      sourceFile,
      sortedNodes,
      allExtractedFiles,
      projectRoot,
      outputDir
    );

    // Acumular dependencias externas
    for (const [pkg, dep] of externalDeps.entries()) {
      if (!allExternalDeps.has(pkg)) {
        allExternalDeps.set(pkg, dep);
      } else {
        // Merge símbolos
        const existing = allExternalDeps.get(pkg)!;
        dep.importedSymbols.forEach(s => existing.importedSymbols.add(s));
        dep.importKinds.forEach(k => existing.importKinds.add(k));
      }
    }

    // Reportar identificadores sin import (probablemente funciones del mismo archivo)
    if (missingIdentifiers.size > 0) {
      console.log(`  ⚠️  Identificadores usados sin import en ${path.basename(fileName)}: ${Array.from(missingIdentifiers).join(', ')}`);
    }

    // Construir el contenido del archivo
    let fileContent = '';

    // Agregar imports primero
    if (imports.length > 0) {
      fileContent += imports.join('\n') + '\n\n';
    }

    // Agregar declaraciones
    for (const node of sortedNodes) {
      fileContent += node.getText() + '\n\n';
    }

    // Escribir el archivo
    fs.writeFileSync(outputFilePath, fileContent, 'utf-8');

    const relativeOutput = path.relative(process.cwd(), outputFilePath);
    console.log(`  ✅ ${relativeOutput} (${nodes.length} símbolos${imports.length > 0 ? `, ${imports.length} imports` : ''})`);
  }

  console.log(`\n✨ Completado. ${result.size} archivos escritos.`);

  // Generar manifiestos
  manifestGenerator.generateManifest(allExternalDeps, absoluteOutputDir);
  manifestGenerator.generateDependencyReport(allExternalDeps, absoluteOutputDir);
}

/**
 * Imprime el resultado del slicing a stdout.
 */
function printToStdout(result: Map<string, ts.Declaration[]>, symbolName: string) {
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
}

function main() {
  const program = new Command();

  program
    .name('slicer')
    .description('Herramienta CLI para extraer símbolos y todas sus dependencias de un proyecto TypeScript')
    .version('1.0.0')
    .requiredOption('-p, --path <projectPath>', 'Ruta al directorio que contiene el tsconfig.json del proyecto')
    .option('-o, --output <outputDir>', 'Carpeta donde copiar el código resultante (respeta estructura de directorios)')
    .addHelpText('after', `
Uso especial de -f y -s:
  Cada -f va seguido de -s con los símbolos que pertenecen a ese archivo.
  Los símbolos después de -s son todos los que siguen hasta el próximo flag.

Ejemplos:
  # Un archivo, un símbolo
  $ ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction

  # Un archivo, múltiples símbolos
  $ ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction classX classY

  # Múltiples archivos con sus símbolos
  $ ts-node src/slicer.ts -p ./project -f ./src/file1.ts -s symbol1 symbol2 -f ./src/file2.ts -s symbol3

  # Usando wildcards en símbolos
  $ ts-node src/slicer.ts -p ./project -f ./src/main.ts -s feature* create*

  # Extraer TODOS los símbolos exportados de un archivo
  $ ts-node src/slicer.ts -p ./project -f ./src/main.ts -s *

  # Con directorio de salida
  $ ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction -o ./output
    `)
    .allowUnknownOption()
    .allowExcessArguments();

  program.parse();

  const options = program.opts();
  const { path: projectRoot, output: outputDir } = options;

  // Parser personalizado para -f y -s
  const args = process.argv.slice(2);
  const fileSymbolPairs: Array<{ file: string; symbols: string[] }> = [];

  let currentFile: string | null = null;
  let i = 0;

  while (i < args.length) {
    if (args[i] === '-f' || args[i] === '--file') {
      // Guardar el archivo anterior si existe sin símbolos
      if (currentFile) {
        throw new Error(`El archivo ${currentFile} no tiene símbolos asociados (-s)`);
      }

      i++;
      if (i >= args.length || args[i].startsWith('-')) {
        throw new Error('Se esperaba un archivo después de -f');
      }
      currentFile = args[i];
      i++;
    } else if (args[i] === '-s' || args[i] === '--symbol') {
      if (!currentFile) {
        throw new Error('Debe especificar -f antes de -s');
      }

      // Recoger todos los símbolos hasta el siguiente flag
      i++;
      const symbols: string[] = [];
      while (i < args.length && !args[i].startsWith('-')) {
        symbols.push(args[i]);
        i++;
      }

      if (symbols.length === 0) {
        throw new Error('Se esperaba al menos un símbolo después de -s');
      }

      fileSymbolPairs.push({ file: currentFile, symbols });
      currentFile = null;
    } else {
      i++;
    }
  }

  // Si quedó un archivo sin símbolos al final
  if (currentFile) {
    throw new Error(`El archivo ${currentFile} no tiene símbolos asociados (-s)`);
  }

  if (fileSymbolPairs.length === 0) {
    console.error('Error: Debe especificar al menos un par -f <archivo> -s <símbolos>');
    program.help();
  }

  // Validar que tenemos projectRoot
  if (!projectRoot) {
    console.error('Error: Debe especificar -p <projectPath>');
    program.help();
  }

  try {
    const slicer = new Slicer(projectRoot);

    // Expandir wildcards en símbolos
    const expandedPairs: Array<{ file: string; symbol: string }> = [];

    for (const pair of fileSymbolPairs) {
      const { file, symbols } = pair;
      const absoluteFilePath = path.resolve(file);

      // Obtener el source file para encontrar símbolos
      const sourceFile = slicer.getProgram().getSourceFile(absoluteFilePath);
      if (!sourceFile) {
        throw new Error(`No se pudo encontrar el archivo: ${file}`);
      }

      for (const symbolPattern of symbols) {
        if (symbolPattern === '*') {
          // Extraer TODOS los símbolos exportados
          const exportedSymbols = extractExportedSymbols(sourceFile);
          for (const exportedSymbol of exportedSymbols) {
            expandedPairs.push({ file, symbol: exportedSymbol });
          }
        } else if (symbolPattern.includes('*')) {
          // Wildcard pattern (ej: feature*, *Manager)
          const exportedSymbols = extractExportedSymbols(sourceFile);
          const regex = new RegExp('^' + symbolPattern.replace(/\*/g, '.*') + '$');
          const matchedSymbols = exportedSymbols.filter(sym => regex.test(sym));

          if (matchedSymbols.length === 0) {
            console.warn(`⚠️  No se encontraron símbolos que coincidan con el patrón "${symbolPattern}" en ${path.basename(file)}`);
          }

          for (const matchedSymbol of matchedSymbols) {
            expandedPairs.push({ file, symbol: matchedSymbol });
          }
        } else {
          // Símbolo exacto
          expandedPairs.push({ file, symbol: symbolPattern });
        }
      }
    }

    if (expandedPairs.length === 0) {
      throw new Error('No se encontraron símbolos para extraer');
    }

    // Convertir a formato que espera slice()
    const filesArray = expandedPairs.map(p => p.file);
    const symbolsArray = expandedPairs.map(p => p.symbol);

    const result = slicer.slice(filesArray, symbolsArray);

    if (outputDir) {
      // Modo: escribir a directorio de salida
      writeToOutputDirectory(
        slicer.getProgram(),
        slicer.getProjectContext(),
        slicer.getManifestGenerator(),
        result,
        outputDir,
        projectRoot
      );
    } else {
      // Modo: imprimir a stdout
      printToStdout(result, symbolsArray.join(', '));
    }
  } catch (error) {
    console.error("Error durante el slicing:", error);
    process.exit(1);
  }
}

main();
