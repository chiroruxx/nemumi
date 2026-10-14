import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrepareContentPr } from '../scripts/cli/prepare-content-pr.ts';

const appSlug = 'nemumi-content';

function createApi(options: {
  pullRequests?: Array<{
    number: number;
    state: 'open' | 'closed';
    mergedAt: string | null;
    body: string | null;
    createdAt: string;
  }>;
  compare?: Array<{
    author: { login: string | null } | null;
    committer: { login: string | null } | null;
  }>;
  events?: Array<{
    id: number;
    event: string;
    createdAt: string;
    actor: { login: string | null } | null;
  }>;
  onUpdate?: (input: {
    number: number;
    body: string;
    state: 'open' | 'closed';
  }) => void;
  fail?: boolean;
  calls: string[];
}) {
  return {
    async listPullRequests({ page }: { page: number }) {
      options.calls.push(`pulls:${page}`);
      if (options.fail) throw new Error('API failed');
      return {
        items: page === 1 ? (options.pullRequests ?? []) : [],
        hasNextPage: false,
      };
    },
    async compareCommits({ page }: { page: number }) {
      options.calls.push(`compare:${page}`);
      if (options.fail) throw new Error('API failed');
      return {
        found: true,
        commits: page === 1 ? (options.compare ?? []) : [],
        hasNextPage: false,
      };
    },
    async listIssueEvents({ page }: { page: number }) {
      options.calls.push(`events:${page}`);
      if (options.fail) throw new Error('API failed');
      return {
        events: page === 1 ? (options.events ?? []) : [],
        hasNextPage: false,
      };
    },
    async updatePullRequest(input: {
      number: number;
      body: string;
      state: 'open' | 'closed';
    }) {
      options.calls.push(`patch:${input.state}`);
      options.onUpdate?.(input);
    },
  };
}

function pullRequest(
  overrides: Partial<{
    number: number;
    state: 'open' | 'closed';
    mergedAt: string | null;
    body: string | null;
    createdAt: string;
  }> = {},
) {
  return {
    number: 29,
    state: 'open' as const,
    mergedAt: null,
    body: 'Update',
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

test('prepare CLI allows CPR for an untracked YAML diff and writes proceed=true', async () => {
  const calls: string[] = [];
  const outputs: Array<[string, string]> = [];
  const result = await runPrepareContentPr({
    api: createApi({ calls }),
    appSlug,
    head: 'automation/sizu',
    getGitStatus: async () => {
      calls.push('git-status');
      return '?? src/content/articles/new.yaml\n';
    },
    writeOutput: async (name, value) => {
      calls.push(`output:${value}`);
      outputs.push([name, value]);
    },
  });
  assert.equal(result.proceed, true);
  assert.deepEqual(outputs, [['proceed', 'true']]);
  assert.equal(calls[0], 'git-status');
});

test('prepare CLI writes proceed=false for an empty diff and does not close absent PRs', async () => {
  const calls: string[] = [];
  const outputs: Array<[string, string]> = [];
  const result = await runPrepareContentPr({
    api: createApi({ calls }),
    appSlug,
    head: 'automation/sizu',
    getGitStatus: async () => {
      calls.push('git-status');
      return '';
    },
    writeOutput: async (name, value) => {
      calls.push(`output:${value}`);
      outputs.push([name, value]);
    },
  });
  assert.equal(result.proceed, false);
  assert.deepEqual(outputs, [['proceed', 'false']]);
  assert.equal(
    calls.some((call) => call.startsWith('patch:')),
    false,
  );
});

test('prepare CLI closes an open no-diff PR before writing proceed=false', async () => {
  const calls: string[] = [];
  let patch:
    | { number: number; body: string; state: 'open' | 'closed' }
    | undefined;
  await runPrepareContentPr({
    api: createApi({
      calls,
      pullRequests: [pullRequest()],
      onUpdate: (input) => {
        patch = input;
      },
    }),
    appSlug,
    head: 'automation/sizu',
    getGitStatus: async () => {
      calls.push('git-status');
      return '';
    },
    writeOutput: async (_name, value) => {
      calls.push(`output:${value}`);
    },
  });
  assert.deepEqual(patch, {
    number: 29,
    body: 'Update\n\n<!-- nemumi:no-diff -->',
    state: 'closed',
  });
  assert.ok(calls.indexOf('patch:closed') < calls.indexOf('output:false'));
});

test('prepare CLI stops on a manual branch commit, writes false, and never requests CPR', async () => {
  const calls: string[] = [];
  const outputs: Array<[string, string]> = [];
  await assert.rejects(
    runPrepareContentPr({
      api: createApi({
        calls,
        compare: [{ author: null, committer: { login: 'human' } }],
      }),
      appSlug,
      head: 'automation/sizu',
      getGitStatus: async () => ' M src/content/articles/post.yaml',
      writeOutput: async (name, value) => {
        outputs.push([name, value]);
      },
    }),
    /non-automation commit/,
  );
  assert.deepEqual(outputs, [['proceed', 'false']]);
  assert.equal(
    calls.some((call) => call.startsWith('patch:')),
    false,
  );
});

test('prepare CLI converts API and git failures to proceed=false and rejects without logging secrets', async () => {
  const outputs: Array<[string, string]> = [];
  await assert.rejects(
    runPrepareContentPr({
      api: createApi({ calls: [], fail: true }),
      appSlug,
      head: 'automation/sizu',
      getGitStatus: async () => '',
      writeOutput: async (name, value) => {
        outputs.push([name, value]);
      },
    }),
    /guard failed: API failed/,
  );
  assert.deepEqual(outputs, [['proceed', 'false']]);

  const gitOutputs: Array<[string, string]> = [];
  await assert.rejects(
    runPrepareContentPr({
      api: createApi({ calls: [] }),
      appSlug,
      head: 'automation/sizu',
      getGitStatus: async () => {
        throw new Error('git failed');
      },
      writeOutput: async (name, value) => {
        gitOutputs.push([name, value]);
      },
    }),
    /git failed/,
  );
  assert.deepEqual(gitOutputs, [['proceed', 'false']]);
});

test('prepare CLI reopens an automation no-diff PR before allowing CPR', async () => {
  const calls: string[] = [];
  let patch:
    | { number: number; body: string; state: 'open' | 'closed' }
    | undefined;
  const result = await runPrepareContentPr({
    api: createApi({
      calls,
      pullRequests: [
        pullRequest({
          state: 'closed',
          body: `Update\n<!-- nemumi:no-diff -->`,
        }),
      ],
      events: [
        {
          id: 1,
          event: 'closed',
          createdAt: '2026-10-02T00:00:00Z',
          actor: { login: `${appSlug}[bot]` },
        },
      ],
      onUpdate: (input) => {
        patch = input;
      },
    }),
    appSlug,
    head: 'automation/sizu',
    getGitStatus: async () => '?? src/content/articles/new.yaml',
    writeOutput: async (_name, value) => {
      calls.push(`output:${value}`);
    },
  });
  assert.equal(result.proceed, true);
  assert.deepEqual(patch, { number: 29, body: 'Update', state: 'open' });
  assert.ok(calls.indexOf('patch:open') < calls.indexOf('output:true'));
});
