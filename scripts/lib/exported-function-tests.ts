import ts from 'typescript';

type UntestedExport = {
  file: string;
  name: string;
  line: number;
};

type TestBindings = {
  functions: Set<ts.Symbol>;
  namespaces: Set<ts.Symbol>;
};

// This is a static check for direct calls in node:test callbacks. Assertions and
// whether a call actually executes remain the responsibility of tests and review.
export function findUntestedExports(
  program: ts.Program,
  files: { sources: string[]; tests: string[] },
): UntestedExport[] {
  const exported = collectExportedFunctions(program, files.sources);
  const tested = collectTestedFunctions(program, files.tests);

  return [...exported]
    .filter(([symbol]) => !tested.has(symbol))
    .map(([, entry]) => entry);
}

function collectExportedFunctions(program: ts.Program, files: string[]) {
  const checker = program.getTypeChecker();
  const exported = new Map<ts.Symbol, UntestedExport>();

  for (const file of files) {
    const source = program.getSourceFile(file);
    const module = source && checker.getSymbolAtLocation(source);
    if (!source || !module) continue;

    for (const symbol of checker.getExportsOfModule(module)) {
      if (isTypeOnlyExport(symbol)) continue;

      const target = resolveSymbol(checker, symbol);
      const declaration = target.valueDeclaration;
      if (!declaration) continue;
      const type = checker.getTypeOfSymbolAtLocation(target, declaration);
      if (!type.getCallSignatures().length || exported.has(target)) continue;

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

  return exported;
}

function isTypeOnlyExport(symbol: ts.Symbol) {
  return Boolean(
    symbol.declarations?.some(
      (declaration) =>
        ts.isExportSpecifier(declaration) &&
        (declaration.isTypeOnly || declaration.parent.parent.isTypeOnly),
    ),
  );
}

function collectTestedFunctions(program: ts.Program, files: string[]) {
  const checker = program.getTypeChecker();
  const tested = new Set<ts.Symbol>();

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const sourceFile = source;

    const bindings = collectTestBindings(checker, sourceFile);
    if (!bindings.functions.size && !bindings.namespaces.size) continue;

    function visit(node: ts.Node, insideTestCallback = false): void {
      if (ts.isCallExpression(node)) {
        if (isTestCall(node.expression, checker, bindings)) {
          if (isDisabledTest(node, sourceFile)) return;

          for (const argument of node.arguments) {
            if (
              ts.isArrowFunction(argument) ||
              ts.isFunctionExpression(argument)
            ) {
              visit(argument.body, true);
            }
          }
          return;
        }

        if (insideTestCallback) {
          const symbol = expressionSymbol(node.expression, checker);
          if (symbol) tested.add(resolveSymbol(checker, symbol));
        }
      }

      ts.forEachChild(node, (child) => visit(child, insideTestCallback));
    }

    visit(sourceFile);
  }

  return tested;
}

function collectTestBindings(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): TestBindings {
  const functions = new Set<ts.Symbol>();
  const namespaces = new Set<ts.Symbol>();

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
    if (clause?.name) remember(clause.name, functions);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      remember(bindings.name, namespaces);
    } else if (bindings) {
      for (const binding of bindings.elements) {
        if (
          !binding.isTypeOnly &&
          ['test', 'it'].includes((binding.propertyName ?? binding.name).text)
        ) {
          remember(binding.name, functions);
        }
      }
    }
  }

  return { functions, namespaces };
}

function isTestCall(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  bindings: TestBindings,
): boolean {
  const symbol = expressionSymbol(expression, checker);
  if (symbol && bindings.functions.has(symbol)) return true;

  if (!ts.isPropertyAccessExpression(expression)) return false;
  if (['only', 'skip', 'todo'].includes(expression.name.text)) {
    return isTestCall(expression.expression, checker, bindings);
  }

  const owner = expressionSymbol(expression.expression, checker);
  return Boolean(
    owner &&
      bindings.namespaces.has(owner) &&
      ['test', 'it'].includes(expression.name.text),
  );
}

function isDisabledTest(node: ts.CallExpression, source: ts.SourceFile) {
  return (
    (ts.isPropertyAccessExpression(node.expression) &&
      ['skip', 'todo'].includes(node.expression.name.text)) ||
    node.arguments.some(
      (argument) =>
        ts.isObjectLiteralExpression(argument) &&
        argument.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ['skip', 'todo'].includes(propertyName(property.name, source)) &&
            property.initializer.kind !== ts.SyntaxKind.FalseKeyword,
        ),
    )
  );
}

function propertyName(name: ts.PropertyName, source: ts.SourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText(source).replaceAll(/['"]/g, '');
}

function expressionSymbol(expression: ts.Expression, checker: ts.TypeChecker) {
  return checker.getSymbolAtLocation(
    ts.isPropertyAccessExpression(expression) ? expression.name : expression,
  );
}

function resolveSymbol(checker: ts.TypeChecker, symbol: ts.Symbol) {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}
