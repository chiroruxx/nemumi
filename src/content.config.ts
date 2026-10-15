import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import {
  contentDateSchema,
  contentRecordSchema,
  contentUrlSchema,
  nonBlankString,
} from './config/content-schema.ts';

// テスト用ビルドでは固定 fixture を読み、実コンテンツの変更からテストを独立させる。
const contentBase =
  import.meta.env.MODE === 'test'
    ? './tests/fixtures/content'
    : './src/content';

const articles = defineCollection({
  loader: glob({ base: `${contentBase}/articles`, pattern: '**/*.yaml' }),
  schema: contentRecordSchema,
});

const talks = defineCollection({
  loader: glob({ base: `${contentBase}/talks`, pattern: '**/*.yaml' }),
  schema: contentRecordSchema,
});

const communities = defineCollection({
  loader: glob({ base: `${contentBase}/communities`, pattern: '**/*.yaml' }),
  schema: ({ image }) =>
    z.object({
      name: nonBlankString,
      url: contentUrlSchema,
      description: nonBlankString,
      image: image(),
      imageStyle: z.enum(['wordmark', 'square']),
      imageBackground: z
        .string()
        .regex(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i)
        .optional(),
      order: z.number().int(),
    }),
});

const activities = defineCollection({
  loader: glob({ base: `${contentBase}/activities`, pattern: '**/*.yaml' }),
  schema: z
    .object({
      startDate: contentDateSchema,
      endDate: contentDateSchema.optional(),
      types: z.array(nonBlankString).min(1).optional(),
      title: nonBlankString,
      url: contentUrlSchema.optional(),
      description: nonBlankString.optional(),
    })
    .superRefine(({ startDate, endDate }, context) => {
      if (endDate && endDate < startDate) {
        context.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: '終了日は開始日以降の日付を指定してください',
        });
      }
    }),
});

export const collections = { articles, talks, communities, activities };
