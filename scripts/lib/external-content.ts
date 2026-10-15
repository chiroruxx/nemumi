import path from 'node:path';
import type {
  ExecutionContext,
  HttpRuntime,
  LinkVerifier,
} from './external-content-http.ts';
import type { LinkCheck } from './external-content-planning.ts';

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
