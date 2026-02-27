export {
  pullRequestMetadataSchema,
  type PullRequestMetadata,
  actionConfigSchema,
  type ActionConfig,
} from './input';

export {
  geminiCommentSchema,
  type GeminiComment,
  geminiReviewResponseSchema,
  type GeminiReviewResponse,
} from './gemini';

export interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
}

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
