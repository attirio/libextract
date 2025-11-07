import * as ts from 'typescript';

/**
 * Analiza un nodo AST y extrae todos los identificadores usados
 * distinguiendo entre tipos y valores
 */
export class IdentifierAnalyzer {
  private usedValueIdentifiers = new Set<string>();
  private usedTypeIdentifiers = new Set<string>();
  private declaredIdentifiers = new Set<string>();
  private checker: ts.TypeChecker | null = null;

  /**
   * Configura el TypeChecker para análisis semántico
   */
  public setTypeChecker(checker: ts.TypeChecker): void {
    this.checker = checker;
  }

  /**
   * Analiza un conjunto de nodos y retorna los identificadores usados
   */
  public analyzeNodes(nodes: ts.Declaration[]): {
    usedValues: Set<string>;
    usedTypes: Set<string>;
    declared: Set<string>;
  } {
    this.usedValueIdentifiers = new Set<string>();
    this.usedTypeIdentifiers = new Set<string>();
    this.declaredIdentifiers = new Set<string>();

    for (const node of nodes) {
      this.visitNode(node, false);
    }

    return {
      usedValues: this.usedValueIdentifiers,
      usedTypes: this.usedTypeIdentifiers,
      declared: this.declaredIdentifiers,
    };
  }

  /**
   * Visita un nodo distinguiendo contexto de tipo vs valor
   * @param node Nodo a visitar
   * @param isTypeContext Si estamos en un contexto de tipo (anotación, genérico, etc.)
   */
  private visitNode(node: ts.Node, isTypeContext: boolean): void {
    // Primero, recopilar declaraciones locales
    this.collectDeclaredIdentifiers(node);

    // Determinar si estamos en contexto de tipo
    const inTypeContext = isTypeContext || this.isTypeContextNode(node);

    // Identificadores
    if (ts.isIdentifier(node)) {
      if (inTypeContext) {
        this.usedTypeIdentifiers.add(node.text);
      } else {
        this.usedValueIdentifiers.add(node.text);
      }
    }

    // Visitar hijos, pasando el contexto correcto
    ts.forEachChild(node, (child) => this.visitNode(child, inTypeContext));
  }

  /**
   * Determina si un nodo es un contexto de tipo
   */
  private isTypeContextNode(node: ts.Node): boolean {
    // Type annotations (: Type)
    if (ts.isTypeNode(node)) {
      return true;
    }

    // Type parameters (<T>)
    if (ts.isTypeParameterDeclaration(node)) {
      return true;
    }

    // Type assertions (as Type)
    if (ts.isAsExpression(node)) {
      // Solo el tipo es contexto de tipo, no la expresión
      return false; // Lo manejamos especialmente abajo
    }

    // Interface, type alias declarations
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      return true;
    }

    return false;
  }

  private collectDeclaredIdentifiers(node: ts.Node): void {
    // Variables declaradas (let, const, var)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      this.declaredIdentifiers.add(node.name.text);
    }

    // Parámetros de función
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      this.declaredIdentifiers.add(node.name.text);
    }

    // Funciones declaradas
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      this.declaredIdentifiers.add(node.name.text);
    }

    // Clases declaradas
    if (ts.isClassDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      this.declaredIdentifiers.add(node.name.text);
    }

    // Interfaces y tipos
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      ts.isIdentifier(node.name)
    ) {
      this.declaredIdentifiers.add(node.name.text);
    }

    // Enums
    if (ts.isEnumDeclaration(node) && ts.isIdentifier(node.name)) {
      this.declaredIdentifiers.add(node.name.text);
    }
  }

  /**
   * Filtra identificadores usados, excluyendo:
   * - Declaraciones locales
   * - Palabras reservadas de TypeScript/JavaScript
   * - Tipos primitivos
   */
  public getExternalIdentifiers(
    usedValues: Set<string>,
    usedTypes: Set<string>,
    declared: Set<string>
  ): { values: Set<string>; types: Set<string> } {
    const externalValues = new Set<string>();
    const externalTypes = new Set<string>();
    const builtins = new Set([
      // Tipos primitivos
      'string',
      'number',
      'boolean',
      'void',
      'any',
      'unknown',
      'never',
      'undefined',
      'null',
      'bigint',
      'symbol',
      // Tipos de utilidad
      'Partial',
      'Required',
      'Readonly',
      'Record',
      'Pick',
      'Omit',
      'Exclude',
      'Extract',
      'NonNullable',
      'Parameters',
      'ConstructorParameters',
      'ReturnType',
      'InstanceType',
      'ThisType',
      // Clases globales
      'Object',
      'Array',
      'Map',
      'Set',
      'Promise',
      'Error',
      'Date',
      'RegExp',
      'Function',
      'String',
      'Number',
      'Boolean',
      // Métodos/propiedades comunes
      'console',
      'setTimeout',
      'setInterval',
      'clearTimeout',
      'clearInterval',
      'Math',
      'JSON',
      'parseInt',
      'parseFloat',
      'isNaN',
      'isFinite',
      // Palabras clave
      'this',
      'arguments',
      'super',
      'new',
      'typeof',
      'instanceof',
    ]);

    // Filtrar valores
    for (const identifier of usedValues) {
      if (declared.has(identifier)) continue;
      if (builtins.has(identifier)) continue;
      externalValues.add(identifier);
    }

    // Filtrar tipos
    for (const identifier of usedTypes) {
      if (declared.has(identifier)) continue;
      if (builtins.has(identifier)) continue;
      externalTypes.add(identifier);
    }

    return { values: externalValues, types: externalTypes };
  }
}
