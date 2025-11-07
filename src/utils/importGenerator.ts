import * as ts from 'typescript';
import * as path from 'path';
import { IdentifierAnalyzer } from './identifierAnalyzer';
import { ImportResolver, ImportInfo, ImportKind } from './importResolver';
import { ReexportResolver } from './reexportResolver';
import { ProjectContext } from './projectDetector';

/**
 * Información sobre una dependencia externa
 */
export interface ExternalDependency {
  packageName: string;
  version: string | null;
  importedSymbols: Set<string>;
  importKinds: Set<ImportKind>;
  isDevDependency: boolean;
}

/**
 * Genera los imports necesarios para un conjunto de nodos extraídos
 */
export class ImportGenerator {
  private identifierAnalyzer = new IdentifierAnalyzer();
  private importResolver = new ImportResolver();
  private reexportResolver: ReexportResolver | null = null;
  private projectContext: ProjectContext | null = null;
  private externalDependencies = new Map<string, ExternalDependency>();

  /**
   * Configura el contexto del proyecto
   */
  public setProjectContext(context: ProjectContext): void {
    this.projectContext = context;
    this.importResolver.setProjectContext(context);
  }

  /**
   * Configura el resolvedor de re-exports (necesita ts.Program)
   */
  public setProgram(program: ts.Program): void {
    this.reexportResolver = new ReexportResolver(program);
    this.importResolver.setProgram(program);
  }

  /**
   * Genera las declaraciones de import necesarias para los nodos extraídos
   */
  public generateImports(
    sourceFile: ts.SourceFile,
    extractedNodes: ts.Declaration[],
    allExtractedFiles: Set<string>,
    projectRoot: string,
    outputDir: string
  ): {
    imports: string[];
    externalDeps: Map<string, ExternalDependency>;
  } {
    // 1. Extraer todos los imports del archivo original
    const originalImports = this.importResolver.extractImports(sourceFile);

    // 2. Analizar qué identificadores se usan en los nodos extraídos
    const { usedValues, usedTypes, declared } = this.identifierAnalyzer.analyzeNodes(extractedNodes);

    // 3. Obtener solo los identificadores externos (no locales)
    // Importamos TODOS los identificadores: valores Y tipos (TypeScript necesita tipos en compile-time)
    const { values: externalValues, types: externalTypes } = this.identifierAnalyzer.getExternalIdentifiers(
      usedValues,
      usedTypes,
      declared
    );

    // Combinar valores y tipos para importar todos
    const externalIdentifiers = new Set<string>([...externalValues, ...externalTypes]);

    // 4. Mapear cada identificador a su import
    const importsNeeded = new Map<string, Set<string>>(); // key -> Set<symbolName>

    for (const identifier of externalIdentifiers) {
      const importInfo = this.importResolver.findImportInfo(identifier);

      if (!importInfo) {
        // No se encontró import para este identificador
        continue;
      }

      // Obtener la clave (modulePath para internos, moduleSpecifier para externos)
      const key = importInfo.modulePath || importInfo.moduleSpecifier;

      if (importInfo.type === 'internal') {
        // INTERNO: Solo incluir si el archivo está en los extraídos
        if (importInfo.modulePath && allExtractedFiles.has(importInfo.modulePath)) {
          if (!importsNeeded.has(key)) {
            importsNeeded.set(key, new Set());
          }
          importsNeeded.get(key)!.add(identifier);
        }
      } else if (importInfo.type === 'external' || importInfo.type === 'builtin') {
        // EXTERNO/BUILTIN: Siempre incluir
        if (!importsNeeded.has(key)) {
          importsNeeded.set(key, new Set());
        }
        importsNeeded.get(key)!.add(identifier);

        // Rastrear dependencia externa
        if (importInfo.type === 'external') {
          this.trackExternalDependency(importInfo, identifier);
        }
      }
    }

    // 5. Generar las declaraciones de import
    const imports: string[] = [];
    const absoluteProjectRoot = path.resolve(projectRoot);

    for (const [key, symbols] of importsNeeded.entries()) {
      const importInfo = this.importResolver.getImportBySpecifier(key) ||
                         originalImports.get(key);

      if (!importInfo) continue;

      if (importInfo.type === 'internal') {
        // Generar import relativo
        imports.push(this.generateInternalImport(
          importInfo,
          symbols,
          sourceFile,
          absoluteProjectRoot,
          outputDir,
          originalImports
        ));
      } else {
        // Generar import externo (preservar original)
        imports.push(this.generateExternalImport(importInfo, symbols));
      }
    }

    return { imports, externalDeps: this.externalDependencies };
  }

