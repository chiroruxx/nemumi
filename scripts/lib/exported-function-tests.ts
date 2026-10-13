import ts from 'typescript';

type UntestedExport = {
  file: string;
  name: string;
  line: number;
};

// This is a static check for direct calls in node:test callbacks. Assertions and
// whether a call actually executes remain the responsibility of tests and review.
export function findUntestedExports(
  program: ts.Program,
  files: { sources: string[]; tests: string[] },
): UntestedExport[] {
  const checker = program.getTypeChecker();
  const exported = new Map<ts.Symbol, UntestedExport>();
  const tested = new Set<ts.Symbol>();

  function resolveSymbol(symbol: ts.Symbol): ts.Symbol {
    return symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  }

  function expressionSymbol(expression: ts.Expression) {
    return checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(expression) ? expression.name : expression,
    );
  }

  for (const file of files.sources) {
    const source = program.getSourceFile(file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!source || !module) continue;
    for (const symbol of checker.getExportsOfModule(module)) {
      if (
        symbol.declarations?.some(
          (declaration) =>
            ts.isExportSpecifier(declaration) &&
            (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly),
        )
      )
        continue;
      const target = resolveSymbol(symbol);
      const declaration = target.valueDeclaration;
      if (!declaration) continue;
      const type = checker.getTypeOfSymbolAtLocation(target, declaration);
      if (!type.getCallSignatures().length) continue;
      // Re-exports refer to the same function and need only one direct test.
      if (exported.has(target)) continue;
      const position = source.getLineAndCharacterOfPosition(
        symbol.declarations?.[0]?.getSourceFile() === source
          ? symbol.declarations[0].getStart(source)
          : 0,
      );
      exported.set(target, {
        file,
        name: symbol.name,
        line: position.line + 1,
      });
    }
  }

  for (const file of files.tests) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const testFunctions = new Set<ts.Symbol>();
    const testNamespaces = new Set<ts.Symbol>();

    function remember(name: ts.Identifier, symbols: Set<ts.Symbol>) {
      const symbol = checker.getSymbolAtLocation(name);
      if (symbol) symbols.add(symbol);
    }

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== 'node:test' ||
        statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
      )
        continue;
      const clause = statement.importClause;
      if (clause?.name) remember(clause.name, testFunctions);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        remember(bindings.name, testNamespaces);
      } else if (bindings) {
        for (const binding of bindings.elements) {
          if (
            !binding.isTypeOnly &&
            ['test', 'it'].includes((binding.propertyName ?? binding.name).text)
          ) {
            remember(binding.name, testFunctions);
          }
        }
      }
    }

    function isTest(expression: ts.Expression): boolean {
      const symbol = expressionSymbol(expression);
      if (symbol && testFunctions.has(symbol)) return true;
      if (ts.isPropertyAccessExpression(expression)) {
        if (['only', 'skip', 'todo'].includes(expression.name.text))
          return isTest(expression.expression);
        const owner = expressionSymbol(expression.expression);
        return Boolean(
          owner &&
            testNamespaces.has(owner) &&
            ['test', 'it'].includes(expression.name.text),
        );
      }
      return false;
    }

    function isDisabled(node: ts.CallExpression) {
      return (
        (ts.isPropertyAccessExpression(node.expression) &&
          ['skip', 'todo'].includes(node.expression.name.text)) ||
        node.arguments.some(
          (argument) =>
            ts.isObjectLiteralExpression(argument) &&
            argument.properties.some(
              (property) =>
                ts.isPropertyAssignment(property) &&
                ['skip', 'todo'].includes(
                  property.name.getText(source).replaceAll(/['"]/g, ''),
                ) &&
                property.initializer.kind !== ts.SyntaxKind.FalseKeyword,
            ),
        )
      );
    }

    function collectCalls(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        if (isTest(node.expression) && isDisabled(node)) return;
        const symbol = expressionSymbol(node.expression);
        if (symbol) tested.add(resolveSymbol(symbol));
      }
      ts.forEachChild(node, collectCalls);
    }

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && isTest(node.expression)) {
        // Do not enter disabled tests, including their nested subtests.
        if (isDisabled(node)) return;
        for (const argument of node.arguments) {
          if (
            ts.isArrowFunction(argument) ||
            ts.isFunctionExpression(argument)
          ) {
            collectCalls(argument.body);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }

  return [...exported]
    .filter(([symbol]) => !tested.has(symbol))
    .map(([, entry]) => entry);
}
