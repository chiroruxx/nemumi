import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

function actionStep(steps: Mapping[], action: string): Mapping | undefined {
  return steps.find((step) => step.uses === action);
}

test('content workflows checkout trusted main before invoking the shared automation action', async () => {
  for (const [file, jobName] of [
    ['.github/workflows/update-content.yml', 'sync'],
    ['.github/workflows/prune-content.yml', 'prune'],
  ] as const) {
    const workflow = await yamlFile(file);
    const permissions = mapping(workflow.permissions, `${file} permissions`);
    assert.equal(permissions.contents, 'read');
    const steps = workflowSteps(workflow, jobName);
    const checkoutIndex = steps.findIndex((step) =>
      String(step.uses).startsWith('actions/checkout@'),
    );
    const checkout = steps[checkoutIndex];
    const checkoutWith = mapping(checkout?.with, `${file} checkout.with`);
    assert.equal(checkoutWith.ref, 'main');
    assert.equal(checkoutWith['persist-credentials'], false);
    const sharedActionIndex = steps.findIndex(
      (step) => step.uses === './.github/actions/content-automation',
    );
    assert.ok(
      sharedActionIndex > checkoutIndex,
      `${file} must load the local action after checkout`,
    );
    const sharedAction = steps[sharedActionIndex];
    assert.ok(sharedAction);
    const inputs = mapping(sharedAction.with, `${file} shared action inputs`);
    assert.equal(inputs['client-id'], expression('vars.APP_CLIENT_ID'));
    assert.equal(inputs['private-key'], expression('secrets.APP_PRIVATE_KEY'));
    assert.equal(inputs.mode, jobName === 'sync' ? 'sync' : 'prune');
  }
});

test('shared content action delegates PR management and gates auto-merge on an open PR', async () => {
  const action = await yamlFile(
    '.github/actions/content-automation/action.yml',
  );
  assert.equal(action.runs && mapping(action.runs, 'runs').using, 'composite');
  const steps = sequence(
    mapping(action.runs, 'runs').steps,
    'action steps',
  ).map((step, index) => mapping(step, `action.steps[${index}]`));
  const ids = steps.flatMap((step) =>
    typeof step.id === 'string' ? [step.id] : [],
  );
  assert.equal(new Set(ids).size, ids.length, 'action step ids must be unique');
  assert.ok(
    steps.some((step) =>
      String(step.run).includes('pnpm install --frozen-lockfile'),
    ),
  );
  assert.ok(steps.every((step) => step.id !== 'guard'));
  assert.ok(steps.some((step) => String(step.run).includes('sync-content')));
  assert.ok(steps.some((step) => String(step.run).includes('prune-content')));

  const pullRequest = actionStep(
    steps,
    'peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1',
  );
  assert.ok(pullRequest, 'the shared action must create or update a PR');
  assert.equal(
    pullRequest.if,
    undefined,
    'PR management must run without a lifecycle or commit guard',
  );
  const pullRequestWith = mapping(pullRequest.with, 'create-pull-request.with');
  assert.equal(pullRequestWith.base, 'main');
  const actionInputs = mapping(action.inputs, 'action inputs');
  const addPathsInput = mapping(actionInputs['add-paths'], 'add-paths input');
  assert.equal(pullRequestWith['delete-branch'], false);
  assert.match(String(pullRequestWith.committer), /github-actions\[bot\]/);
  assert.match(String(pullRequestWith.author), /github\.actor_id/);
  assert.equal(pullRequestWith['add-paths'], expression('inputs.add-paths'));
  assert.match(String(pullRequestWith.body), /steps\.sync\.outputs\.summary/);
  assert.match(String(pullRequestWith.body), /steps\.prune\.outputs\.summary/);
  assert.match(String(pullRequestWith.body), /自動マージします。/);
  assert.match(
    String(pullRequestWith.body),
    /この実行では自動マージを要求しません。/,
  );
  assert.match(
    String(addPathsInput.default),
    /src\/content\/articles\/\*\.yaml/,
  );
  assert.match(String(addPathsInput.default), /src\/content\/talks\/\*\.yaml/);

  const autoMerge = steps.find((step) =>
    String(step.run).includes('gh pr merge'),
  );
  assert.ok(autoMerge, 'the shared action must support auto-merge');
  assert.equal(
    autoMerge.if,
    "vars.CONTENT_AUTO_MERGE == 'true' && steps.pull-request.outputs.pull-request-number != '' && steps.pull-request.outputs.pull-request-operation != 'closed'",
  );
});

test('update workflow preserves scheduled and manual service matrix behavior', async () => {
  const workflow = await yamlFile('.github/workflows/update-content.yml');
  const on = mapping(workflow.on, 'on');
  const schedule = sequence(on.schedule, 'update schedule');
  assert.equal(mapping(schedule[0], 'update cron').cron, '17 21 * * *');
  const dispatch = mapping(on.workflow_dispatch, 'workflow_dispatch');
  const inputs = mapping(dispatch.inputs, 'workflow_dispatch.inputs');
  const service = mapping(inputs.service, 'service input');
  assert.deepEqual(service.options, ['all', 'sizu', 'hatena', 'speakerdeck']);

  const jobs = mapping(workflow.jobs, 'jobs');
  const sync = mapping(jobs.sync, 'sync job');
  assert.equal(sync['timeout-minutes'], 10);
  const strategy = mapping(sync.strategy, 'sync.strategy');
  assert.equal(strategy['fail-fast'], false);
  const matrix = mapping(strategy.matrix, 'sync.strategy.matrix');
  assert.match(String(matrix.service), /fromJSON/);
  const concurrency = mapping(workflow.concurrency, 'workflow concurrency');
  assert.equal(concurrency.group, 'content-automation-main');
  assert.equal(concurrency['cancel-in-progress'], false);
});

test('prune workflow keeps its schedule, manual entry point, latest-main checkout, and shared serialization', async () => {
  const workflow = await yamlFile('.github/workflows/prune-content.yml');
  const on = mapping(workflow.on, 'on');
  const schedule = sequence(on.schedule, 'prune schedule');
  assert.equal(mapping(schedule[0], 'prune cron').cron, '17 22 * * *');
  assert.ok(Object.hasOwn(on, 'workflow_dispatch'));
  const prune = mapping(mapping(workflow.jobs, 'jobs').prune, 'prune job');
  assert.equal(prune['timeout-minutes'], 10);
  const concurrency = mapping(workflow.concurrency, 'workflow concurrency');
  assert.equal(concurrency.group, 'content-automation-main');
  assert.equal(concurrency['cancel-in-progress'], false);
});
