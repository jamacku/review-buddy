import { describe, expect, test, vi } from 'vitest';

import action from '../src/action';
import type { CustomOctokit } from '../src/octokit';
import type { ActionConfig } from '../src/schema';

vi.mock('../src/github', () => ({
  getFailedJobs: vi.fn(),
  getPullRequestDiff: vi.fn(),
  truncateDiff: vi.fn((diff: string) => diff),
  createPullRequestReview: vi.fn(),
}));

vi.mock('../src/gemini', () => {
  return {
    GeminiClient: class {
      analyzeFailure = vi.fn();
    },
  };
});

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@actions/github', async importOriginal => {
  const original = await importOriginal<typeof import('@actions/github')>();
  return {
    ...original,
    context: {
      ...original.context,
      repo: { owner: 'test-owner', repo: 'test-repo' },
      payload: {},
    },
  };
});

describe('action - missing workflow_run context', () => {
  const mockConfig: ActionConfig = {
    prMetadata: {
      number: 1,
      base: 'main',
      ref: 'abc123',
      url: 'https://github.com/owner/repo/pull/1',
      labels: [],
      milestone: null,
      commits: [],
      metadata: [],
    },
    token: 'token',
    geminiApiKey: 'key',
    model: 'gemini-2.5-flash',
    reviewEvent: 'COMMENT',
    owner: 'owner',
    repo: 'repo',
  };

  test('throws when workflow_run payload is missing', async () => {
    await expect(action({} as CustomOctokit, mockConfig)).rejects.toThrow(
      'Could not determine workflow run ID'
    );
  });
});
