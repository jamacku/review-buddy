import { z } from 'zod';

export const geminiCommentSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  body: z.string(),
});

export type GeminiComment = z.infer<typeof geminiCommentSchema>;

export const geminiReviewResponseSchema = z.object({
  summary: z.string(),
  comments: z.array(geminiCommentSchema),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type GeminiReviewResponse = z.infer<typeof geminiReviewResponseSchema>;
