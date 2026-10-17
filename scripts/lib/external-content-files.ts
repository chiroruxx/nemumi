import { randomUUID } from 'node:crypto';
import {
  lstat,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { contentRecordSchema } from '../../src/config/content-schema.ts';
import type { Collection, StoredEntry } from './external-content-planning.ts';

const defaultContentDirectory = path.resolve('src/content');

export type ContentFileOperation =
  | { kind: 'create' | 'replace'; target: string; content: string }
  | { kind: 'delete'; target: string };

type ContentFileSystem = {
  lstat: typeof lstat;
  writeFile: typeof writeFile;
  rename: typeof rename;
  rm: typeof rm;
};

const defaultFileSystem: ContentFileSystem = { lstat, writeFile, rename, rm };

function parseContentData(value: unknown, file: string) {
  const result = contentRecordSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join('.') || '<root>';
    throw new Error(`${file}: invalid ${field}: ${issue?.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}

export async function readCollection(
  collection: Collection,
  contentDirectory = defaultContentDirectory,
): Promise<StoredEntry[]> {
  const directory = path.join(contentDirectory, collection);
  const files = (await readdir(directory)).filter((name) =>
    name.endsWith('.yaml'),
  );
  return Promise.all(
    files.map(async (name) => {
      const file = path.join(directory, name);
      const source = await readFile(file, 'utf8');
      let value: unknown;
      try {
        value = YAML.parse(source);
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(`${file}: invalid YAML: ${details}`, { cause: error });
      }
      return { file, id: name, data: parseContentData(value, file) };
    }),
  );
}

function assertRepositoryFile(
  file: string,
  contentDirectory = defaultContentDirectory,
): void {
  const relative = path.relative(contentDirectory, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify a path outside src/content: ${file}`);
  }
}

export async function validateFileTargets(
  operations: ContentFileOperation[],
  contentDirectory: string,
  fileSystem: ContentFileSystem = defaultFileSystem,
): Promise<void> {
  const seen = new Set<string>();
  for (const operation of operations) {
    const target = path.resolve(operation.target);
    assertRepositoryFile(target, path.resolve(contentDirectory));
    if (seen.has(target)) throw new Error(`duplicate file target: ${target}`);
    seen.add(target);

    let metadata: Awaited<ReturnType<typeof lstat>> | undefined;
    try {
      metadata = await fileSystem.lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (operation.kind === 'create' && metadata) {
      throw new Error(`Cannot create ${target}: file already exists`);
    }
    if (operation.kind !== 'create' && !metadata) {
      throw new Error(
        `Cannot ${operation.kind} ${target}: file does not exist`,
      );
    }
    if (metadata && (metadata.isSymbolicLink() || !metadata.isFile())) {
      throw new Error(`Refusing to modify a non-regular file: ${target}`);
    }
    if (operation.kind !== 'delete' && typeof operation.content !== 'string') {
      throw new Error(`Missing file content for ${target}`);
    }
  }
}

export async function applyFileChanges(
  operations: ContentFileOperation[],
  contentDirectory: string,
  fileSystem: ContentFileSystem = defaultFileSystem,
): Promise<void> {
  const resolvedOperations = operations.map((operation) => ({
    ...operation,
    target: path.resolve(operation.target),
  }));
  await validateFileTargets(resolvedOperations, contentDirectory, fileSystem);
  for (const operation of resolvedOperations) {
    if (operation.kind === 'delete') {
      await fileSystem.rm(operation.target);
      continue;
    }
    const temporary = `${operation.target}.${randomUUID()}.tmp`;
    let temporaryMayExist = true;
    try {
      await fileSystem.writeFile(temporary, operation.content, { flag: 'wx' });
      await fileSystem.rename(temporary, operation.target);
      temporaryMayExist = false;
    } finally {
      if (temporaryMayExist) await fileSystem.rm(temporary, { force: true });
    }
  }
}
