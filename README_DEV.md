# Documentación para Desarrolladores - @tirio/libextract

> 📚 **Guía completa de arquitectura, implementación y desarrollo**

**Nota Importante:** Este proyecto fue desarrollado con asistencia de IA ([Claude Code by Anthropic](https://claude.ai/code)).

---

## 📑 Tabla de Contenidos

1. [Visión General](#-visión-general)
2. [Arquitectura del Sistema](#-arquitectura-del-sistema)
3. [Módulos y Componentes](#-módulos-y-componentes)
4. [Flujos de Ejecución](#-flujos-de-ejecución)
5. [Estructuras de Datos](#-estructuras-de-datos)
6. [Algoritmos Clave](#-algoritmos-clave)
7. [Guía de Desarrollo](#-guía-de-desarrollo)
8. [Testing](#-testing)
9. [Debugging](#-debugging)
10. [Bugs Conocidos y Soluciones](#-bugs-conocidos-y-soluciones)
11. [Roadmap](#-roadmap)
12. [Decisiones de Diseño](#-decisiones-de-diseño)
13. [Contribuir](#-contribuir)
14. [Glosario](#-glosario)
15. [Referencias](#-referencias)

---

## 🎯 Visión General

### Objetivos del Proyecto

`@tirio/libextract` es una herramienta CLI que realiza **code slicing** inteligente a nivel de código fuente TypeScript/JavaScript. A diferencia de bundlers tradicionales que operan en tiempo de compilación, esta herramienta:

- **Analiza semánticamente** el código usando la TypeScript Compiler API
- **Rastrea dependencias transitivas** de forma recursiva
- **Extrae código mínimo** necesario para un símbolo específico
- **Genera manifiestos** con dependencias externas exactas
- **Preserva estructura** del proyecto original

### Principios Arquitectónicos

1. **Separation of Concerns**: Cada módulo tiene una responsabilidad única y bien definida
2. **Visitor Pattern**: Traversal del AST siguiendo el patrón visitor
3. **Dependency Inversion**: Los módulos de alto nivel no dependen de implementaciones específicas
4. **Type Safety**: TypeScript strict mode para máxima seguridad de tipos
5. **Immutability**: Uso de estructuras inmutables donde sea posible (Map, Set)

### Decisiones Técnicas Clave

- **TypeScript Compiler API**: Acceso completo al AST y type checking semántico
- **Commander.js**: CLI framework robusto y simple
- **Separación tipo/valor**: Context tracking durante AST traversal
- **Path normalization**: Todos los paths internos en formato absoluto
- **Project References**: Soporte completo para monorepos TypeScript

---

## 🏗️ Arquitectura del Sistema

### Pipeline de Procesamiento

El flujo principal sigue un pipeline secuencial con 5 fases:

```
┌─────────────────────────────────────────────────────────┐
│                    INPUT (CLI)                          │
│  - Project path                                         │
│  - Entry file                                           │
│  - Symbol name(s)                                       │
│  - Output directory                                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│          PHASE 1: PROJECT DETECTION                     │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │         ProjectDetector                         │   │
│  │  • Detecta ambiente (Node.js/Deno/Bun)         │   │
│  │  • Carga package.json / deno.json              │   │
│  │  • Parsea tsconfig.json                        │   │
│  │  • Carga Project References                    │   │
│  │  • Extrae path aliases                         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Output: ProjectContext                                 │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│       PHASE 2: PROGRAM INITIALIZATION                   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Slicer (Constructor)                    │   │
│  │  • Crea ts.Program con todos los archivos      │   │
│  │  • Inicializa TypeChecker                      │   │
│  │  • Prepara tracking sets                       │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Output: ts.Program, ts.TypeChecker                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│     PHASE 3: DEPENDENCY COLLECTION                      │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │      Slicer.collectDependencies()               │   │
│  │                                                 │   │
│  │  1. Encuentra símbolo inicial                  │   │
│  │  2. Obtiene declaraciones del símbolo          │   │
│  │  3. Para cada declaración:                     │   │
│  │     • Marca como requerida                     │   │
│  │     • Analiza body (AST traversal)             │   │
│  │     • Identifica símbolos usados               │   │
│  │     • Recursión en cada sub-símbolo            │   │
│  │  4. Previene ciclos con visitedSymbols         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Output: Set<ts.Declaration> (requiredDeclarations)     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│      PHASE 4: IMPORT RESOLUTION & GENERATION            │
│                                                         │
│  Para cada archivo con declaraciones requeridas:       │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │    ImportResolver.resolveImports()              │   │
│  │    • Mapea todos los imports del archivo        │   │
│  │    • Clasifica: internal/external/builtin       │   │
│  │    • Resuelve path aliases                      │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                   │
│  ┌─────────────────▼──────────────────────────────┐   │
│  │  IdentifierAnalyzer.analyzeNodes()              │   │
│  │    • Visitor pattern sobre AST                  │   │
│  │    • Context tracking (tipo vs valor)           │   │
│  │    • Caso especial: new expressions             │   │
│  │    • Filtra identificadores externos            │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                   │
│  ┌─────────────────▼──────────────────────────────┐   │
│  │  ReexportResolver.resolveSymbolSource()         │   │
│  │    • Encuentra archivo real de símbolos         │   │
│  │    • Maneja re-exports (index.ts)               │   │
│  │    • Normaliza paths a absolutos                │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                   │
│  ┌─────────────────▼──────────────────────────────┐   │
│  │  ImportGenerator.generateImports()              │   │
│  │    • Genera import statements                   │   │
│  │    • Ajusta rutas relativas                     │   │
│  │    • Resuelve aliases a relativos               │   │
│  │    • Trackea dependencias externas              │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Output: import statements[], ExternalDependency[]      │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│         PHASE 5: FILE GENERATION                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │    writeToOutputDirectory()                     │   │
│  │  • Escribe archivos con imports + código        │   │
│  │  • Preserva estructura de directorios           │   │
│  │  • Acumula dependencias externas                │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                   │
│  ┌─────────────────▼──────────────────────────────┐   │
│  │  ManifestGenerator.generateManifest()           │   │
│  │    • package.json (Node.js/Bun)                 │   │
│  │    • deno.json (Deno)                           │   │
│  │    • DEPENDENCIES.md (reporte)                  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Output: Archivos escritos en disco                    │
└─────────────────────────────────────────────────────────┘
```

### Diagrama de Módulos

```
┌──────────────────────────────────────────────────────────┐
│                    CLI Layer                             │
│  ┌────────────────────────────────────────────────────┐  │
│  │  slicer.ts (Main Entry Point)                     │  │
│  │  • Parsea argumentos (Commander)                  │  │
│  │  • Orquesta el flujo completo                     │  │
│  │  • Maneja errores y output                        │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌─────────────────────┐      ┌────────────────────────┐
│  Detection Layer    │      │   Core Processing      │
│                     │      │                        │
│  ProjectDetector    │      │  Slicer (Class)        │
│  • Environment      │      │  • ts.Program          │
│  • Package manager  │      │  • ts.TypeChecker      │
│  • tsconfig parsing │      │  • Symbol tracking     │
│  • Path aliases     │      │  • Dependency collect  │
│  • Project refs     │      │                        │
└─────────────────────┘      └───────────┬────────────┘
                                         │
                 ┌───────────────────────┼───────────────────────┐
                 │                       │                       │
                 ▼                       ▼                       ▼
        ┌─────────────────┐    ┌──────────────────┐   ┌──────────────────┐
        │ Analysis Layer  │    │ Resolution Layer │   │ Generation Layer │
        │                 │    │                  │   │                  │
        │ Identifier      │    │ ImportResolver   │   │ ImportGenerator  │
        │  Analyzer       │    │ • Import mapping │   │ • Generate stmts │
        │ • AST visitor   │    │ • Classification │   │ • Path adjust    │
        │ • Type/value    │    │ • Alias resolve  │   │ • Track external │
        │ • new handling  │    │                  │   │                  │
        │                 │    │ ReexportResolver │   │ Manifest         │
        │                 │    │ • Re-export map  │   │  Generator       │
        │                 │    │ • Real source    │   │ • package.json   │
        │                 │    │ • Path normalize │   │ • deno.json      │
        │                 │    │                  │   │ • DEPENDENCIES   │
        └─────────────────┘    └──────────────────┘   └──────────────────┘
```

---

## 📦 Módulos y Componentes

### 1. `slicer.ts` - Entry Point & Orquestación

**Archivo**: `src/slicer.ts`

**Responsabilidad**: Punto de entrada CLI y orquestación del flujo completo.

#### Clase Principal: `Slicer`

```typescript
class Slicer {
  private program: ts.Program;
  private checker: ts.TypeChecker;
  private requiredDeclarations = new Set<ts.Declaration>();
  private visitedSymbols = new Set<ts.Symbol>();
  private projectContext: ProjectContext;
  private manifestGenerator: ManifestGenerator;

  constructor(projectRoot: string)
  extractSymbol(fileName: string, symbolName: string): Map<string, ts.Declaration[]>
  private collectDependencies(symbol: ts.Symbol): void
  private addDeclarationsOfSymbol(symbol: ts.Symbol): void
}
```

**Métodos Clave**:

- **`constructor(projectRoot)`**: Inicializa TypeChecker
  - Detecta ambiente del proyecto
  - Carga tsconfig.json y Project References
  - Crea ts.Program con todos los archivos

- **`extractSymbol(fileName, symbolName)`**: Extrae un símbolo y sus dependencias
  - Encuentra el símbolo en el archivo
  - Llama a `collectDependencies()` recursivamente
  - Retorna mapa de archivos → declaraciones

- **`collectDependencies(symbol)`**: Recolección recursiva (DFS)
  - Previene ciclos con `visitedSymbols`
  - Obtiene declaraciones del símbolo
  - Analiza body de cada declaración
  - Identifica símbolos usados
  - Recursión en cada sub-símbolo

**Tracking Sets**:

```typescript
requiredDeclarations: Set<ts.Declaration>  // Declaraciones que se deben extraer
visitedSymbols: Set<ts.Symbol>            // Prevenir ciclos en recursión
```

---

### 2. `projectDetector.ts` - Detección de Ambiente

**Archivo**: `src/utils/projectDetector.ts`

**Responsabilidad**: Detectar tipo de proyecto, package manager, y cargar configuración.

#### Clase Principal: `ProjectDetector`

```typescript
class ProjectDetector {
  constructor(private projectRoot: string)
  public detect(): ProjectContext
  private detectEnvironment(): Environment
  private detectPackageManager(): PackageManager
  private loadDependencies(): void
  private parseTsConfig(tsconfigPath: string | null): void
  private extractPathAliases(options, configDir, pathAliases): void
}
```

#### Interfaz: `ProjectContext`

```typescript
interface ProjectContext {
  environment: 'nodejs' | 'deno' | 'bun' | 'unknown';
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'none';
  dependencies: Map<string, string>;
  devDependencies: Map<string, string>;
  pathAliases: Map<string, string>;       // '@/' -> '/absolute/path/src'
  moduleType: 'module' | 'commonjs';
}
```

**Lógica de Detección**:

```typescript
// Ambiente
if (exists('deno.json')) return 'deno'
if (exists('bun.lockb')) return 'bun'
if (exists('package.json')) return 'nodejs'
return 'unknown'

// Package Manager
if (exists('yarn.lock')) return 'yarn'
if (exists('pnpm-lock.yaml')) return 'pnpm'
if (exists('bun.lockb')) return 'bun'
if (exists('package-lock.json')) return 'npm'
return 'none'
```

**Carga de TypeScript Project References**:

```typescript
// tsconfig.json puede tener:
{
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}

// ProjectDetector:
// 1. Carga tsconfig.json principal
// 2. Itera referencias
// 3. Carga cada tsconfig referenciado
// 4. Extrae paths de cada uno
// 5. Combina todos los pathAliases en un solo Map
```

---

### 3. `identifierAnalyzer.ts` - Análisis de Identificadores

**Archivo**: `src/utils/identifierAnalyzer.ts`

**Responsabilidad**: Analizar AST para extraer identificadores usados, distinguiendo tipos de valores.

#### Clase Principal: `IdentifierAnalyzer`

```typescript
class IdentifierAnalyzer {
  private usedValueIdentifiers = new Set<string>();
  private usedTypeIdentifiers = new Set<string>();
  private declaredIdentifiers = new Set<string>();
  private checker: ts.TypeChecker | null = null;

  public setTypeChecker(checker: ts.TypeChecker): void
  public analyzeNodes(nodes: ts.Declaration[]): AnalysisResult
  private visitNode(node: ts.Node, isTypeContext: boolean): void
  private isTypeContextNode(node: ts.Node): boolean
  private collectDeclaredIdentifiers(node: ts.Node): void
  public getExternalIdentifiers(usedValues, usedTypes, declared): FilteredResult
}
```

#### Análisis Resultado:

```typescript
interface AnalysisResult {
  usedValues: Set<string>;    // Identificadores usados como valores
  usedTypes: Set<string>;     // Identificadores usados como tipos
  declared: Set<string>;      // Identificadores declarados localmente
}
```

**Lógica Clave - Context Tracking**:

```typescript
private visitNode(node: ts.Node, isTypeContext: boolean): void {
  // Determinar si estamos en contexto de tipo
  const inTypeContext = isTypeContext || this.isTypeContextNode(node);

  if (ts.isIdentifier(node)) {
    if (inTypeContext) {
      this.usedTypeIdentifiers.add(node.text);  // Tipo
    } else {
      this.usedValueIdentifiers.add(node.text);  // Valor
    }
  }

  // CASO ESPECIAL: new expressions
  if (ts.isNewExpression(node)) {
    // Constructor: VALOR
    if (node.expression) {
      this.visitNode(node.expression, false);
    }
    // Type arguments: TIPOS
    if (node.typeArguments) {
      for (const typeArg of node.typeArguments) {
        this.visitNode(typeArg, true);
      }
    }
    // Argumentos: VALORES
    if (node.arguments) {
      for (const arg of node.arguments) {
        this.visitNode(arg, false);
      }
    }
    return;  // No usar forEachChild
  }

  // Recursión
  ts.forEachChild(node, (child) => this.visitNode(child, inTypeContext));
}
```

**Contextos de Tipo**:

```typescript
private isTypeContextNode(node: ts.Node): boolean {
  if (ts.isTypeNode(node)) return true;                    // : Type
  if (ts.isTypeParameterDeclaration(node)) return true;    // <T>
  if (ts.isInterfaceDeclaration(node)) return true;        // interface I
  if (ts.isTypeAliasDeclaration(node)) return true;        // type T = ...
  return false;
}
```

---

### 4. `importResolver.ts` - Resolución de Imports

**Archivo**: `src/utils/importResolver.ts`

**Responsabilidad**: Mapear imports del archivo y clasificarlos.

#### Clase Principal: `ImportResolver`

```typescript
class ImportResolver {
  private importMap = new Map<string, ImportInfo>();
  private pathAliases: Map<string, string> = new Map();

  public setPathAliases(aliases: Map<string, string>): void
  public resolveImports(sourceFile: ts.SourceFile): void
  public findImportInfo(symbolName: string): ImportInfo | null
  public getImportByKey(key: string): ImportInfo | null
  private classifyImport(importPath: string): ImportType
  private isPathAlias(importPath: string): boolean
}
```

#### Tipos de Import:

```typescript
type ImportType = 'internal' | 'external' | 'builtin';
type ImportKind = 'named' | 'default' | 'namespace' | 'side-effect' | 'mixed';

interface ImportInfo {
  type: ImportType;
  kind: ImportKind;
  moduleSpecifier: string;         // './utils' o 'axios'
  modulePath: string | null;       // /absolute/path/to/utils.ts (solo internal)
  namedImports: Map<string, string>;  // { 'foo': 'foo', 'bar': 'baz' }
  defaultImportName?: string;
  namespaceImportName?: string;
  isTypeOnly: boolean;
  hasAssertions: boolean;
}
```

**Clasificación de Imports**:

```typescript
private classifyImport(importPath: string): ImportType {
  if (importPath.startsWith('node:')) return 'builtin';      // node:fs
  if (importPath.startsWith('.')) return 'internal';         // ./utils
  if (this.isPathAlias(importPath)) return 'internal';       // @/utils
  if (importPath.startsWith('http://')) return 'external';   // http://...
  if (importPath.startsWith('https://')) return 'external';  // https://...
  if (importPath.startsWith('npm:')) return 'external';      // npm:axios
  if (importPath.startsWith('jsr:')) return 'external';      // jsr:@std/path
  return 'external';                                         // axios, lodash
}
```

**Resolución de Path Aliases**:

```typescript
// tsconfig.json:
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "~/utils/*": ["src/utils/*"]
    }
  }
}

// ImportResolver:
private isPathAlias(importPath: string): boolean {
  for (const [alias, _] of this.pathAliases) {
    if (importPath === alias || importPath.startsWith(alias + '/')) {
      return true;
    }
  }
  return false;
}
```

**Storage Strategy**:

```typescript
// importMap usa dos tipos de keys:
// - Para internal: modulePath (absolute path)
// - Para external: moduleSpecifier (package name)

// Ejemplo:
importMap = {
  '/project/src/utils.ts': { type: 'internal', ... },
  'axios': { type: 'external', ... }
}
```

---

### 5. `reexportResolver.ts` - Resolución de Re-exports

**Archivo**: `src/utils/reexportResolver.ts`

**Responsabilidad**: Encontrar el archivo real donde un símbolo está declarado (maneja `export * from`).

#### Clase Principal: `ReexportResolver`

```typescript
class ReexportResolver {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(program: ts.Program)
  public resolveSymbolSource(importedFilePath: string, symbolName: string): string | null
  public mapReexports(indexFilePath: string): Map<string, string>
}
```

**Algoritmo de Resolución**:

```typescript
public resolveSymbolSource(importedFilePath: string, symbolName: string): string | null {
  const sourceFile = this.program.getSourceFile(importedFilePath);
  if (!sourceFile) return null;

  // Obtener módulo symbol
  const symbol = this.checker.getSymbolAtLocation(sourceFile);
  if (!symbol) return null;

  // Obtener exports del módulo
  const exports = this.checker.getExportsOfModule(symbol);

  for (const exportSymbol of exports) {
    if (exportSymbol.getName() === symbolName) {
      // Obtener declaraciones
      const declarations = exportSymbol.getDeclarations();
      if (!declarations || declarations.length === 0) continue;

      const declaration = declarations[0];
      let declarationFile = declaration.getSourceFile().fileName;

      // CRÍTICO: Normalizar a ruta absoluta
      if (!path.isAbsolute(declarationFile)) {
        declarationFile = path.resolve(declarationFile);
      }

      // Si está en archivo diferente, es re-export
      if (declarationFile !== importedFilePath) {
        return declarationFile;  // Archivo real
      }

      return importedFilePath;  // Mismo archivo
    }
  }

  return null;  // No encontrado
}
```

**Ejemplo de Re-export**:

```typescript
// src/utils/index.ts
export * from './math';
export * from './string';

// src/utils/math.ts
export function add(a, b) { return a + b; }

// Cuando se importa:
import { add } from './utils';

// importResolver encuentra:
// modulePath: /project/src/utils/index.ts

// reexportResolver.resolveSymbolSource('/project/src/utils/index.ts', 'add')
// retorna: /project/src/utils/math.ts  <- Archivo REAL
```

---

### 6. `importGenerator.ts` - Generación de Imports

**Archivo**: `src/utils/importGenerator.ts`

**Responsabilidad**: Generar declaraciones de import correctas y trackear dependencias externas.

#### Clase Principal: `ImportGenerator`

```typescript
class ImportGenerator {
  private identifierAnalyzer = new IdentifierAnalyzer();
  private importResolver = new ImportResolver();
  private reexportResolver: ReexportResolver | null = null;
  private externalDependencies = new Map<string, ExternalDependency>();
  private projectContext: ProjectContext | null = null;
  private program: ts.Program | null = null;

  public setProjectContext(context: ProjectContext): void
  public setProgram(program: ts.Program): void
  public generateImports(...): { imports: string[], externalDeps: Map<...> }
  private generateInternalImport(...): string
  private generateExternalImport(...): string
  private trackExternalDependency(...): void
}
```

#### Flujo de Generación:

```typescript
public generateImports(
  sourceFile: ts.SourceFile,
  extractedNodes: ts.Declaration[],
  allExtractedFiles: Set<string>,
  projectRoot: string,
  outputDir: string
): { imports: string[]; externalDeps: Map<string, ExternalDependency> } {

  // 1. Resolver imports del archivo original
  this.importResolver.resolveImports(sourceFile);

  // 2. Analizar identificadores usados
  const { usedValues, usedTypes, declared } =
    this.identifierAnalyzer.analyzeNodes(extractedNodes);

  // 3. Filtrar externos
  const { values: externalValues, types: externalTypes } =
    this.identifierAnalyzer.getExternalIdentifiers(usedValues, usedTypes, declared);

  // 4. Combinar tipos y valores
  const externalIdentifiers = new Set<string>([...externalValues, ...externalTypes]);

  // 5. Mapear cada identificador a su import
  const importsNeeded = new Map<string, Set<string>>();
  const realModulePaths = new Map<string, string>();

  for (const identifier of externalIdentifiers) {
    const importInfo = this.importResolver.findImportInfo(identifier);
    if (!importInfo) continue;

    const key = importInfo.modulePath || importInfo.moduleSpecifier;

    if (importInfo.type === 'internal') {
      let finalModulePath = importInfo.modulePath;

      // Resolver re-exports
      if (finalModulePath && this.reexportResolver) {
        const realSourcePath = this.reexportResolver.resolveSymbolSource(
          finalModulePath, identifier
        );
        if (realSourcePath) {
          finalModulePath = realSourcePath;
        }
      }

      // Verificar si archivo está extraído
      if (finalModulePath && allExtractedFiles.has(finalModulePath)) {
        if (!importsNeeded.has(key)) {
          importsNeeded.set(key, new Set());
        }
        importsNeeded.get(key)!.add(identifier);
        realModulePaths.set(key, finalModulePath);
      }
    } else if (importInfo.type === 'external' || importInfo.type === 'builtin') {
      if (!importsNeeded.has(key)) {
        importsNeeded.set(key, new Set());
      }
      importsNeeded.get(key)!.add(identifier);

      if (importInfo.type === 'external') {
        this.trackExternalDependency(importInfo, identifier);
      }
    }
  }

  // 6. Generar import statements
  const imports: string[] = [];
  const absoluteProjectRoot = path.resolve(projectRoot);

  for (const [key, symbols] of importsNeeded.entries()) {
    const importInfo = this.importResolver.getImportByKey(key);
    if (!importInfo) continue;

    if (importInfo.type === 'internal') {
      const realModulePath = realModulePaths.get(key);
      const generatedImport = this.generateInternalImport(
        importInfo, symbols, sourceFile, absoluteProjectRoot,
        outputDir, originalImports, realModulePath
      );
      if (generatedImport) imports.push(generatedImport);
    } else {
      const generatedImport = this.generateExternalImport(importInfo, symbols);
      if (generatedImport) imports.push(generatedImport);
    }
  }

  return { imports, externalDeps: this.externalDependencies };
}
```

**Ajuste de Rutas Relativas**:

```typescript
private generateInternalImport(...): string {
  // Calcular path relativo desde output file hasta target file
  const outputFilePath = path.join(outputDir, relativePath);
  const outputFileDir = path.dirname(outputFilePath);

  const targetPath = realModulePath || modulePath;
  const targetRelativeToProject = path.relative(absoluteProjectRoot, targetPath);
  const targetInOutput = path.join(outputDir, targetRelativeToProject);

  let relativeImportPath = path.relative(outputFileDir, targetInOutput);

  // Asegurar ./ o ../
  if (!relativeImportPath.startsWith('.')) {
    relativeImportPath = './' + relativeImportPath;
  }

  // Remover extensión
  relativeImportPath = relativeImportPath.replace(/\.(ts|tsx|js|jsx)$/, '');

  return `import { ${Array.from(symbols).join(', ')} } from '${relativeImportPath}';`;
}
```

---

### 7. `manifestGenerator.ts` - Generación de Manifiestos

**Archivo**: `src/utils/manifestGenerator.ts`

**Responsabilidad**: Generar `package.json`, `deno.json`, y `DEPENDENCIES.md`.

#### Clase Principal: `ManifestGenerator`

```typescript
class ManifestGenerator {
  constructor(private projectContext: ProjectContext)

  public generateManifest(externalDeps: Map<string, ExternalDependency>, outputDir: string): void
  private generatePackageJson(externalDeps, outputDir): void
  private generateDenoJson(externalDeps, outputDir): void
  public generateDependencyReport(externalDeps, outputDir): void
}
```

#### Interfaz: `ExternalDependency`

```typescript
interface ExternalDependency {
  packageName: string;
  version: string;
  isDevDependency: boolean;
  importedSymbols: Set<string>;
  importKinds: Set<ImportKind>;
}
```

**Generación de package.json**:

```typescript
private generatePackageJson(externalDeps, outputDir): void {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};

  for (const dep of externalDeps.values()) {
    // Filtrar URLs no compatibles con npm
    if (dep.packageName.startsWith('http://') ||
        dep.packageName.startsWith('https://') ||
        dep.packageName.startsWith('jsr:')) {
      console.log(`  ⚠️  Dependencia no compatible con npm: ${dep.packageName}`);
      continue;
    }

    const version = dep.version || 'latest';

    if (dep.isDevDependency) {
      devDependencies[dep.packageName] = version;
    } else {
      dependencies[dep.packageName] = version;
    }
  }

  const packageJson: any = {
    name: 'extracted-code',
    version: '1.0.0',
    type: this.projectContext.moduleType || 'module',
  };

  if (Object.keys(dependencies).length > 0) {
    packageJson.dependencies = dependencies;
  }

  if (Object.keys(devDependencies).length > 0) {
    packageJson.devDependencies = devDependencies;
  }

  fs.writeFileSync(
    path.join(outputDir, 'package.json'),
    JSON.stringify(packageJson, null, 2) + '\n'
  );
}
```

**Generación de DEPENDENCIES.md**:

```markdown
# Reporte de Dependencias Externas

Generado: 2025-01-15T10:30:00.000Z

Ambiente: nodejs

Total de dependencias: 3

## axios
- Versión: ^1.6.0
- Tipo: dependency
- Símbolos importados (3):
  - get
  - post
  - AxiosResponse
- Tipos de import: named

## lodash
- Versión: ^4.17.21
- Tipo: dependency
- Símbolos importados (2):
  - debounce
  - throttle
- Tipos de import: named
```

---

## 🔄 Flujos de Ejecución

### Flujo Principal Completo

```
START: CLI invocation
│
├─► Parse arguments (Commander)
│     projectPath, entryFile, symbolName, outputDir
│
├─► ProjectDetector.detect()
│     │
│     ├─► detectEnvironment()
│     │     • Check for deno.json → 'deno'
│     │     • Check for bun.lockb → 'bun'
│     │     • Check for package.json → 'nodejs'
│     │     • Default → 'unknown'
│     │
│     ├─► detectPackageManager()
│     │     • Check for yarn.lock → 'yarn'
│     │     • Check for pnpm-lock.yaml → 'pnpm'
│     │     • Check for bun.lockb → 'bun'
│     │     • Check for package-lock.json → 'npm'
│     │     • Default → 'none'
│     │
│     ├─► loadDependencies()
│     │     • Parse package.json or deno.json
│     │     • Load dependencies and devDependencies
│     │
│     └─► parseTsConfig()
│           • Find tsconfig.json
│           • Parse compiler options
│           • Check for "references"
│           • For each reference:
│           │   • Load referenced tsconfig
│           │   • Extract paths from it
│           │   • Merge paths
│           • extractPathAliases()
│           │   • Convert '@/*' to absolute paths
│           │   • Store in pathAliases Map
│           │
│           Output: ProjectContext
│
├─► new Slicer(projectPath)
│     │
│     ├─► Load tsconfig.json
│     ├─► Load all referenced tsconfig files
│     ├─► Combine all file lists
│     ├─► Create ts.Program with ALL files
│     ├─► Initialize ts.TypeChecker
│     │
│     Output: Slicer instance
│
├─► Slicer.extractSymbol(entryFile, symbolName)
│     │
│     ├─► Get source file
│     ├─► Find symbol by name
│     │     • If symbolName === '*': get all exports
│     │     • Else: get specific symbol
│     │
│     ├─► For each target symbol:
│     │     │
│     │     └─► collectDependencies(symbol)  [RECURSIVE]
│     │           │
│     │           ├─► Check visitedSymbols (prevent cycles)
│     │           ├─► Mark symbol as visited
│     │           │
│     │           ├─► Get declarations
│     │           ├─► For each declaration:
│     │           │     │
│     │           │     ├─► Mark as required
│     │           │     ├─► Get declaration body
│     │           │     │
│     │           │     └─► Traverse body AST
│     │           │           • For each identifier:
│     │           │             • Get type at location
│     │           │             • Get symbol from type
│     │           │             • If symbol exists:
│     │           │               → collectDependencies(symbol)  [RECURSE]
│     │           │
│     │           Output: requiredDeclarations populated
│     │
│     ├─► Group declarations by file
│     │
│     Output: Map<fileName, Declaration[]>
│
├─► For each (fileName, declarations) in result:
│     │
│     ├─► Get source file
│     ├─► Get all original imports
│     │
│     ├─► ImportResolver.resolveImports(sourceFile)
│     │     │
│     │     ├─► Set path aliases from ProjectContext
│     │     │
│     │     ├─► For each import in file:
│     │     │     │
│     │     │     ├─► Extract module specifier
│     │     │     ├─► classifyImport(specifier)
│     │     │     │     • node: → builtin
│     │     │     │     • ./ → internal
│     │     │     │     • @/ (alias) → internal
│     │     │     │     • http:// → external
│     │     │     │     • axios → external
│     │     │     │
│     │     │     ├─► Parse import clause
│     │     │     │     • Named: import { a, b }
│     │     │     │     • Default: import foo
│     │     │     │     • Namespace: import * as foo
│     │     │     │     • Side-effect: import './file'
│     │     │     │
│     │     │     ├─► If internal:
│     │     │     │     • Resolve to absolute path
│     │     │     │     • Store with modulePath
│     │     │     │
│     │     │     └─► Store in importMap
│     │     │           • Key: modulePath (internal) or specifier (external)
│     │     │           • Value: ImportInfo
│     │     │
│     │     Output: importMap populated
│     │
│     ├─► IdentifierAnalyzer.analyzeNodes(declarations)
│     │     │
│     │     ├─► Reset sets
│     │     │
│     │     ├─► For each declaration:
│     │     │     │
│     │     │     └─► visitNode(declaration, false)  [RECURSIVE]
│     │     │           │
│     │     │           ├─► collectDeclaredIdentifiers(node)
│     │     │           │     • Variables, parameters, functions, classes
│     │     │           │
│     │     │           ├─► Determine context
│     │     │           │     inTypeContext = isTypeContext || isTypeContextNode(node)
│     │     │           │
│     │     │           ├─► If Identifier:
│     │     │           │     • If inTypeContext: add to usedTypeIdentifiers
│     │     │           │     • Else: add to usedValueIdentifiers
│     │     │           │
│     │     │           ├─► If NewExpression:  [SPECIAL CASE]
│     │     │           │     • visitNode(expression, false)  // Constructor = VALUE
│     │     │           │     • For each typeArg: visitNode(typeArg, true)  // TYPE
│     │     │           │     • For each arg: visitNode(arg, false)  // VALUE
│     │     │           │     • RETURN (skip forEachChild)
│     │     │           │
│     │     │           └─► forEachChild(node, child =>
│     │     │                   visitNode(child, inTypeContext))  [RECURSE]
│     │     │
│     │     ├─► getExternalIdentifiers(usedValues, usedTypes, declared)
│     │     │     • Filter out declared
│     │     │     • Filter out built-ins (console, Promise, etc.)
│     │     │
│     │     Output: { usedValues, usedTypes, declared }
│     │
│     ├─► ImportGenerator.generateImports(...)
│     │     │
│     │     ├─► Combine usedValues + usedTypes
│     │     │     externalIdentifiers = [...values, ...types]
│     │     │
│     │     ├─► For each identifier in externalIdentifiers:
│     │     │     │
│     │     │     ├─► findImportInfo(identifier)
│     │     │     │     • Search in importMap
│     │     │     │     • Check namedImports, defaultImport, namespace
│     │     │     │
│     │     │     ├─► If not found: continue
│     │     │     │
│     │     │     ├─► If type === 'internal':
│     │     │     │     │
│     │     │     │     ├─► Get modulePath
│     │     │     │     │
│     │     │     │     ├─► ReexportResolver.resolveSymbolSource(modulePath, identifier)
│     │     │     │     │     │
│     │     │     │     │     ├─► Get source file
│     │     │     │     │     ├─► Get module symbol
│     │     │     │     │     ├─► Get exports of module
│     │     │     │     │     ├─► Find export with symbolName
│     │     │     │     │     ├─► Get declarations
│     │     │     │     │     ├─► Get declaration file
│     │     │     │     │     ├─► Normalize to absolute path
│     │     │     │     │     │
│     │     │     │     │     └─► If declarationFile ≠ modulePath:
│     │     │     │     │           • Return declarationFile  (re-export)
│     │     │     │     │         Else:
│     │     │     │     │           • Return modulePath  (same file)
│     │     │     │     │
│     │     │     │     ├─► Update finalModulePath to real source
│     │     │     │     │
│     │     │     │     ├─► Check if finalModulePath in allExtractedFiles
│     │     │     │     │
│     │     │     │     └─► If YES:
│     │     │     │           • Add to importsNeeded
│     │     │     │           • Store realModulePath
│     │     │     │
│     │     │     └─► If type === 'external' or 'builtin':
│     │     │           │
│     │     │           ├─► Add to importsNeeded
│     │     │           │
│     │     │           └─► If external:
│     │     │                 • trackExternalDependency(importInfo, identifier)
│     │     │                   • Get version from ProjectContext
│     │     │                   • Store in externalDependencies Map
│     │     │
│     │     ├─► Generate import statements
│     │     │     │
│     │     │     ├─► For each (key, symbols) in importsNeeded:
│     │     │     │     │
│     │     │     │     ├─► Get ImportInfo
│     │     │     │     │
│     │     │     │     ├─► If internal:
│     │     │     │     │     • generateInternalImport()
│     │     │     │     │       • Calculate relative path from output file to target
│     │     │     │     │       • Remove extension
│     │     │     │     │       • Generate: import { ... } from './path'
│     │     │     │     │
│     │     │     │     └─► If external:
│     │     │     │           • generateExternalImport()
│     │     │     │             • Generate: import { ... } from 'package'
│     │     │     │
│     │     │     Output: { imports[], externalDeps }
│     │     │
│     │     └─► Return { imports, externalDeps }
│     │
│     ├─► Write file to output
│     │     • Create directory structure
│     │     • Write imports
│     │     • Write extracted code
│     │
│     └─► Accumulate external dependencies
│
├─► ManifestGenerator.generateManifest(allExternalDeps, outputDir)
│     │
│     ├─► If environment === 'nodejs' or 'bun':
│     │     │
│     │     └─► generatePackageJson()
│     │           • Separate dependencies / devDependencies
│     │           • Write package.json
│     │
│     ├─► If environment === 'deno':
│     │     │
│     │     └─► generateDenoJson()
│     │           • Generate imports map
│     │           • Write deno.json
│     │
│     └─► generateDependencyReport()
│           • Generate DEPENDENCIES.md
│           • List all external deps with details
│
└─► END: Output written

  ✨ Success!
  - Files extracted
  - Imports generated
  - Manifests created
  - Dependencies documented
```

---

## 🗂️ Estructuras de Datos

### ProjectContext

```typescript
interface ProjectContext {
  environment: 'nodejs' | 'deno' | 'bun' | 'unknown';
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'none';
  dependencies: Map<string, string>;       // 'axios' → '^1.6.0'
  devDependencies: Map<string, string>;    // 'typescript' → '^5.0.0'
  pathAliases: Map<string, string>;        // '@/' → '/abs/path/src'
  moduleType: 'module' | 'commonjs';
}
```

### ImportInfo

```typescript
interface ImportInfo {
  type: ImportType;                        // 'internal' | 'external' | 'builtin'
  kind: ImportKind;                        // 'named' | 'default' | 'namespace' | ...
  moduleSpecifier: string;                 // './utils' | 'axios'
  modulePath: string | null;               // /abs/path/utils.ts (solo internal)
  namedImports: Map<string, string>;       // 'originalName' → 'localName'
  defaultImportName?: string;              // 'foo' en import foo from
  namespaceImportName?: string;            // 'foo' en import * as foo
  isTypeOnly: boolean;                     // import type { ... }
  hasAssertions: boolean;                  // import ... assert { type: 'json' }
}
```

### ExternalDependency

```typescript
interface ExternalDependency {
  packageName: string;                     // 'axios'
  version: string;                         // '^1.6.0'
  isDevDependency: boolean;
  importedSymbols: Set<string>;            // {'get', 'post', 'AxiosResponse'}
  importKinds: Set<ImportKind>;            // {'named'}
}
```

### Tracking Sets en Slicer

```typescript
class Slicer {
  // Declaraciones que deben extraerse
  private requiredDeclarations = new Set<ts.Declaration>();

  // Símbolos ya visitados (prevenir ciclos)
  private visitedSymbols = new Set<ts.Symbol>();
}
```

### Analysis Sets en IdentifierAnalyzer

```typescript
class IdentifierAnalyzer {
  // Identificadores usados como valores (runtime)
  private usedValueIdentifiers = new Set<string>();

  // Identificadores usados como tipos (compile-time)
  private usedTypeIdentifiers = new Set<string>();

  // Identificadores declarados localmente
  private declaredIdentifiers = new Set<string>();
}
```

---

## 🧮 Algoritmos Clave

### 1. Recolección Recursiva de Dependencias (DFS)

**Algoritmo**: Depth-First Search con memoization

**Complejidad**:
- Tiempo: O(V + E) donde V = símbolos, E = dependencias
- Espacio: O(V) para `visitedSymbols`

**Pseudocódigo**:

```
function collectDependencies(symbol):
    if symbol in visitedSymbols:
        return  # Prevenir ciclos

    add symbol to visitedSymbols

    declarations = getDeclarations(symbol)

    for each declaration in declarations:
        add declaration to requiredDeclarations

        body = getBody(declaration)

        identifiers = extractIdentifiers(body)

        for each identifier in identifiers:
            type = getType(identifier)
            childSymbol = getSymbol(type)

            if childSymbol exists:
                collectDependencies(childSymbol)  # RECURSIÓN
```

**Casos Edge**:

```typescript
// Caso 1: Dependencia circular
// A → B → C → A
// Solucionado por visitedSymbols Set

// Caso 2: Símbolos externos
// import { axios } from 'axios'
// No tienen declaraciones en el proyecto → skip

// Caso 3: Símbolos built-in
// Promise, Array, Map
// Son globales → no necesitan import → skip
```

---

### 2. Context Tracking en AST Traversal

**Problema**: TypeScript usa identificadores en dos contextos:
- **Tipo**: No existe en runtime (`: Type`, `<T>`, `interface`)
- **Valor**: Existe en runtime (`const x`, `new Class()`)

**Solución**: Propagación de contexto durante visitor pattern

**Algoritmo**:

```
function visitNode(node, isTypeContext):
    # Determinar contexto actual
    inTypeContext = isTypeContext OR isTypeContextNode(node)

    if node is Identifier:
        if inTypeContext:
            add to usedTypeIdentifiers
        else:
            add to usedValueIdentifiers

    # CASO ESPECIAL: new Expression
    if node is NewExpression:
        visitNode(node.expression, FALSE)      # Constructor = VALOR
        for typeArg in node.typeArguments:
            visitNode(typeArg, TRUE)           # Type args = TIPO
        for arg in node.arguments:
            visitNode(arg, FALSE)              # Args = VALOR
        return  # No continuar con forEachChild

    # Propagar contexto a hijos
    for child in node.children:
        visitNode(child, inTypeContext)
```

**Contextos de Tipo**:

```typescript
// isTypeContextNode(node):
ts.isTypeNode(node)                    // : Type
ts.isTypeParameterDeclaration(node)    // <T>
ts.isInterfaceDeclaration(node)        // interface I
ts.isTypeAliasDeclaration(node)        // type T = ...
```

**Ejemplo**:

```typescript
// Código:
function foo<T>(x: T): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(x);
  });
}

// Análisis:
// - T (en <T>): TIPO
// - T (en x: T): TIPO
// - T (en Promise<T>): TIPO
// - Promise (en new Promise): VALOR ← Caso especial new!
// - T (en Promise<T> dentro de new): TIPO
// - resolve: VALOR
// - x: VALOR
```

---

### 3. Resolución de Re-exports

**Problema**: `index.ts` re-exporta símbolos de otros archivos

```typescript
// index.ts
export * from './math';
export * from './string';

// Cuando se importa:
import { add } from './index';

// ¿Dónde está 'add' realmente?
```

**Solución**: TypeChecker traversal

**Algoritmo**:

```
function resolveSymbolSource(filePath, symbolName):
    sourceFile = getSourceFile(filePath)
    moduleSymbol = getSymbolAtLocation(sourceFile)
    exports = getExportsOfModule(moduleSymbol)

    for export in exports:
        if export.name == symbolName:
            declarations = export.getDeclarations()
            declarationFile = declarations[0].getSourceFile().fileName

            # Normalizar a absoluto
            if not isAbsolute(declarationFile):
                declarationFile = resolve(declarationFile)

            if declarationFile != filePath:
                return declarationFile  # Re-export
            else:
                return filePath         # Mismo archivo

    return null  # No encontrado
```

**Complejidad**: O(n) donde n = número de exports en el módulo

---

### 4. Normalización de Paths

**Problema**: TypeScript devuelve paths relativos o absolutos inconsistentemente

**Solución**: Normalización temprana a formato absoluto

**Casos**:

```typescript
// TypeScript puede devolver:
'src/utils.ts'                          // Relativo al CWD
'./src/utils.ts'                        // Relativo al proyecto
'/home/user/project/src/utils.ts'      // Absoluto

// Normalización:
function normalizePath(filePath: string): string {
  if (!path.isAbsolute(filePath)) {
    return path.resolve(filePath);
  }
  return filePath;
}

// Resultado consistente:
'/home/user/project/src/utils.ts'      // Siempre absoluto
```

**Lugares donde se aplica**:

1. `ReexportResolver.resolveSymbolSource()`: Al obtener `declarationFile`
2. `ImportResolver.resolveImports()`: Al calcular `modulePath`
3. `Slicer`: Al comparar archivos en `allExtractedFiles`

---

### 5. Path Alias Resolution

**Problema**: Convertir `@/utils` a ruta absoluta

**Algoritmo**:

```
# tsconfig.json:
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "~/utils/*": ["src/utils/*"]
    }
  }
}

# extractPathAliases():
pathAliases = Map()

for (alias, mappings) in compilerOptions.paths:
    cleanAlias = alias.replace('/*', '')      # '@/'  → '@'
    cleanMapping = mappings[0].replace('/*', '')  # 'src/*' → 'src'
    absolutePath = resolve(configDir, baseUrl, cleanMapping)

    pathAliases.set(cleanAlias, absolutePath)

# Resultado:
# '@' → '/abs/path/to/project/src'
# '~/utils' → '/abs/path/to/project/src/utils'

# isPathAlias(importPath):
for (alias, absPath) in pathAliases:
    if importPath.startsWith(alias + '/'):
        return true
return false

# resolvePathAlias(importPath):
for (alias, absPath) in pathAliases:
    if importPath.startsWith(alias + '/'):
        remainder = importPath.substring(alias.length + 1)
        return join(absPath, remainder)
return null
```

**Ejemplo**:

```typescript
// Import: '@/utils/math'
// Alias: '@' → '/project/src'
// Resultado: '/project/src/utils/math'
```

---

## 🛠️ Guía de Desarrollo

### Setup del Entorno

```bash
# 1. Clonar repositorio
git clone https://github.com/tirio/libextract.git
cd libextract

# 2. Instalar dependencias
npm install

# 3. Compilar TypeScript
npm run tsc

# 4. Ejecutar en modo desarrollo
npm start

# 5. Ejecutar con argumentos custom
ts-node src/slicer.ts -p <proyecto> -f <archivo> -s <símbolo> -o <output>

# Ejemplo:
ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction -o ./output
```

### Estructura de Directorios

```
@tirio/libextract/
├── src/
│   ├── slicer.ts                  # Entry point + CLI + orquestación
│   └── utils/
│       ├── projectDetector.ts      # Detección de ambiente
│       ├── identifierAnalyzer.ts   # Análisis de AST
│       ├── importResolver.ts       # Resolución de imports
│       ├── reexportResolver.ts     # Resolución de re-exports
│       ├── importGenerator.ts      # Generación de imports
│       └── manifestGenerator.ts    # Generación de manifiestos
├── test-project/                   # Proyecto de prueba
├── test-output/                    # Output de pruebas
├── tmp/                            # Output temporal (tirio-front tests)
├── package.json
├── tsconfig.json
├── README.md                       # Documentación usuario final
├── README_DEV.md                   # Documentación desarrolladores (este archivo)
└── CHANGELOG.md                    # Historial de cambios
```

### Añadir Nueva Funcionalidad

#### 1. Identificar Módulo

Pregúntate: ¿Esta feature pertenece a...?
- **Detection**: Detectar nuevo ambiente/package manager → `projectDetector.ts`
- **Analysis**: Nuevo tipo de nodo AST → `identifierAnalyzer.ts`
- **Resolution**: Nuevo tipo de import → `importResolver.ts`
- **Generation**: Nuevo formato de output → `manifestGenerator.ts`
- **Core**: Cambio en algoritmo de recolección → `slicer.ts`

#### 2. Actualizar Tipos

```typescript
// Ejemplo: Agregar soporte para Yarn PnP

// En projectDetector.ts:
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'yarn-pnp' | 'none';

// Actualizar lógica:
private detectPackageManager(): PackageManager {
  if (fs.existsSync(path.join(this.projectRoot, '.pnp.cjs'))) {
    return 'yarn-pnp';
  }
  // ... resto
}
```

#### 3. Implementar Lógica

```typescript
// Ejemplo: Soporte para Bun imports

// En importResolver.ts:
private classifyImport(importPath: string): ImportType {
  // ... código existente

  if (importPath.startsWith('bun:')) {
    return 'builtin';  // bun:test, bun:ffi, etc.
  }

  // ... resto
}
```

#### 4. Testing

```typescript
// Crear test case
// test-project/src/newFeature.ts

export function testBunImport() {
  // import { test } from 'bun:test';
}

// Ejecutar:
ts-node src/slicer.ts -p ./test-project -f ./test-project/src/newFeature.ts -s testBunImport -o ./output

// Verificar output
cat ./output/src/newFeature.ts
```

#### 5. Documentar

- Actualizar `README.md`: Añadir ejemplo de uso
- Actualizar `README_DEV.md`: Explicar implementación
- Añadir comentarios en código
- Actualizar `CHANGELOG.md`

---

## 🧪 Testing

### Test Strategy

```
┌─────────────────────────────────────────┐
│          Testing Pyramid                │
│                                         │
│         ┌───────────────┐               │
│         │   E2E Tests   │               │
│         │  (Manual)     │               │
│         └───────────────┘               │
│       ┌───────────────────┐             │
│       │ Integration Tests │             │
│       │   (Planned)       │             │
│       └───────────────────┘             │
│   ┌───────────────────────────┐         │
│   │     Unit Tests            │         │
│   │    (Planned)              │         │
│   └───────────────────────────┘         │
└─────────────────────────────────────────┘
```

### Test Cases Actuales (Manual)

#### Test Project: Casos Básicos

**Ubicación**: `./test-project/`

**Casos Cubiertos**:

```typescript
// 1. Imports relativos
// src/main.ts → src/utils.ts
import { getUserApi } from './utils';

// 2. Imports de tipos
// src/main.ts → src/types.ts
import { User, UserRole } from './types';

// 3. Constructores con new
// src/main.ts
const dp = new DecoupledPromise<Result>();

// 4. Destructuring
// src/main.ts
const { fine, promise } = new DecoupledPromise();

// 5. Funciones locales
// src/main.ts
function localHelper() { ... }
```

**Comando de Test**:

```bash
npm start
# Equivalente a:
# ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction
```

**Output Esperado**:

```
✅ test-output/src/main.ts (imports: getUserApi, User, UserRole, DecoupledPromise)
✅ test-output/src/utils.ts
✅ test-output/src/types.ts
✅ test-output/src/DecoupledPromise.ts
```

#### Real Project: tirio-front

**Casos Cubiertos**:

```typescript
// 1. Path aliases
// @/feats/stateStore → src/feats/stateStore
import { useStore } from '@/feats/stateStore/useStore';

// 2. Project references
// tsconfig.json → tsconfig.app.json, tsconfig.node.json

// 3. Re-exports via index.ts
// @/utils/signals → src/utils/signals/index.ts → createSignalMutable.ts

// 4. External dependencies
// import { Accessor, createSignal } from 'solid-js';
// import { MD5 } from 'crypto-js';

// 5. Complex type dependencies
// TransformToEventFunction, EventFunction, Registry, etc.
```

**Comando de Test**:

```bash
ts-node src/slicer.ts \
  -p ../../tirio-front/ \
  -f ../../tirio-front/src/feats/stateSystem/Events.ts \
  -s \* \
  -o tmp/
```

**Output Esperado**:

```
✅ tmp/src/feats/stateSystem/Events.ts
✅ tmp/src/feats/stateSystem/types.ts
✅ tmp/src/feats/stateSystem/TaskUnit.ts
✅ tmp/src/utils/core/DecoupledPromise.ts
✅ tmp/src/feats/stateStore/useStore.ts
✅ tmp/src/utils/signals/createSignalMutable.ts
📦 tmp/package.json (solid-js, crypto-js)
📄 tmp/DEPENDENCIES.md
```

### Unit Tests (Planificado)

```typescript
// Ejemplo con Vitest

import { describe, it, expect } from 'vitest';
import { IdentifierAnalyzer } from '../src/utils/identifierAnalyzer';
import ts from 'typescript';

describe('IdentifierAnalyzer', () => {
  it('should detect identifier in new expression', () => {
    const code = `
      const foo = new MyClass<Type>();
    `;

    const sourceFile = ts.createSourceFile(
      'test.ts', code, ts.ScriptTarget.Latest
    );

    const analyzer = new IdentifierAnalyzer();
    const result = analyzer.analyzeNodes([sourceFile]);

    expect(result.usedValues.has('MyClass')).toBe(true);
    expect(result.usedTypes.has('Type')).toBe(true);
  });

  it('should distinguish types from values', () => {
    const code = `
      const x: MyType = getValue();
    `;

    const sourceFile = ts.createSourceFile(
      'test.ts', code, ts.ScriptTarget.Latest
    );

    const analyzer = new IdentifierAnalyzer();
    const result = analyzer.analyzeNodes([sourceFile]);

    expect(result.usedTypes.has('MyType')).toBe(true);
    expect(result.usedValues.has('getValue')).toBe(true);
    expect(result.usedValues.has('MyType')).toBe(false);
  });
});
```

### Integration Tests (Planificado)

```typescript
// test/integration/extraction.test.ts

describe('Full Extraction Flow', () => {
  it('should extract function with dependencies', async () => {
    const outputDir = await runExtraction({
      projectPath: './fixtures/simple-project',
      entryFile: './fixtures/simple-project/src/index.ts',
      symbol: 'myFunction',
      outputDir: './test-output'
    });

    // Verificar archivos generados
    expect(fs.existsSync(path.join(outputDir, 'src/index.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'src/utils.ts'))).toBe(true);

    // Verificar imports
    const content = fs.readFileSync(path.join(outputDir, 'src/index.ts'), 'utf-8');
    expect(content).toContain('import { helper } from \'./utils\'');

    // Verificar package.json
    const pkg = JSON.parse(fs.readFileSync(path.join(outputDir, 'package.json'), 'utf-8'));
    expect(pkg.dependencies).toBeDefined();
  });
});
```

---

## 🔍 Debugging

### Estrategias de Debugging

#### 1. Logging Estratégico

```typescript
// En IdentifierAnalyzer:
private visitNode(node: ts.Node, isTypeContext: boolean): void {
  console.log('[visitNode]', {
    kind: ts.SyntaxKind[node.kind],
    isTypeContext,
    text: node.getText()
  });

  // ... resto del código
}

// En ImportGenerator:
for (const identifier of externalIdentifiers) {
  console.log('[generateImports] Processing:', identifier);

  const importInfo = this.importResolver.findImportInfo(identifier);
  console.log('  → ImportInfo:', importInfo);

  // ... resto
}
```

#### 2. TypeChecker Inspection

```typescript
// Inspeccionar tipo de un nodo
const type = checker.getTypeAtLocation(node);
console.log('Type:', checker.typeToString(type));

// Inspeccionar símbolo
const symbol = checker.getSymbolAtLocation(node);
if (symbol) {
  console.log('Symbol:', {
    name: symbol.getName(),
    flags: ts.SymbolFlags[symbol.getFlags()],
    declarations: symbol.getDeclarations()?.length
  });
}

// Inspeccionar exports de un módulo
const exports = checker.getExportsOfModule(moduleSymbol);
console.log('Exports:', Array.from(exports).map(e => e.getName()));
```

#### 3. AST Visualization

Usar [TypeScript AST Viewer](https://ts-ast-viewer.com/) para entender estructura:

```typescript
// Código:
const x = new MyClass<Type>();

// AST:
VariableDeclaration
  └─ NewExpression
       ├─ Identifier "MyClass"
       ├─ TypeArguments
       │    └─ TypeReference
       │         └─ Identifier "Type"
       └─ Arguments []
```

#### 4. Breakpoints en VSCode

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Slicer",
      "runtimeArgs": [
        "-r", "ts-node/register"
      ],
      "args": [
        "${workspaceFolder}/src/slicer.ts",
        "-p", "./test-project",
        "-f", "./test-project/src/main.ts",
        "-s", "mainFunction",
        "-o", "./debug-output"
      ],
      "cwd": "${workspaceFolder}",
      "protocol": "inspector"
    }
  ]
}
```

#### 5. Comparación de Output

```bash
# Generar output
ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction -o ./output1

# Hacer cambios

# Generar nuevo output
ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction -o ./output2

# Comparar
diff -r ./output1 ./output2
```

---

## 🐛 Bugs Conocidos y Soluciones

### Bug #1: Constructores `new` no detectados ✅ RESUELTO

**Fecha**: 2025-01-XX

**Síntoma**:

```typescript
// Input:
const dp = new DecoupledPromise<T>();

// Output (INCORRECTO):
// ❌ Falta: import { DecoupledPromise } from './DecoupledPromise';
```

**Causa Raíz**:

El `IdentifierAnalyzer.visitNode()` no tenía manejo especial para `ts.isNewExpression()`. Cuando procesaba:

```typescript
new DecoupledPromise<T>()
```

El `ts.forEachChild()` no visitaba el identificador del constructor correctamente.

**Diagnóstico**:

```typescript
// usedValueIdentifiers NO contenía 'DecoupledPromise'
// usedTypeIdentifiers contenía 'T'
// Resultado: Import no generado
```

**Solución Implementada**:

```typescript
private visitNode(node: ts.Node, isTypeContext: boolean): void {
  // ... código existente

  // CASO ESPECIAL: new expressions
  if (ts.isNewExpression(node)) {
    // Visitar expresión del constructor como VALOR
    if (node.expression) {
      this.visitNode(node.expression, false);  // DecoupledPromise = VALOR
    }

    // Visitar type arguments como TIPOS
    if (node.typeArguments) {
      for (const typeArg of node.typeArguments) {
        this.visitNode(typeArg, true);  // T = TIPO
      }
    }

    // Visitar argumentos como VALORES
    if (node.arguments) {
      for (const arg of node.arguments) {
        this.visitNode(arg, false);
      }
    }

    return;  // IMPORTANTE: No usar forEachChild
  }

  // ... resto
}
```

**Testing**:

```bash
# Antes del fix:
ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction -o ./output
# Output: 2 imports (falta DecoupledPromise)

# Después del fix:
ts-node src/slicer.ts -p ./test-project -f ./test-project/src/main.ts -s mainFunction -o ./output
# Output: 3 imports (incluye DecoupledPromise) ✅
```

**Lecciones Aprendidas**:

1. `ts.forEachChild()` no es confiable para todos los nodos
2. Algunos nodos requieren traversal manual
3. Contexto debe manejarse explícitamente (tipo vs valor)
4. Testing con casos reales es crítico

---

### Bug #2: Paths Relativos en ReexportResolver ✅ RESUELTO

**Fecha**: 2025-01-XX

**Síntoma**:

```typescript
// Import detectado correctamente
// Pero NO se generaba en output

console.log('finalModulePath:', 'test-project/src/DecoupledPromise.ts');  // RELATIVO
console.log('allExtractedFiles:', ['/abs/path/test-project/src/DecoupledPromise.ts']);  // ABSOLUTO
console.log('has():', false);  // ❌ Mismatch
```

**Causa Raíz**:

`ReexportResolver.resolveSymbolSource()` retornaba `declaration.getSourceFile().fileName`, que TypeScript puede devolver como path relativo.

**Diagnóstico**:

```typescript
// ReexportResolver:
const declarationFile = declaration.getSourceFile().fileName;
// Devuelve: 'test-project/src/DecoupledPromise.ts'  (relativo al CWD)

// ImportGenerator:
if (allExtractedFiles.has(finalModulePath)) {  // false ❌
  // No se ejecuta
}
```

**Solución Implementada**:

```typescript
// En ReexportResolver.resolveSymbolSource():
let declarationFile = declaration.getSourceFile().fileName;

// Normalizar a ruta absoluta
if (!path.isAbsolute(declarationFile)) {
  declarationFile = path.resolve(declarationFile);
}
// Ahora: '/abs/path/test-project/src/DecoupledPromise.ts'  ✅
```

**Testing**:

```bash
# Verificar paths
ts-node src/slicer.ts ... 2>&1 | grep "finalModulePath"
# Antes: test-project/src/DecoupledPromise.ts
# Después: /abs/path/test-project/src/DecoupledPromise.ts ✅
```

**Lecciones Aprendidas**:

1. Nunca asumir que TypeScript devuelve paths absolutos
2. Normalizar paths temprano en el flujo
3. Usar `path.isAbsolute()` + `path.resolve()` consistentemente
4. Logging de paths ayuda a detectar este tipo de bugs

---

## 🗺️ Roadmap

### v1.0.0 - MVP ✅ COMPLETADO

- [x] Extracción básica de símbolos
- [x] Análisis de dependencias transitivas
- [x] Soporte para Node.js
- [x] Generación de package.json
- [x] Path aliases básicos
- [x] TypeScript Project References
- [x] Distinción tipo vs valor
- [x] Manejo de constructores `new`
- [x] Resolución de re-exports
- [x] Soporte para Deno y Bun
- [x] Reporte de dependencias (DEPENDENCIES.md)

### v1.1.0 - Mejoras de UX (Planificado)

- [ ] Progress bar para proyectos grandes
- [ ] Dry-run mode (preview sin escribir archivos)
- [ ] Config file support (`.libextractrc`)
- [ ] Mensajes de error más descriptivos
- [ ] Watch mode (re-extraer en cambios)
- [ ] Colored output
- [ ] Summary statistics al final

### v1.2.0 - JavaScript Support (Planificado)

- [ ] Soporte completo para JavaScript puro
- [ ] JSDoc type analysis
- [ ] CommonJS mejor soporte
- [ ] Dynamic imports (`import()`)

### v2.0.0 - Features Avanzadas (Planificado)

- [ ] Web UI para visualización de dependencias
- [ ] Graph visualization (D3.js, Cytoscape)
- [ ] Plugin system para custom transformations
- [ ] Export to different formats (ESM, CommonJS, UMD)
- [ ] Bundle size analysis
- [ ] Circular dependency detection y warnings
- [ ] Code coverage integration

### v3.0.0 - Performance & Scale (Planificado)

- [ ] Incremental compilation support
- [ ] Cache de análisis
- [ ] Parallel processing de archivos (Worker threads)
- [ ] Lazy loading de módulos
- [ ] Memory optimizations para proyectos > 10k archivos
- [ ] Streaming output para proyectos muy grandes

### Features Pendientes (Backlog)

- [ ] Soporte para `export * from` (re-exports comodín)
- [ ] Mejor manejo de namespace imports
- [ ] Type-only imports más inteligente
- [ ] Source maps generation
- [ ] Minification integration
- [ ] Git integration (extract desde commits específicos)
- [ ] Monorepo support (Lerna, Nx, Turborepo)
- [ ] Docker containerization
- [ ] GitHub Action integration

---

## 🎨 Decisiones de Diseño

### ¿Por qué TypeScript Compiler API?

**Alternativas Consideradas**:

1. **Babel Parser**: Solo AST, sin type checking
2. **ts-morph**: Wrapper sobre TypeScript, más alto nivel
3. **SWC**: Parser en Rust, muy rápido pero sin type checking
4. **Acorn/ESLint Parser**: Solo JavaScript

**Decisión**: TypeScript Compiler API

**Razones**:

- ✅ **Acceso completo al AST**: Todos los nodos de TypeScript
- ✅ **Type checking semántico**: `TypeChecker` permite resolver símbolos
- ✅ **Resolución de módulos nativa**: Entiende path aliases, project references
- ✅ **Soporte para features modernos**: Decorators, satisfies, etc.
- ✅ **Source of truth**: Es el compilador oficial de TypeScript
- ❌ API de bajo nivel (verbosa)
- ❌ Documentación escasa

---

### ¿Por qué Visitor Pattern?

**Alternativas Consideradas**:

1. **Iteración manual**: `for` loops anidados
2. **Recursión simple**: Función recursiva sin pattern
3. **Transformer API**: TypeScript transformers

**Decisión**: Visitor Pattern con `ts.forEachChild()`

**Razones**:

- ✅ **Escalable**: Fácil añadir nuevos tipos de nodos
- ✅ **Separation of concerns**: Cada tipo de nodo se maneja independientemente
- ✅ **Testeable**: Fácil probar casos específicos
- ✅ **Idiomático**: Es el pattern recomendado por TypeScript
- ❌ Requiere entender el AST profundamente

---

### ¿Por qué Normalización de Paths?

**Problema**: TypeScript devuelve paths inconsistentes (relativos/absolutos)

**Decisión**: Normalizar todos los paths a absolutos internamente

**Razones**:

- ✅ **Consistencia**: Comparaciones con `===` funcionan
- ✅ **Evita bugs**: Mismatch de paths relativos/absolutos
- ✅ **Platform-independent**: Funciona igual en Windows/Unix
- ✅ **Debugging más fácil**: Paths completos son más claros
- ❌ Overhead mínimo de conversión

**Implementación**:

```typescript
// En todos los módulos que manejan paths:
if (!path.isAbsolute(filePath)) {
  filePath = path.resolve(filePath);
}
```

---

### ¿Por qué Separar Tipo vs Valor?

**Problema**: TypeScript usa identificadores en dos contextos diferentes

**Decisión**: Context tracking durante AST traversal

**Razones**:

- ✅ **Correctness**: Genera imports correctos según el uso
- ✅ **Type erasure**: Los tipos no existen en runtime (pero sí en compile-time)
- ✅ **Evita imports innecesarios**: No importar tipos que solo se usan en anotaciones
- ✅ **TypeScript best practices**: `import type` vs `import`
- ❌ Mayor complejidad en el analyzer

**Trade-off**: Decidimos importar TODOS (tipos + valores) porque TypeScript los necesita en compile-time, aunque no en runtime.

---

## 🤝 Contribuir

### Code Style

```typescript
// ✅ GOOD
function extractSymbol(symbolName: string): Map<string, ts.Declaration[]> {
  const result = new Map();
  // ...
  return result;
}

// ❌ BAD
function extract_symbol(symbol_name) {
  var result = new Map();
  // ...
  return result;
}
```

**Reglas**:

- TypeScript strict mode
- ESLint rules (cuando se configure)
- Naming conventions:
  - Classes: `PascalCase` (ej. `IdentifierAnalyzer`)
  - Functions/variables: `camelCase` (ej. `visitNode`)
  - Constants: `UPPER_SNAKE_CASE` (ej. `MAX_TASKS`)
  - Files: `camelCase.ts` (ej. `importResolver.ts`)
  - Private members: prefijo `_` (ej. `private _cache`)

### Proceso de Pull Request

1. **Fork** el repositorio
2. **Crear branch**: `git checkout -b feature/nombre-descriptivo`
3. **Hacer cambios**:
   - Escribir código
   - Añadir/actualizar tests
   - Actualizar documentación
4. **Commits descriptivos**:
   ```
   feat: Add support for Bun imports

   - Detect bun: protocol in import classifier
   - Add Bun to builtin types
   - Update tests
   ```
5. **Push**: `git push origin feature/nombre-descriptivo`
6. **Crear PR** con descripción detallada:
   ```markdown
   ## Descripción
   Agrega soporte para imports de Bun (bun:test, bun:ffi, etc.)

   ## Cambios
   - Modified: importResolver.ts
   - Added: test cases for Bun imports
   - Updated: README.md

   ## Testing
   - [ ] Unit tests pass
   - [ ] Manual testing with Bun project
   - [ ] No regressions

   ## Screenshots
   [Si aplica]
   ```

### Reportar Bugs

**Template de Issue**:

```markdown
## Descripción del Bug
[Descripción clara y concisa]

## Pasos para Reproducir
1. Ejecutar `libextract -p ... -f ... -s ... -o ...`
2. Ver error en ...
3. ...

## Comportamiento Esperado
[Qué debería pasar]

## Comportamiento Actual
[Qué está pasando]

## Ambiente
- OS: [e.g. Ubuntu 22.04]
- Node.js: [e.g. 20.10.0]
- TypeScript: [e.g. 5.3.3]
- @tirio/libextract: [e.g. 1.0.0]

## Logs
```
[Paste output aquí]
```

## Archivos Adicionales
[Links a gists, repos de prueba, etc.]
```

---

## 📚 Glosario

| Término | Definición |
|---------|------------|
| **Symbol** | Representación semántica de una entidad en TypeScript (variable, función, clase, tipo) obtenida via `TypeChecker` |
| **Declaration** | Nodo del AST donde se declara un símbolo (`ts.Declaration`) |
| **Identifier** | Nombre de una variable/función/tipo en el código (`ts.Identifier`) |
| **Re-export** | Exportar algo que fue importado: `export { X } from './other'` |
| **Path Alias** | Mapeo en tsconfig: `"@/*": ["src/*"]` |
| **Project Reference** | Multi-proyecto TypeScript con `references` en tsconfig.json |
| **Tree-shaking** | Eliminación automática de código no usado |
| **AST** | Abstract Syntax Tree - Representación del código como árbol |
| **Type Context** | Contexto donde un identificador se usa como tipo (`: Type`, `<T>`) |
| **Value Context** | Contexto donde un identificador se usa como valor (`const x`, `new Class`) |
| **Transitive Dependency** | Dependencia indirecta: A depende de B, B depende de C → A depende transitivamente de C |
| **Module Specifier** | String en un import: `'./utils'`, `'axios'` |
| **Module Path** | Ruta absoluta del archivo: `/abs/path/utils.ts` |

---

## 📖 Referencias

### Documentación Oficial

- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [ts.SyntaxKind Reference](https://typescript-compiler-api.vercel.app/syntax-kinds)

### Herramientas

- [TypeScript AST Viewer](https://ts-ast-viewer.com/) - Visualizar AST de código TypeScript
- [TypeScript Playground](https://www.typescriptlang.org/play) - Probar código TypeScript online

### Proyectos Relacionados

- [ts-morph](https://github.com/dsherret/ts-morph) - Wrapper de alto nivel sobre TypeScript Compiler API
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) - Análisis de dependencias para JavaScript/TypeScript
- [Madge](https://github.com/pahen/madge) - Generador de grafos de dependencias

### Artículos y Tutoriales

- [How to use the TypeScript AST](https://levelup.gitconnected.com/how-to-use-the-typescript-ast-7eaa7f8a8e8e)
- [Writing a TypeScript Transformer](https://dev.to/itsjavi/writing-a-typescript-transformer-2d3c)
- [Deep Dive into TypeScript Compiler](https://blog.logrocket.com/deep-dive-typescript-compiler/)

---

## 📝 Notas Finales

Este proyecto fue desarrollado con asistencia de **IA (Claude Code by Anthropic)**. El proceso de desarrollo incluyó:

- Arquitectura diseñada colaborativamente entre humano y IA
- Implementación de algoritmos complejos con debugging asistido
- Resolución de bugs críticos mediante análisis detallado
- Documentación exhaustiva generada automáticamente

La combinación de expertise humano en TypeScript y la capacidad de análisis de la IA resultó en un proyecto robusto, bien documentado, y mantenible.

---

**Versión de este documento**: 1.0.0
**Última actualización**: 2025-01-15
**Mantenedores**: [Tu nombre/equipo]
**Licencia**: ISC

---

**¿Tienes preguntas sobre la arquitectura? ¿Quieres contribuir?** Abre un issue o PR en GitHub. ¡Toda contribución es bienvenida! 🚀
