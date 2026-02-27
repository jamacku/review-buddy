import { describe, expect, test, vi } from 'vitest';

import action from '../src/action';
import type { CustomOctokit } from '../src/octokit';
import type { ActionConfig } from '../src/schema';

const mockPullRequest = {
  number: 1,
  getHeadSha: vi.fn().mockResolvedValue('sha-from-api'),
  getDiff: vi.fn(),
  getFailedJobs: vi.fn().mockResolvedValue([]),
  getFailedCheckRuns: vi.fn().mockResolvedValue([]),
  getFailedCommitStatuses: vi.fn().mockResolvedValue([]),
};

vi.mock('../src/pull-request', () => ({
  PullRequest: class {
    number = mockPullRequest.number;
    getHeadSha = mockPullRequest.getHeadSha;
    getDiff = mockPullRequest.getDiff;
    getFailedJobs = mockPullRequest.getFailedJobs;
    getFailedCheckRuns = mockPullRequest.getFailedCheckRuns;
    getFailedCommitStatuses = mockPullRequest.getFailedCommitStatuses;
  },
}));

vi.mock('../src/review', async importOriginal => {
  const { Review: OrigReview } =
    await importOriginal<typeof import('../src/review')>();
  return {
    Review: {
      FINGERPRINT_MARKER: OrigReview.FINGERPRINT_MARKER,
      computeFingerprint: OrigReview.computeFingerprint,
      formatBody: OrigReview.formatBody,
      formatStatus: OrigReview.formatStatus,
      formatSkippedStatus: OrigReview.formatSkippedStatus,
      formatErrorStatus: OrigReview.formatErrorStatus,
      findExistingFingerprint: vi.fn().mockResolvedValue(null),
      post: vi.fn().mockResolvedValue(999),
    },
  };
});

vi.mock('../src/gemini', () => ({
  GeminiClient: class {
    analyzeFailure = vi.fn();
  },
}));

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

describe('action - schedule/workflow_dispatch (no workflow_run payload)', () => {
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

  test('falls back to PR API when workflow_run payload is missing', async () => {
    const status = await action({} as CustomOctokit, mockConfig);

    expect(mockPullRequest.getHeadSha).toHaveBeenCalled();
    expect(status).toContain('No CI failures detected');
  });
});
