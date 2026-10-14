import { z } from 'zod';

/** Shared zod argument builders: model-sent values are loose, so they are coerced. */
export const cut = (text: string | null | undefined, max: number) =>
  !text ? null : text.length > max ? `${text.slice(0, max)}…` : text;

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const optionalBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
);

export const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
    z.number().finite().min(min).max(max).optional(),
  );

export const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const date = new Date(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid date: ${v}`,
      });
      return z.NEVER;
    }
    return date;
  });
