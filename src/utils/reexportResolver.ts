import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Resuelve re-exports (export * from) para encontrar el archivo original de un símbolo
 */
export class ReexportResolver {
  private program: ts.Program;
  private checker: ts.TypeChecker;

  constructor(program: ts.Program) {
    this.program = program;
    this.checker = program.getTypeChecker();
  }

  /**
   * Dado un archivo y un símbolo importado de él, encuentra el archivo real donde está definido
   * @param importedFilePath Ruta del archivo desde donde se importa (puede ser index.ts)
   * @param symbolName Nombre del símbolo importado
   * @returns Ruta absoluta del archivo real donde está definido el símbolo, o null si no se encuentra
   */
  public resolveSymbolSource(
    importedFilePath: string,
    symbolName: string
  ): string | null {
    const sourceFile = this.program.getSourceFile(importedFilePath);
    if (!sourceFile) return null;

    // Buscar export del símbolo en este archivo
    const symbol = this.checker.getSymbolAtLocation(sourceFile);
    if (!symbol) return null;

    const exports = this.checker.getExportsOfModule(symbol);

    for (const exportSymbol of exports) {
      if (exportSymbol.getName() === symbolName) {
        // Encontramos el símbolo, ahora verificar si es re-export
        const declarations = exportSymbol.getDeclarations();
        if (!declarations || declarations.length === 0) continue;

        const declaration = declarations[0];
        let declarationFile = declaration.getSourceFile().fileName;

        // Normalizar a ruta absoluta
        if (!path.isAbsolute(declarationFile)) {
          declarationFile = path.resolve(declarationFile);
        }

        // Si la declaración está en un archivo diferente, es un re-export
        if (declarationFile !== importedFilePath) {
          return declarationFile;
        }

        // Si está en el mismo archivo, retornar este
        return importedFilePath;
      }
    }

    // No se encontró el símbolo
    return null;
  }

  /**
   * Analiza un archivo index.ts y mapea qué símbolos vienen de qué archivos
   */
  public mapReexports(indexFilePath: string): Map<string, string> {
    const symbolToFile = new Map<string, string>();
    const sourceFile = this.program.getSourceFile(indexFilePath);
    if (!sourceFile) return symbolToFile;

    const symbol = this.checker.getSymbolAtLocation(sourceFile);
    if (!symbol) return symbolToFile;

    const exports = this.checker.getExportsOfModule(symbol);

    for (const exportSymbol of exports) {
      const declarations = exportSymbol.getDeclarations();
      if (!declarations || declarations.length === 0) continue;

      const declaration = declarations[0];
      const declarationFile = declaration.getSourceFile().fileName;

      symbolToFile.set(exportSymbol.getName(), declarationFile);
    }

    return symbolToFile;
  }
}