  /**
   * Genera un import interno (relativo)
   */
  private generateInternalImport(
    importInfo: ImportInfo,
    symbols: Set<string>,
    sourceFile: ts.SourceFile,
    projectRoot: string,
    outputDir: string,
    originalImports: Map<string, ImportInfo>
  ): string {
    if (!importInfo.modulePath) {
      throw new Error('Internal import must have modulePath');
    }

    // Calcular ruta relativa para el import
    const currentOutputFile = path.join(
      path.resolve(outputDir),
      path.relative(projectRoot, sourceFile.fileName)
    );
    const currentOutputDir = path.dirname(currentOutputFile);

    const targetOutputFile = path.join(
      path.resolve(outputDir),
      path.relative(projectRoot, importInfo.modulePath)
    );

    let relativeImport = path.relative(currentOutputDir, targetOutputFile);

    // Asegurar que empiece con ./ o ../
    if (!relativeImport.startsWith('.')) {
      relativeImport = './' + relativeImport;
    }

    // Remover extensión
    relativeImport = relativeImport.replace(/\.(ts|tsx|js|jsx)$/, '');

    // Generar import statement con los símbolos
    const namedImports: string[] = [];

    for (const symbol of symbols) {
      // Buscar si el símbolo tiene un alias en algún import original
      let hasAlias = false;
      for (const origInfo of originalImports.values()) {
        const originalName = origInfo.namedImports.get(symbol);
        if (originalName && originalName !== symbol) {
          namedImports.push(`${originalName} as ${symbol}`);
          hasAlias = true;
          break;
        }
      }

      // Si no tiene alias, usar el nombre directo
      if (!hasAlias) {
        namedImports.push(symbol);
      }
    }

    if (namedImports.length > 0) {
      return `import { ${namedImports.join(', ')} } from '${relativeImport}';`;
    }

    return '';
  }

  /**
   * Genera un import externo (preservar original)
   */
  private generateExternalImport(importInfo: ImportInfo, symbols: Set<string>): string {
    const parts: string[] = [];

    // Manejar diferentes tipos de import
    if (importInfo.kind === 'side-effect') {
      return `import '${importInfo.moduleSpecifier}';`;
    }

    // Default import
    if (importInfo.defaultImportName && symbols.has(importInfo.defaultImportName)) {
      parts.push(importInfo.defaultImportName);
    }

    // Namespace import
    if (importInfo.namespaceImportName && symbols.has(importInfo.namespaceImportName)) {
      parts.push(`* as ${importInfo.namespaceImportName}`);
    }

    // Named imports
    const namedSymbols: string[] = [];
    for (const [localName, originalName] of importInfo.namedImports.entries()) {
      if (symbols.has(localName)) {
        if (localName === originalName) {
          namedSymbols.push(localName);
        } else {
          namedSymbols.push(`${originalName} as ${localName}`);
        }
      }
    }

    if (namedSymbols.length > 0) {
      parts.push(`{ ${namedSymbols.join(', ')} }`);
    }

    if (parts.length === 0) {
      return '';
    }

    const typePrefix = importInfo.isTypeOnly ? 'import type' : 'import';
    return `${typePrefix} ${parts.join(', ')} from '${importInfo.moduleSpecifier}';`;
  }

  /**
   * Rastrea una dependencia externa
   */
  private trackExternalDependency(importInfo: ImportInfo, identifier: string): void {
    const packageName = this.extractPackageName(importInfo.moduleSpecifier);

    if (!this.externalDependencies.has(packageName)) {
      const version = this.projectContext?.dependencies.get(packageName) ||
                      this.projectContext?.devDependencies.get(packageName) ||
                      null;

      this.externalDependencies.set(packageName, {
        packageName,
        version,
        importedSymbols: new Set(),
        importKinds: new Set(),
        isDevDependency: this.projectContext?.devDependencies.has(packageName) ?? false,
      });
    }

    const dep = this.externalDependencies.get(packageName)!;
    dep.importedSymbols.add(identifier);
    dep.importKinds.add(importInfo.kind);
  }

  /**
   * Extrae el nombre del paquete del especificador
   */
  private extractPackageName(specifier: string): string {
    // "solid-js" → "solid-js"
    // "@solidjs/router" → "@solidjs/router"
    // "lodash/debounce" → "lodash"
    // "npm:solid-js@1.9.3" → "solid-js"
    // "https://deno.land/std/fs/mod.ts" → URL completo

    if (specifier.startsWith('http://') || specifier.startsWith('https://')) {
      return specifier;
    }

    if (specifier.startsWith('npm:')) {
      specifier = specifier.substring(4).split('@')[0];
    }

    if (specifier.startsWith('jsr:')) {
      return specifier;
    }

    if (specifier.startsWith('@')) {
      const parts = specifier.split('/');
      return `${parts[0]}/${parts[1].split('@')[0]}`;
    }

    return specifier.split('/')[0].split('@')[0];
  }

  /**
   * Encuentra identificadores usados que no tienen import
   */
  public findMissingImports(
    sourceFile: ts.SourceFile,
    extractedNodes: ts.Declaration[]
  ): Set<string> {
    // Analizar identificadores usados
    const { usedValues, usedTypes, declared } = this.identifierAnalyzer.analyzeNodes(extractedNodes);
    const { values: externalValues, types: externalTypes } = this.identifierAnalyzer.getExternalIdentifiers(
      usedValues,
      usedTypes,
      declared
    );

    // Combinar valores y tipos
    const allExternal = new Set<string>([...externalValues, ...externalTypes]);

    // Extraer imports del archivo original
    this.importResolver.extractImports(sourceFile);

    // Encontrar cuáles no tienen import
    const missing = new Set<string>();

    for (const identifier of allExternal) {
      const importInfo = this.importResolver.findImportInfo(identifier);
      if (!importInfo) {
        missing.add(identifier);
      }
    }

    return missing;
  }
}
