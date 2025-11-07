import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { ProjectContext } from './projectDetector';

/**
 * Tipo de import según su origen
 */
export type ImportType = 'internal' | 'external' | 'builtin';

/**
 * Tipo de sintaxis de import
 */
export type ImportKind =
  | 'named'           // import { foo } from 'x'
  | 'default'         // import foo from 'x'
  | 'namespace'       // import * as foo from 'x'
  | 'side-effect'     // import 'x'
  | 'mixed';          // import foo, { bar } from 'x'

/**
 * Información extendida sobre un import
 */
export interface ImportInfo {
  // Clasificación
  type: ImportType;
  kind: ImportKind;

  // Especificador original (SIEMPRE presente)
  moduleSpecifier: string;

  // Ruta resuelta (null para externos)
  modulePath: string | null;

  // Símbolos importados
  namedImports: Map<string, string>;  // localName -> originalName
  defaultImportName?: string;
  namespaceImportName?: string;

  // Metadata
  isTypeOnly: boolean;
  hasAssertions: boolean;
}

/**
 * Resuelve y mapea imports de archivos TypeScript
 */
export class ImportResolver {
  private importMap = new Map<string, ImportInfo>();
  private importMapBySpecifier = new Map<string, ImportInfo>();
  private projectContext: ProjectContext | null = null;

  /**
   * Configura el contexto del proyecto
   */
  public setProjectContext(context: ProjectContext): void {
    this.projectContext = context;
  }

  /**
   * Configura el programa TypeScript (retrocompatibilidad)
   */
  public setProgram(program: ts.Program): void {
    // Mantener para retrocompatibilidad
    // El projectContext ya tiene los pathAliases
  }

  /**
   * Clasifica un import según su tipo
   */
  private classifyImport(importPath: string): ImportType {
    // 1. Builtins (node:fs, node:path, etc.)
    if (importPath.startsWith('node:')) {
      return 'builtin';
    }

    // 2. Imports relativos
    if (importPath.startsWith('.')) {
      return 'internal';
    }

    // 3. Path aliases
    if (this.isPathAlias(importPath)) {
      return 'internal';
    }

    // 4. URLs (Deno)
    if (importPath.startsWith('http://') || importPath.startsWith('https://')) {
      return 'external';
    }

    // 5. npm: specifiers (Deno)
    if (importPath.startsWith('npm:')) {
      return 'external';
    }

    // 6. jsr: specifiers (JSR)
    if (importPath.startsWith('jsr:')) {
      return 'external';
    }

    // 7. node_modules (cualquier cosa sin ./)
    return 'external';
  }

  /**
   * Verifica si un import es un path alias
   */
  private isPathAlias(importPath: string): boolean {
    if (!this.projectContext) return false;

    return Array.from(this.projectContext.pathAliases.keys()).some(
      alias => importPath === alias || importPath.startsWith(alias + '/')
    );
  }

  /**
   * Detecta el tipo de sintaxis de import
   */
  private detectImportKind(node: ts.ImportDeclaration): ImportKind {
    const clause = node.importClause;

    if (!clause) {
      return 'side-effect';
    }

    const hasDefault = clause.name !== undefined;
    const hasNamed = clause.namedBindings && ts.isNamedImports(clause.namedBindings);
    const hasNamespace = clause.namedBindings && ts.isNamespaceImport(clause.namedBindings);

    if (hasNamespace) {
      return 'namespace';
    }

    if (hasDefault && hasNamed) {
      return 'mixed';
    }

    if (hasDefault) {
      return 'default';
    }

    if (hasNamed) {
      return 'named';
    }

    return 'side-effect';
  }

  /**
   * Extrae todos los imports de un archivo fuente
   */
  public extractImports(sourceFile: ts.SourceFile): Map<string, ImportInfo> {
    this.importMap = new Map();
    const currentFileDir = path.dirname(sourceFile.fileName);

    ts.forEachChild(sourceFile, (node) => {
      if (ts.isImportDeclaration(node)) {
        this.processImport(node, currentFileDir);
      }
    });

    return this.importMap;
  }

