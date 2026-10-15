import { z } from 'zod';

export const contentDateSchema = z
  .union([z.string(), z.date()])
  .pipe(z.coerce.date());

export const contentUrlSchema = z.url().transform((value) => new URL(value));

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
