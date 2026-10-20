import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

type Mapping = Record<string, unknown>;

function mapping(value: unknown, label: string): Mapping {
  assert.equal(typeof value, 'object', `${label} must be a mapping`);
  assert.ok(
    value !== null && !Array.isArray(value),
    `${label} must be a mapping`,
  );
  return value as Mapping;
}

function sequence(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} must be a sequence`);
  return value;
}

async function yamlFile(relativePath: string): Promise<Mapping> {
  const source = await readFile(path.resolve(relativePath), 'utf8');
  return mapping(YAML.parse(source), relativePath);
}

function workflowSteps(workflow: Mapping, jobName: string): Mapping[] {
  const jobs = mapping(workflow.jobs, 'jobs');
  const job = mapping(jobs[jobName], `${jobName} job`);
  return sequence(job.steps, `${jobName}.steps`).map((step, index) =>
    mapping(step, `${jobName}.steps[${index}]`),
  );
}

function expression(value: string): string {
  return `\${{ ${value} }}`;
}

const contentPullRequestAction = './.github/actions/content-pull-request';
const checkContentLinksAction = './.github/actions/check-content-links';

test('content workflows checkout trusted main and use read-only workflow permissions', async () => {
  for (const [file, jobName] of [
    ['.github/workflows/update-content.yml', 'sync'],
  ] as const) {
    const workflow = await yamlFile(file);
    const permissions = mapping(workflow.permissions, `${file} permissions`);
    assert.equal(permissions.contents, 'read');
    const steps = workflowSteps(workflow, jobName);
    const checkoutIndex = steps.findIndex((step) =>
      String(step.uses).startsWith('actions/checkout@'),
    );
    const checkoutWith = mapping(
      steps[checkoutIndex]?.with,
      `${file} checkout.with`,
    );
    assert.equal(checkoutWith.ref, 'main');
    assert.equal(checkoutWith['persist-credentials'], false);
    assert.ok(
      steps.findIndex((step) =>
        String(step.uses).startsWith('jdx/mise-action@'),
      ) > checkoutIndex,
    );
    assert.ok(
      steps.findIndex((step) =>
        String(step.run).includes('pnpm install --frozen-lockfile'),
      ) > checkoutIndex,
    );
    const prStep = steps.find((step) => step.uses === contentPullRequestAction);
    const prInputs = mapping(prStep?.with, `${file} PR action inputs`);
    assert.equal(prInputs['client-id'], expression('vars.APP_CLIENT_ID'));
    assert.equal(
      prInputs['private-key'],
      expression('secrets.APP_PRIVATE_KEY'),
    );
    assert.equal(prInputs['auto-merge'], expression('vars.CONTENT_AUTO_MERGE'));
  }
});

test('update workflow validates the selected service and runs syncs serially before shared link check, pruning, and one PR', async () => {
  const workflow = await yamlFile('.github/workflows/update-content.yml');
  const on = mapping(workflow.on, 'on');
  const schedule = sequence(on.schedule, 'update schedule');
  assert.equal(mapping(schedule[0], 'update cron').cron, '17 21 * * *');
  const dispatch = mapping(on.workflow_dispatch, 'workflow_dispatch');
  const inputs = mapping(dispatch.inputs, 'workflow_dispatch.inputs');
  const service = mapping(inputs.service, 'service input');
  assert.deepEqual(service.options, ['all', 'sizu', 'hatena', 'speakerdeck']);

  const steps = workflowSteps(workflow, 'sync');
  const commands = steps.map((step) => String(step.run ?? ''));
  const validateIndex = commands.findIndex((command) =>
    command.includes('Unsupported content service'),
  );
  const syncIndexes = commands.flatMap((command, index) =>
    command.includes('mise run sync-content') ? [index] : [],
  );
  assert.ok(validateIndex >= 0);
  assert.equal(syncIndexes.length, 3);
  assert.ok(syncIndexes.every((index) => index > validateIndex));
  assert.deepEqual(
    syncIndexes.map((index) => commands[index]),
    [
      'mise run sync-content -- sizu',
      'mise run sync-content -- hatena',
      'mise run sync-content -- speakerdeck',
    ],
  );
  assert.deepEqual(
    syncIndexes.map((index) => steps[index]?.if),
    [
      "inputs.service == 'all' || inputs.service == 'sizu' || github.event_name == 'schedule'",
      "inputs.service == 'all' || inputs.service == 'hatena' || github.event_name == 'schedule'",
      "inputs.service == 'all' || inputs.service == 'speakerdeck' || github.event_name == 'schedule'",
    ],
  );

  const checkIndex = steps.findIndex(
    (step) => step.uses === checkContentLinksAction,
  );
  const prIndex = steps.findIndex(
    (step) => step.uses === contentPullRequestAction,
  );
  assert.ok(checkIndex > Math.max(...syncIndexes));
  const pruneIndex = commands.indexOf('mise run prune-content');
  assert.ok(pruneIndex > checkIndex);
  assert.ok(prIndex > pruneIndex);
  assert.equal(steps[checkIndex]?.if, undefined);
  assert.equal(steps[pruneIndex]?.if, undefined);
  assert.equal(
    commands.filter((command) => command === 'mise run prune-content').length,
    1,
  );
  assert.deepEqual(
    (await readdir('.github/workflows')).filter((file) =>
      file.endsWith('-content.yml'),
    ),
    ['update-content.yml'],
  );
  assert.equal(
    steps.filter((step) => step.uses === contentPullRequestAction).length,
    1,
  );
  assert.equal(
    steps.some((step) => step['continue-on-error'] === true),
    false,
  );
  assert.equal(
    steps[prIndex]?.if,
    undefined,
    'PR creation should use the default success condition',
  );

  const prInputs = mapping(steps[prIndex]?.with, 'PR action inputs');
  const linkCheck = steps[checkIndex];
  assert.equal(
    prInputs.summary,
    expression('steps.check-links.outputs.summary'),
  );
  assert.equal(prInputs.branch, 'automation/update-content');
  assert.equal(linkCheck?.id, 'check-links');

  const jobs = mapping(workflow.jobs, 'jobs');
  assert.deepEqual(Object.keys(jobs), ['sync']);
  const sync = mapping(jobs.sync, 'sync job');
  assert.equal(sync['timeout-minutes'], 40);
  const concurrency = mapping(workflow.concurrency, 'workflow concurrency');
  assert.equal(concurrency.group, 'content-automation-main');
  assert.equal(concurrency['cancel-in-progress'], false);
});

test('link check action exposes its CLI summary without a mode input', async () => {
  const action = await yamlFile(
    '.github/actions/check-content-links/action.yml',
  );
  assert.ok(
    action.inputs === undefined ||
      Object.keys(mapping(action.inputs, 'link check action inputs')).length ===
        0,
  );
  const steps = sequence(
    mapping(action.runs, 'runs').steps,
    'link check steps',
  ).map((step, index) => mapping(step, `link check steps[${index}]`));
  assert.deepEqual(
    steps.map((step) => step.run),
    ['mise run check-content-links'],
  );
  assert.equal(
    mapping(
      mapping(action.outputs, 'link check outputs').summary,
      'summary output',
    ).value,
    expression('steps.check.outputs.summary'),
  );
  assert.equal(steps[0]?.id, 'check');
  assert.equal(steps[0]?.shell, 'bash');
});

test('pull request action only creates the PR and optionally enables auto-merge', async () => {
  const action = await yamlFile(
    '.github/actions/content-pull-request/action.yml',
  );
  const actionInputs = mapping(action.inputs, 'PR action inputs');
  assert.equal(Object.hasOwn(actionInputs, 'mode'), false);
  assert.equal(Object.hasOwn(actionInputs, 'service'), false);
  assert.ok(Object.hasOwn(actionInputs, 'summary'));
  assert.ok(Object.hasOwn(actionInputs, 'client-id'));
  assert.ok(Object.hasOwn(actionInputs, 'private-key'));
  assert.ok(Object.hasOwn(actionInputs, 'auto-merge'));
  const steps = sequence(
    mapping(action.runs, 'runs').steps,
    'PR action steps',
  ).map((step, index) => mapping(step, `PR action steps[${index}]`));
  assert.equal(mapping(action.runs, 'PR action runs').using, 'composite');
  assert.equal(
    steps.some(
      (step) =>
        step.run &&
        /sync-content|prune-content|check-content-links/.test(String(step.run)),
    ),
    false,
  );
  assert.equal(
    steps.some((step) => String(step.run).includes('pnpm install')),
    false,
  );
  const pullRequest = steps.find((step) =>
    String(step.uses).startsWith('peter-evans/create-pull-request@'),
  );
  assert.ok(pullRequest);
  assert.equal(pullRequest.if, undefined);
  const pullRequestWith = mapping(pullRequest.with, 'create-pull-request.with');
  assert.equal(pullRequestWith.base, 'main');
  assert.equal(pullRequestWith['delete-branch'], false);
  assert.equal(pullRequestWith['add-paths'], expression('inputs.add-paths'));
  assert.match(String(pullRequestWith.body), /inputs.summary/);
  assert.match(String(pullRequestWith.author), /github\.actor_id/);
  assert.match(String(pullRequestWith.committer), /github-actions\[bot\]/);
  const autoMerge = steps.find((step) =>
    String(step.run).includes('gh pr merge'),
  );
  assert.ok(autoMerge);
  assert.equal(autoMerge.shell, 'bash');
  assert.equal(
    autoMerge.if,
    "inputs.auto-merge == 'true' && steps.pull-request.outputs.pull-request-number != '' && steps.pull-request.outputs.pull-request-operation != 'closed'",
  );
  const autoMergeInput = mapping(
    actionInputs['auto-merge'],
    'auto-merge input',
  );
  assert.equal(autoMergeInput.required, false);
  assert.equal(autoMergeInput.default, 'false');
  const addPathsInput = mapping(actionInputs['add-paths'], 'add-paths input');
  assert.match(
    String(addPathsInput.default),
    /src\/content\/articles\/\*\.yaml/,
  );
  assert.match(String(addPathsInput.default), /src\/content\/talks\/\*\.yaml/);

  const source = await readFile(
    '.github/actions/content-pull-request/action.yml',
    'utf8',
  );
  assert.doesNotMatch(source, /\$\{\{[^}]*\bvars\s*[.[]/);
});