  private processImport(node: ts.ImportDeclaration, currentFileDir: string): void {
    const moduleSpecifier = node.moduleSpecifier;

    if (!ts.isStringLiteral(moduleSpecifier)) return;

    const importPath = moduleSpecifier.text;
    const importType = this.classifyImport(importPath);

    // Resolver ruta solo para imports internos
    let resolvedPath: string | null = null;

    if (importType === 'internal') {
      if (importPath.startsWith('.')) {
        // Import relativo
        resolvedPath = this.resolveModulePath(importPath, currentFileDir);
      } else {
        // Path alias
        resolvedPath = this.resolvePathAlias(importPath);
      }
    }
    // Para external y builtin, resolvedPath queda null

    const importClause = node.importClause;

    // Crear ImportInfo completo
    const importInfo: ImportInfo = {
      type: importType,
      kind: this.detectImportKind(node),
      moduleSpecifier: importPath,
      modulePath: resolvedPath,
      namedImports: new Map(),
      isTypeOnly: importClause?.isTypeOnly ?? false,
      hasAssertions: (node as any).attributes !== undefined,
    };

    // Extraer símbolos si no es side-effect
    if (importClause) {
      // Default import
      if (importClause.name) {
        importInfo.defaultImportName = importClause.name.text;
      }

      // Named imports o namespace
      const namedBindings = importClause.namedBindings;

      if (namedBindings) {
        if (ts.isNamedImports(namedBindings)) {
          // import { foo, bar as baz } from 'x'
          for (const element of namedBindings.elements) {
            const localName = element.name.text;
            const originalName = element.propertyName
              ? element.propertyName.text
              : localName;

            importInfo.namedImports.set(localName, originalName);
          }
        } else if (ts.isNamespaceImport(namedBindings)) {
          // import * as foo from 'x'
          importInfo.namespaceImportName = namedBindings.name.text;
        }
      }
    }

    // CLAVE: Guardar TODO, no solo internos
    // Usar moduleSpecifier como clave para externos, modulePath para internos
    const key = resolvedPath || importPath;
    this.importMap.set(key, importInfo);
    this.importMapBySpecifier.set(importPath, importInfo);
  }

  /**
   * Intenta encontrar un archivo con diferentes extensiones
   */
  private tryFileExtensions(resolvedPath: string): string | null {
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.d.ts', ''];

    // Intentar con extensiones directas
    for (const ext of extensions) {
      const testPath = resolvedPath + ext;
      if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
        return testPath;
      }
    }

    // Intentar como directorio con index
    for (const ext of extensions) {
      const testPath = path.join(resolvedPath, 'index' + ext);
      if (fs.existsSync(testPath) && fs.statSync(testPath).isFile()) {
        return testPath;
      }
    }

    return null;
  }

  /**
   * Resuelve un path alias a ruta absoluta
   * Ejemplo: "@/feats/stateStore" -> "/proyecto/src/feats/stateStore"
   */
  private resolvePathAlias(importPath: string): string | null {
    if (!this.projectContext) return null;

    for (const [alias, basePath] of this.projectContext.pathAliases.entries()) {
      if (importPath === alias || importPath.startsWith(alias + '/')) {
        // Reemplazar alias con basePath
        const relativePart = importPath.substring(alias.length);
        const fullPath = path.join(basePath, relativePart);

        // Intentar con extensiones
        return this.tryFileExtensions(fullPath);
      }
    }

    return null;
  }

  /**
   * Resuelve la ruta de un módulo importado (imports relativos)
   */
  private resolveModulePath(importPath: string, currentFileDir: string): string | null {
    let basePath = importPath;

    // Remover extensiones .js/.jsx si existen
    if (basePath.endsWith('.js')) {
      basePath = basePath.slice(0, -3);
    } else if (basePath.endsWith('.jsx')) {
      basePath = basePath.slice(0, -4);
    }

    const resolvedPath = path.resolve(currentFileDir, basePath);

    return this.tryFileExtensions(resolvedPath);
  }

  /**
   * Encuentra de qué archivo proviene un identificador
   * Retorna la clave del importMap (modulePath para internos, moduleSpecifier para externos)
   */
  public findImportSource(identifier: string): string | null {
    for (const [key, importInfo] of this.importMap.entries()) {
      // Verificar en named imports
      if (importInfo.namedImports.has(identifier)) {
        return key;
      }

      // Verificar en default import
      if (importInfo.defaultImportName === identifier) {
        return key;
      }

      // Verificar en namespace import
      if (importInfo.namespaceImportName === identifier) {
        return key;
      }
    }

    return null;
  }

  /**
   * Encuentra el ImportInfo por identificador
   */
  public findImportInfo(identifier: string): ImportInfo | null {
    for (const importInfo of this.importMap.values()) {
      if (importInfo.namedImports.has(identifier) ||
          importInfo.defaultImportName === identifier ||
          importInfo.namespaceImportName === identifier) {
        return importInfo;
      }
    }

    return null;
  }

  /**
   * Obtiene ImportInfo por especificador
   */
  public getImportBySpecifier(specifier: string): ImportInfo | null {
    return this.importMapBySpecifier.get(specifier) || null;
  }

  /**
   * Obtiene todos los símbolos importados de un archivo específico
   */
  public getImportedSymbolsFromFile(modulePath: string): Set<string> {
    const importInfo = this.importMap.get(modulePath);
    if (!importInfo) return new Set();

    const symbols = new Set<string>();

    // Agregar named imports
    for (const localName of importInfo.namedImports.keys()) {
      symbols.add(localName);
    }

    // Agregar default import
    if (importInfo.defaultImportName) {
      symbols.add(importInfo.defaultImportName);
    }

    // Agregar namespace import
    if (importInfo.namespaceImportName) {
      symbols.add(importInfo.namespaceImportName);
    }

    return symbols;
  }
}
