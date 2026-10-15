import path from 'node:path';
import type {
  ExecutionContext,
  HttpRuntime,
  LinkVerifier,
} from './external-content-http.ts';
import type { LinkCheck } from './external-content-planning.ts';

const services = {
  sizu: {
    label: 'しずかなインターネット',
    feed: 'https://sizu.me/chihiroxx/rss',
    collection: 'articles',
    type: '日常記事',
    host: 'sizu.me',
    pathPrefix: '/chihiroxx/posts/',
  },
  hatena: {
    label: 'はてなブログ',
    feed: 'https://toyo.hatenablog.jp/rss',
    collection: 'articles',
    type: 'テック記事',
    host: 'toyo.hatenablog.jp',
    pathPrefix: '/entry/',
  },
  speakerdeck: {
    label: 'Speaker Deck',
    feed: 'https://speakerdeck.com/chiroruxx.rss',
    collection: 'talks',
    type: '登壇資料',
    host: 'speakerdeck.com',
    pathPrefix: '/chiroruxx/',
  },
} as const;

export type Source = keyof typeof services;
export type Service = (typeof services)[Source];

export function getSources(): Source[] {
  return Object.keys(services) as Source[];
}

export function getService(source: Source): Service {
  if (!isSource(source)) throw new Error(`Unknown service: ${source}`);
  return services[source];
}

export function isSource(value: string | undefined): value is Source {
  return value !== undefined && Object.hasOwn(services, value);
}

export const defaultContentDirectory = path.resolve('src/content');

export type CommonContentOptions = {
  dryRun?: boolean;
  contentDirectory?: string;
  linkVerifier?: LinkVerifier;
  executionBudgetMs?: number;
  executionContext?: ExecutionContext;
  linkCheckBatchIntervalMs?: number;
  now?: () => number;
  sleep?: HttpRuntime['sleep'];
};

export type ContentResult = {
  deferred: LinkCheck[];
  review: LinkCheck[];
  unchecked: LinkCheck[];
};
