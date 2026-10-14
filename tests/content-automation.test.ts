import assert from 'node:assert/strict';
import test from 'node:test';
import { guardContentAutomation } from '../scripts/lib/content-automation.ts';

const appSlug = 'nemumi-content';
const botLogin = `${appSlug}[bot]`;
const marker = '<!-- nemumi:no-diff -->';

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
    body: 'Automated update',
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function commit(committerLogin: string | null, authorLogin = 'human') {
  return {
    author: { login: authorLogin },
    committer: { login: committerLogin },
  };
}

function event(
  id: number,
  createdAt: string,
  actorLogin: string | null,
  name = 'closed',
) {
  return { id, event: name, createdAt, actor: { login: actorLogin } };
}

function createFake(options: {
  pullRequestPages?: Array<{
    items: ReturnType<typeof pullRequest>[];
    hasNextPage: boolean;
  }>;
  comparePages?: Array<{
    found: boolean;
    commits: ReturnType<typeof commit>[];
    hasNextPage: boolean;
  }>;
  eventPages?: Array<{
    events: ReturnType<typeof event>[];
    hasNextPage: boolean;
  }>;
  error?: 'pull-requests' | 'compare' | 'events';
}) {
  const writes: Array<{
    number: number;
    body: string;
    state: 'open' | 'closed';
  }> = [];
  const calls: string[] = [];
  const pullRequestPages = options.pullRequestPages ?? [
    { items: [], hasNextPage: false },
  ];
  const comparePages = options.comparePages ?? [
    { found: true, commits: [], hasNextPage: false },
  ];
  const eventPages = options.eventPages ?? [{ events: [], hasNextPage: false }];

  return {
    writes,
    calls,
    api: {
      async listPullRequests({
        page,
      }: {
        head: string;
        base: string;
        page: number;
      }) {
        calls.push(`pull-requests:${page}`);
        if (options.error === 'pull-requests')
          throw new Error('API unavailable');
        return pullRequestPages[page - 1] ?? { items: [], hasNextPage: false };
      },
      async compareCommits({
        page,
      }: {
        base: string;
        head: string;
        page: number;
      }) {
        calls.push(`compare:${page}`);
        if (options.error === 'compare') throw new Error('API unavailable');
        return (
          comparePages[page - 1] ?? {
            found: true,
            commits: [],
            hasNextPage: false,
          }
        );
      },
      async listIssueEvents({ page }: { pullNumber: number; page: number }) {
        calls.push(`events:${page}`);
        if (options.error === 'events') throw new Error('API unavailable');
        return eventPages[page - 1] ?? { events: [], hasNextPage: false };
      },
      async updatePullRequest(input: {
        number: number;
        body: string;
        state: 'open' | 'closed';
      }) {
        calls.push(`patch:${input.state}`);
        writes.push(input);
      },
    },
  };
}

async function guard(fake: ReturnType<typeof createFake>, hasDiff: boolean) {
  return guardContentAutomation({
    api: fake.api,
    appSlug,
    base: 'main',
    head: 'automation/sizu',
    hasDiff,
  });
}

test('an absent branch with no pull request is a no-op when there is no generated diff', async () => {
  const fake = createFake({
    comparePages: [{ found: false, commits: [], hasNextPage: false }],
  });
  const result = await guardContentAutomation({
    api: fake.api,
    appSlug,
    base: 'main',
    head: 'automation/sizu',
    hasDiff: false,
  });
  assert.deepEqual(result, { action: 'no-op' });
  assert.deepEqual(fake.writes, []);
});

test('a new branch with a diff proceeds to create or update the pull request', async () => {
  const fake = createFake({
    comparePages: [{ found: false, commits: [], hasNextPage: false }],
  });
  assert.deepEqual(await guard(fake, true), { action: 'run-cpr' });
});

test('open pull request accepts human author when every ahead committer is the GitHub Actions bot', async () => {
  const fake = createFake({
    pullRequestPages: [{ items: [pullRequest()], hasNextPage: false }],
    comparePages: [
      {
        found: true,
        commits: [commit('github-actions[bot]', 'human')],
        hasNextPage: false,
      },
    ],
  });
  assert.deepEqual(await guard(fake, true), { action: 'run-cpr' });
  assert.deepEqual(fake.writes, []);
});

test('a non-bot or unknown committer stops before pull request mutation', async () => {
  for (const committerLogin of ['human', null]) {
    const fake = createFake({
      comparePages: [
        {
          found: true,
          commits: [commit(committerLogin)],
          hasNextPage: false,
        },
      ],
    });
    assert.equal((await guard(fake, true)).action, 'stop');
    assert.deepEqual(fake.writes, []);
  }
});

test('comparison checks every page before allowing CPR', async () => {
  const fake = createFake({
    comparePages: [
      {
        found: true,
        commits: [commit('github-actions[bot]')],
        hasNextPage: true,
      },
      { found: true, commits: [commit('human')], hasNextPage: false },
    ],
  });
  assert.equal((await guard(fake, true)).action, 'stop');
  assert.ok(fake.calls.includes('compare:2'));
});

test('an open pull request with no diff is closed with a body marker in one PATCH', async () => {
  const fake = createFake({
    pullRequestPages: [{ items: [pullRequest()], hasNextPage: false }],
  });
  assert.deepEqual(await guard(fake, false), { action: 'close-no-diff' });
  assert.deepEqual(fake.writes, [
    { number: 29, body: `Automated update\n\n${marker}`, state: 'closed' },
  ]);
  assert.ok(
    fake.calls.indexOf('compare:1') < fake.calls.indexOf('patch:closed'),
  );
});

