import { z } from 'zod';
import { normalizeText, textProblem, TEXT_PROBLEM_MESSAGES, type TextKind } from './text.js';

/**
 * A Zod string that is normalised, then refused if it breaks the rules for
 * its kind (see text.ts). Length bounds apply after normalising.
 */
export const zText = (options: { kind: TextKind; min?: number; max: number }) =>
  z
    .string()
    .transform((v) => normalizeText(v, options.kind))
    .superRefine((v, ctx) => {
      const problem = textProblem(v, options.kind);
      if (problem)
        ctx.addIssue({ code: 'custom', message: TEXT_PROBLEM_MESSAGES[problem], params: { problem } });
    })
    .pipe(
      z
        .string()
        .min(options.min ?? 0)
        .max(options.max),
    );
