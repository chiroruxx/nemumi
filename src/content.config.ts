import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const articles = defineCollection({
  loader: glob({ base: './src/content/articles', pattern: '**/*.yaml' }),
  schema: z.object({
    date: z.coerce.date(),
    service: z.string(),
    title: z.string(),
    url: z.url().optional(),
  }),
});

const talks = defineCollection({
  loader: glob({ base: './src/content/talks', pattern: '**/*.yaml' }),
  schema: z.object({
    date: z.coerce.date(),
    title: z.string(),
    url: z.url().optional(),
  }),
});

const communities = defineCollection({
  loader: glob({ base: './src/content/communities', pattern: '**/*.yaml' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      url: z.url(),
      description: z.string(),
      image: image(),
      imageStyle: z.enum(['wordmark', 'square']),
      imageBackground: z.string().optional(),
      order: z.number().int(),
    }),
});

const activities = defineCollection({
  loader: glob({ base: './src/content/activities', pattern: '**/*.yaml' }),
  schema: z.object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    types: z.array(z.string()).min(1),
    title: z.string(),
    url: z.url().optional(),
    description: z.string().optional(),
  }),
});

export const collections = { articles, talks, communities, activities };