test('a newer open pull request takes precedence over an older closed pull request', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [
          pullRequest({ number: 31, createdAt: '2026-10-02T00:00:00Z' }),
          pullRequest({
            number: 29,
            state: 'closed',
            createdAt: '2026-10-01T00:00:00Z',
          }),
        ],
        hasNextPage: false,
      },
    ],
  });
  assert.deepEqual(await guard(fake, true), { action: 'run-cpr' });
  assert.deepEqual(fake.writes, []);
});

test('a merged pull request is allowed to proceed regardless of close actor or marker', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [
          pullRequest({ state: 'closed', mergedAt: '2026-10-02T00:00:00Z' }),
        ],
        hasNextPage: false,
      },
    ],
  });
  assert.deepEqual(await guard(fake, true), { action: 'run-cpr' });
  assert.deepEqual(fake.writes, []);
});

test('a marked closed pull request with the latest app close stays closed without a diff', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [
          pullRequest({ state: 'closed', body: `Automated update\n${marker}` }),
        ],
        hasNextPage: false,
      },
    ],
    eventPages: [
      {
        events: [event(1, '2026-10-02T00:00:00Z', botLogin)],
        hasNextPage: false,
      },
    ],
  });
  assert.deepEqual(await guard(fake, false), { action: 'no-op' });
  assert.deepEqual(fake.writes, []);
});

test('a marked closed pull request reopens with the marker removed before CPR', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [
          pullRequest({ state: 'closed', body: `Automated update\n${marker}` }),
        ],
        hasNextPage: false,
      },
    ],
    eventPages: [
      {
        events: [event(1, '2026-10-02T00:00:00Z', botLogin)],
        hasNextPage: false,
      },
    ],
  });
  assert.deepEqual(await guard(fake, true), { action: 'reopen-then-run-cpr' });
  assert.deepEqual(fake.writes, [
    { number: 29, body: 'Automated update', state: 'open' },
  ]);
  assert.ok(fake.calls.indexOf('events:1') < fake.calls.indexOf('patch:open'));
});

test('a human latest close stops even when the no-diff marker remains', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [
          pullRequest({ state: 'closed', body: `Automated update\n${marker}` }),
        ],
        hasNextPage: false,
      },
    ],
    eventPages: [
      {
        events: [event(2, '2026-10-03T00:00:00Z', 'human')],
        hasNextPage: false,
      },
    ],
  });
  assert.equal((await guard(fake, true)).action, 'stop');
  assert.deepEqual(fake.writes, []);
});

test('a bot close without a marker stops rather than reopening', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [pullRequest({ state: 'closed' })],
        hasNextPage: false,
      },
    ],
    eventPages: [
      {
        events: [event(2, '2026-10-03T00:00:00Z', botLogin)],
        hasNextPage: false,
      },
    ],
  });
  assert.equal((await guard(fake, true)).action, 'stop');
  assert.deepEqual(fake.writes, []);
});

test('event pagination finds a later human close and fails closed for a null actor', async () => {
  const pagedFake = createFake({
    pullRequestPages: [
      {
        items: [pullRequest({ state: 'closed', body: marker })],
        hasNextPage: false,
      },
    ],
    eventPages: [
      {
        events: [event(1, '2026-10-02T00:00:00Z', botLogin)],
        hasNextPage: true,
      },
      {
        events: [event(2, '2026-10-03T00:00:00Z', 'human')],
        hasNextPage: false,
      },
    ],
  });
  assert.equal((await guard(pagedFake, true)).action, 'stop');
  assert.ok(pagedFake.calls.includes('events:2'));

  const nullActorFake = createFake({
    pullRequestPages: [
      {
        items: [pullRequest({ state: 'closed', body: marker })],
        hasNextPage: false,
      },
    ],
    eventPages: [
      { events: [event(2, '2026-10-03T00:00:00Z', null)], hasNextPage: false },
    ],
  });
  assert.equal((await guard(nullActorFake, true)).action, 'stop');
});

test('API failures stop safely without making writes', async () => {
  for (const error of ['pull-requests', 'compare'] as const) {
    const fake = createFake({ error });
    assert.equal((await guard(fake, true)).action, 'stop');
    assert.deepEqual(fake.writes, []);
  }
  const eventsFake = createFake({
    error: 'events',
    pullRequestPages: [
      {
        items: [pullRequest({ state: 'closed', body: marker })],
        hasNextPage: false,
      },
    ],
  });
  assert.equal((await guard(eventsFake, true)).action, 'stop');
  assert.deepEqual(eventsFake.writes, []);
});

test('pull request listing pagination is completed before selecting the newest matching PR', async () => {
  const fake = createFake({
    pullRequestPages: [
      {
        items: [
          pullRequest({
            number: 29,
            state: 'closed',
            body: marker,
            createdAt: '2026-10-01T00:00:00Z',
          }),
        ],
        hasNextPage: true,
      },
      {
        items: [
          pullRequest({
            number: 31,
            state: 'closed',
            body: marker,
            createdAt: '2026-10-02T00:00:00Z',
          }),
        ],
        hasNextPage: false,
      },
    ],
    eventPages: [
      {
        events: [event(1, '2026-10-03T00:00:00Z', 'human')],
        hasNextPage: false,
      },
    ],
  });
  assert.equal((await guard(fake, true)).action, 'stop');
  assert.ok(fake.calls.includes('pull-requests:2'));
  assert.ok(fake.calls.includes('events:1'));
  assert.deepEqual(fake.writes, []);
});
