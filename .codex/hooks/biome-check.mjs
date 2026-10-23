import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function repositoryRoot() {
  try {
    return path.resolve(
      git(['rev-parse', '--show-toplevel'], process.cwd()).trim(),
    );
  } catch {
    return null;
  }
}

function directEditPaths(event) {
  if (['Edit', 'Write'].includes(event.tool_name)) {
    const file =
      event.tool_input?.file_path ??
      event.tool_input?.path ??
      event.tool_input?.filename;
    return typeof file === 'string' ? [file] : [];
  }
  if (event.tool_name !== 'apply_patch') return [];
  const command = event.tool_input?.command ?? '';
  return [
    ...new Set(
      [
        ...command.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm),
        ...command.matchAll(/^\*\*\* Move to: (.+)$/gm),
      ].map((match) => match[1].trim()),
    ),
  ];
}

function dirtyPaths(root) {
  const output = git(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    root,
  );
  return pathsFromStatus(output);
}

function pathsFromStatus(output) {
  const records = output.split('\0');
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== ' ') continue;
    const status = record.slice(0, 2);
    paths.push(record.slice(3));
    if (status.includes('R') || status.includes('C')) {
      if (records[index + 1]) paths.push(records[++index]);
    }
  }
  return [...new Set(paths)];
}

function repositoryFiles(root, files) {
  return files
    .map((file) => path.resolve(root, file))
    .filter((file) => file.startsWith(`${root}${path.sep}`) && existsSync(file))
    .filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    });
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileDigest(file) {
  return digest(readFileSync(file));
}

function configurationDigest(root) {
  const hash = createHash('sha256');
  for (const name of [
    'biome.jsonc',
    'package.json',
    'pnpm-lock.yaml',
    '.codex/hooks.json',
    '.codex/hooks/biome-check.mjs',
  ]) {
    const file = path.join(root, name);
    hash.update(name);
    if (existsSync(file)) hash.update(readFileSync(file));
  }
  return hash.digest('hex');
}

function cacheFile(root) {
  return path.join(os.tmpdir(), 'nemumi-codex-biome', `${digest(root)}.json`);
}

function checkTargets(event, root) {
  const editedPaths = directEditPaths(event);
  if (editedPaths.length > 0) return { paths: editedPaths, autoFormat: true };
  if (
    !['Bash', 'Edit', 'Write'].includes(event.tool_name) &&
    !event.tool_name?.startsWith('mcp__')
  ) {
    return null;
  }
  return { paths: dirtyPaths(root), autoFormat: false };
}

function loadCache(file, configuration) {
  try {
    const cache = JSON.parse(readFileSync(file, 'utf8'));
    return cache.configuration === configuration &&
      typeof cache.files === 'object'
      ? cache.files
      : {};
  } catch {
    return {};
  }
}

function saveCache(file, configuration, files) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  writeFileSync(
    temporaryFile,
    `${JSON.stringify({ configuration, files }, null, 2)}\n`,
  );
  renameSync(temporaryFile, file);
}

function readEvent() {
  try {
    return { event: JSON.parse(readFileSync(0, 'utf8')) };
  } catch {
    return undefined;
  }
}

function runBiomeCheck(root, pending, autoFormat) {
  const command = ['exec', '--', 'pnpm', 'exec', 'biome', 'check'];
  if (autoFormat) command.push('--write');
  command.push('--files-ignore-unknown=true', '--no-errors-on-unmatched');
  command.push(...pending.map((item) => path.relative(root, item)));
  const result = spawnSync('mise', command, { cwd: root, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    reportBiomeFailure(result, pending.length);
    return false;
  }
  return true;
}

function reportBiomeFailure(result, count) {
  console.error(`Biome check failed for ${count} changed file(s).`);
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function repositoryCache(root) {
  const configuration = configurationDigest(root);
  const file = cacheFile(root);
  return { configuration, file, files: loadCache(file, configuration) };
}

function checkTargetFiles(root, targets) {
  const files = repositoryFiles(root, targets.paths);
  if (files.length === 0) return 0;
  const cache = repositoryCache(root);
  const pending = files.filter(
    (item) => cache.files[path.relative(root, item)] !== fileDigest(item),
  );
  if (pending.length === 0) return 0;
  if (!runBiomeCheck(root, pending, targets.autoFormat)) return 2;
  for (const item of pending)
    cache.files[path.relative(root, item)] = fileDigest(item);
  saveCache(cache.file, cache.configuration, cache.files);
  return 0;
}

function checkEvent(event, root) {
  let targets;
  try {
    targets = checkTargets(event, root);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (!targets) return 0;
  return checkTargetFiles(root, targets);
}

function main() {
  const input = readEvent();
  if (!input) return 0;
  const root = repositoryRoot();
  if (!root) return 0;
  return checkEvent(input.event, root);
}

process.exitCode = main();
