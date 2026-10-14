import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';

export async function createContentDirectory(t: TestContext): Promise<string> {
  const contentDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'nemumi-content-'),
  );
  await Promise.all(
    ['articles', 'talks'].map((collection) =>
      mkdir(path.join(contentDirectory, collection)),
    ),
  );
  t.after(() => rm(contentDirectory, { recursive: true, force: true }));
  return contentDirectory;
}
