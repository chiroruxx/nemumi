import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// テスト用ビルドでは固定 fixture を読み、実コンテンツの変更からテストを独立させる。
const contentBase =
  import.meta.env.MODE === 'test'
    ? './tests/fixtures/content'
    : './src/content';

const nonBlankString = z.string().refine((value) => value.trim().length > 0, {
  message: '空の文字列は指定できません',
});

const articles = defineCollection({
  loader: glob({ base: `${contentBase}/articles`, pattern: '**/*.yaml' }),
  schema: z.object({
    date: z.coerce.date(),
    types: z.array(nonBlankString).min(1).optional(),
    title: nonBlankString,
    url: z.url().optional(),
  }),
});

const talks = defineCollection({
  loader: glob({ base: `${contentBase}/talks`, pattern: '**/*.yaml' }),
  schema: z.object({
    date: z.coerce.date(),
    types: z.array(nonBlankString).min(1).optional(),
    title: nonBlankString,
    url: z.url().optional(),
  }),
});

const communities = defineCollection({
  loader: glob({ base: `${contentBase}/communities`, pattern: '**/*.yaml' }),
  schema: ({ image }) =>
    z.object({
      name: nonBlankString,
      url: z.url(),
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
      startDate: z.coerce.date(),
      endDate: z.coerce.date().optional(),
      types: z.array(nonBlankString).min(1).optional(),
      title: nonBlankString,
      url: z.url().optional(),
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
