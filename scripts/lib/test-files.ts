import { readdir } from 'node:fs/promises';
import path from 'node:path';

// Node's native TypeScript runner can execute .test.ts files, including nested
// files. It cannot execute TSX, so static checking and runtime use this list.
export async function findTestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findTestFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.test.ts')
        ? [entryPath]
        : [];
    }),
  );
  return files.flat().sort();
}
