import { z } from 'zod';

const singleCommitMetadataSchema = z.object({
  sha: z.string(),
  url: z.string().url(),
  message: z.object({
    title: z.string(),
    body: z.string(),
    cherryPick: z.array(
      z.object({
        sha: z.string(),
      })
    ),
    revert: z.array(
      z.object({
        sha: z.string(),
      })
    ),
  }),
});

const issueMetadataSchema = z.record(z.string(), z.unknown());

export const pullRequestMetadataSchema = z.object({
  number: z.number(),
  base: z.string(),
  ref: z.string(),
  url: z.string().url(),
  labels: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      description: z.string().nullable(),
    })
  ),
  milestone: z
    .object({
      title: z.string().optional(),
    })
    .nullable(),
  commits: z.array(singleCommitMetadataSchema),
  metadata: z.array(issueMetadataSchema),
});

export type PullRequestMetadata = z.infer<typeof pullRequestMetadataSchema>;

export const actionConfigSchema = z.object({
  prMetadata: pullRequestMetadataSchema,
  token: z.string().min(1),
  geminiApiKey: z.string().min(1),
  model: z.string().default('gemini-2.5-flash'),
  reviewEvent: z.enum(['COMMENT', 'REQUEST_CHANGES']).default('COMMENT'),
  owner: z.string(),
  repo: z.string(),
});

export type ActionConfig = z.infer<typeof actionConfigSchema>;

export const reviewCommentSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  side: z.literal('RIGHT'),
  body: z.string(),
});

export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const geminiReviewResponseSchema = z.object({
  summary: z.string(),
  comments: z.array(reviewCommentSchema),
  confidence: z.enum(['high', 'medium', 'low']),
});

export type GeminiReviewResponse = z.infer<typeof geminiReviewResponseSchema>;

export interface FailedJob {
  id: number;
  name: string;
  conclusion: string;
  logs: string;
}

export interface ExternalFailure {
  name: string;
  description: string;
  url: string;
  source: 'check-run' | 'status';
}
