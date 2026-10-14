import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { findTestFiles } from '../lib/test-files.ts';

const files = await findTestFiles(path.resolve('tests'));
if (!files.length) {
  console.error('No .test.ts files were found under tests/.');
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, ['--test', ...files], {
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
