import { getInput } from '@actions/core';
import { context } from '@actions/github';

import { raise } from './error';
import { actionConfigSchema, type ActionConfig } from './schema';

export function getConfig(): ActionConfig {
  const prMetadataRaw = getInput('pr-metadata', { required: true });
  const token = getInput('token', { required: true });
  const geminiApiKey = getInput('gemini-api-key', { required: true });
  const model = getInput('model') || undefined;
  const reviewEvent = getInput('review-event') || undefined;

  let prMetadata: unknown;
  try {
    prMetadata = JSON.parse(prMetadataRaw);
  } catch {
    raise('Failed to parse pr-metadata input as JSON');
  }

  const { owner, repo } = context.repo;

  const result = actionConfigSchema.safeParse({
    prMetadata,
    token,
    geminiApiKey,
    model,
    reviewEvent,
    owner,
    repo,
  });

  if (!result.success) {
    raise(`Invalid action configuration: ${result.error.message}`);
  }

  return result.data;
}
