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
    collectFileExports(program, checker, file, exported);
  }

  return exported;
}

function collectFileExports(
  program: ts.Program,
  checker: ts.TypeChecker,
  file: string,
  exported: Map<ts.Symbol, UntestedExport>,
) {
  const source = program.getSourceFile(file);
  if (!source) return;

  const module = checker.getSymbolAtLocation(source);
  if (!module) return;

  for (const symbol of checker.getExportsOfModule(module)) {
    const entry = getExportedFunctionEntry(checker, source, file, symbol);
    if (!entry) continue;

    const target = resolveSymbol(checker, symbol);
    if (!exported.has(target)) exported.set(target, entry);
  }
}

function getExportedFunctionEntry(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  file: string,
  symbol: ts.Symbol,
): UntestedExport | undefined {
  if (isTypeOnlyExport(symbol)) return;

  const target = resolveSymbol(checker, symbol);
  const declaration = target.valueDeclaration;
  if (!declaration) return;

  const type = checker.getTypeOfSymbolAtLocation(target, declaration);
  if (!type.getCallSignatures().length) return;

  const position = source.getLineAndCharacterOfPosition(
    symbol.declarations?.[0]?.getSourceFile() === source
      ? symbol.declarations[0].getStart(source)
      : 0,
  );
  return { file, name: symbol.name, line: position.line + 1 };
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

    const bindings = collectTestBindings(checker, source);
    if (!bindings.functions.size && !bindings.namespaces.size) continue;

    visitTestCalls(source, false, checker, bindings, source, tested);
  }

  return tested;
}

function visitTestCalls(
  node: ts.Node,
  insideTestCallback: boolean,
  checker: ts.TypeChecker,
  bindings: TestBindings,
  source: ts.SourceFile,
  tested: Set<ts.Symbol>,
): void {
  if (ts.isCallExpression(node)) {
    if (isTestCall(node.expression, checker, bindings)) {
      if (!isDisabledTest(node, source)) {
        visitTestCallbacks(node, checker, bindings, source, tested);
      }
      return;
    }

    if (insideTestCallback) {
      const symbol = expressionSymbol(node.expression, checker);
      if (symbol) tested.add(resolveSymbol(checker, symbol));
    }
  }

  ts.forEachChild(node, (child) =>
    visitTestCalls(
      child,
      insideTestCallback,
      checker,
      bindings,
      source,
      tested,
    ),
  );
}

function visitTestCallbacks(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  bindings: TestBindings,
  source: ts.SourceFile,
  tested: Set<ts.Symbol>,
) {
  for (const argument of node.arguments) {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      visitTestCalls(argument.body, true, checker, bindings, source, tested);
    }
  }
}

function collectTestBindings(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): TestBindings {
  const functions = new Set<ts.Symbol>();
  const namespaces = new Set<ts.Symbol>();

  for (const statement of source.statements) {
    const clause = nodeTestImportClause(statement);
    if (clause)
      collectTestImportBindings(checker, clause, functions, namespaces);
  }

  return { functions, namespaces };
}

function nodeTestImportClause(statement: ts.Statement) {
  if (!ts.isImportDeclaration(statement)) return;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
  if (statement.moduleSpecifier.text !== 'node:test') return;
  if (statement.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)
    return;
  return statement.importClause;
}

function collectTestImportBindings(
  checker: ts.TypeChecker,
  clause: ts.ImportClause,
  functions: Set<ts.Symbol>,
  namespaces: Set<ts.Symbol>,
) {
  function remember(name: ts.Identifier, symbols: Set<ts.Symbol>) {
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol) symbols.add(symbol);
  }

  if (clause.name) remember(clause.name, functions);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    remember(bindings.name, namespaces);
    return;
  }
  if (!bindings) return;

  for (const binding of bindings.elements) {
    if (
      !binding.isTypeOnly &&
      ['test', 'it', 'default'].includes(
        (binding.propertyName ?? binding.name).text,
      )
    ) {
      remember(binding.name, functions);
    }
  }
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
      ['test', 'it', 'default'].includes(expression.name.text),
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
