import path from 'node:path';
import ts from 'typescript';
import { findUntestedExports } from '../lib/exported-function-tests.ts';
import { findTestFiles } from '../lib/test-files.ts';

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists);
if (!configPath) throw new Error('tsconfig.json was not found.');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error)
  throw new Error(
    ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
  );
const parsed = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  path.dirname(configPath),
);
if (parsed.errors.length) {
  throw new Error(
    parsed.errors
      .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      .join('\n'),
  );
}
const program = ts.createProgram(parsed.fileNames, parsed.options);
// Check repository source modules; test helpers, dependencies and generated
// Astro/build files are outside the production API being checked (ADR 0026).
const sources = parsed.fileNames.filter(
  (file) =>
    /^(src|scripts)\//.test(
      path.relative(process.cwd(), file).split(path.sep).join('/'),
    ) &&
    !file.endsWith('.d.ts') &&
    !/\.test\.tsx?$/.test(file),
);
const tests = await findTestFiles(path.resolve('tests'));
const missing = findUntestedExports(program, { sources, tests });
for (const entry of missing) {
  console.error(
    `${path.relative(process.cwd(), entry.file)}:${entry.line}: exported function "${entry.name}" has no direct call in a node:test callback.`,
  );
}
if (missing.length) process.exitCode = 1;
else console.log('All exported functions have a direct test call.');
