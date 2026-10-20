import { z } from 'zod';

export const contentDateSchema = z
  .union([z.string(), z.date()])
  .pipe(z.coerce.date());

/**
 * @internal Astro content.config.ts imports this; Knip v6.41.0 omits that config from production graph.
 */
export const contentUrlSchema = z.url().transform((value) => new URL(value));

/**
 * @internal Astro content.config.ts imports this; Knip v6.41.0 omits that config from production graph.
 */
export const nonBlankString = z
  .string()
  .refine((value) => value.trim().length > 0, {
    message: '空の文字列は指定できません',
  });

export const contentRecordSchema = z.object({
  date: contentDateSchema,
  types: z.array(nonBlankString).min(1).optional(),
  title: nonBlankString,
  url: contentUrlSchema.exactOptional(),
});
