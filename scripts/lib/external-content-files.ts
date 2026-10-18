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
import type { Collection, StoredEntry } from './external-content.ts';

const defaultContentDirectory = path.resolve('src/content');

// Targets must be absolute paths, resolved when operations are created.
export type ContentFileWrite = {
  kind: 'create' | 'replace';
  target: string;
  content: string;
};

// Removal targets follow the same absolute-path contract as writes.
export type ContentFileRemoval = { target: string };

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

function assertRegularFile(
  target: string,
  metadata: Awaited<ReturnType<typeof lstat>> | undefined,
  kind: 'replace' | 'delete',
): void {
  if (!metadata) {
    throw new Error(`Cannot ${kind} ${target}: file does not exist`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Refusing to modify a non-regular file: ${target}`);
  }
}

function validateFileTarget(
  target: string,
  contentDirectory: string,
  seen: Set<string>,
): string {
  if (!path.isAbsolute(target)) {
    throw new Error(`File target must be an absolute path: ${target}`);
  }
  const resolved = path.resolve(target);
  assertRepositoryFile(resolved, path.resolve(contentDirectory));
  if (seen.has(resolved)) throw new Error(`duplicate file target: ${resolved}`);
  seen.add(resolved);
  return resolved;
}

async function readFileMetadata(
  target: string,
  fileSystem: Pick<ContentFileSystem, 'lstat'>,
) {
  try {
    return await fileSystem.lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

export async function validateFileWrites(
  writes: ContentFileWrite[],
  contentDirectory: string,
  fileSystem: Pick<ContentFileSystem, 'lstat'> = defaultFileSystem,
): Promise<void> {
  const seen = new Set<string>();
  for (const write of writes) {
    const target = validateFileTarget(write.target, contentDirectory, seen);
    const metadata = await readFileMetadata(target, fileSystem);
    if (write.kind === 'create') {
      if (metadata)
        throw new Error(`Cannot create ${target}: file already exists`);
    } else {
      assertRegularFile(target, metadata, write.kind);
    }
    if (typeof write.content !== 'string') {
      throw new Error(`Missing file content for ${target}`);
    }
  }
}

export async function validateFileRemovals(
  removals: ContentFileRemoval[],
  contentDirectory: string,
  fileSystem: Pick<ContentFileSystem, 'lstat'> = defaultFileSystem,
): Promise<void> {
  const seen = new Set<string>();
  for (const removal of removals) {
    const target = validateFileTarget(removal.target, contentDirectory, seen);
    const metadata = await readFileMetadata(target, fileSystem);
    assertRegularFile(target, metadata, 'delete');
  }
}

// Callers must validate all writes before writing files.
export async function writeFiles(
  writes: ContentFileWrite[],
  fileSystem: Pick<
    ContentFileSystem,
    'writeFile' | 'rename' | 'rm'
  > = defaultFileSystem,
): Promise<void> {
  for (const write of writes) {
    const temporary = `${write.target}.${randomUUID()}.tmp`;
    let temporaryMayExist = true;
    try {
      await fileSystem.writeFile(temporary, write.content, { flag: 'wx' });
      await fileSystem.rename(temporary, write.target);
      temporaryMayExist = false;
    } finally {
      if (temporaryMayExist) await fileSystem.rm(temporary, { force: true });
    }
  }
}

// Callers must validate all removals before removing files.
export async function removeFiles(
  removals: ContentFileRemoval[],
  fileSystem: Pick<ContentFileSystem, 'rm'> = defaultFileSystem,
): Promise<void> {
  for (const removal of removals) {
    await fileSystem.rm(removal.target);
  }
}
