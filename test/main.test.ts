import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import action from '../src/action';
import type { CustomOctokit } from '../src/octokit';
import { getConfig } from '../src/config';
import { buildPrompt } from '../src/prompt';
import {
  actionConfigSchema,
  geminiReviewResponseSchema,
  pullRequestMetadataSchema,
} from '../src/schema';
import type { ActionConfig } from '../src/schema';

// --- Schema validation tests ---

describe('pullRequestMetadataSchema', () => {
  const validMetadata = {
    number: 42,
    base: 'main',
    ref: 'abc1234',
    url: 'https://github.com/owner/repo/pull/42',
    labels: [],
    milestone: null,
    commits: [],
    metadata: [],
  };

  test('validates minimal metadata', () => {
    expect(pullRequestMetadataSchema.parse(validMetadata)).toEqual(
      validMetadata
    );
  });

  test('validates metadata with all fields populated', () => {
    const metadata = {
      ...validMetadata,
      labels: [{ id: 1, name: 'bug', description: 'Bug report' }],
      milestone: { title: 'v1.0' },
      commits: [
        {
          sha: 'abc1234',
          url: 'https://github.com/owner/repo/commit/abc1234',
          message: {
            title: 'fix: bug',
            body: '',
            cherryPick: [],
            revert: [],
          },
        },
      ],
      metadata: [{ key: 'value' }],
    };
    expect(pullRequestMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  test('validates metadata with nullable label description', () => {
    const metadata = {
      ...validMetadata,
      labels: [{ id: 1, name: 'bug', description: null }],
    };
    expect(pullRequestMetadataSchema.parse(metadata)).toEqual(metadata);
  });

  test('validates real-world metadata format', () => {
    const metadata = {
      number: 1,
      base: 'main',
      ref: 'main',
      url: 'https://github.com/owner/repo/pull/1',
      labels: [],
      milestone: {},
      commits: [
        {
          sha: '97e89986515411ff306861874618d347c46e380d',
          url: 'https://github.com/owner/repo/commit/97e899865154',
          message: {
            title: 'Add _TIMER_BASE_MIN to TimerBase enum',
            body: 'Add _TIMER_BASE_MIN to TimerBase enum',
            cherryPick: [],
            revert: [],
          },
        },
      ],
      metadata: [],
    };
    expect(() => pullRequestMetadataSchema.parse(metadata)).not.toThrow();
  });

  test('rejects metadata missing required fields', () => {
    expect(() => pullRequestMetadataSchema.parse({ number: 42 })).toThrow();
  });
});

describe('geminiReviewResponseSchema', () => {
  test('validates valid response', () => {
    const response = {
      summary: 'Test failed due to missing import',
      comments: [
        {
          path: 'src/main.ts',
          line: 10,
          side: 'RIGHT' as const,
          body: 'Missing import for `foo`',
        },
      ],
      confidence: 'high' as const,
    };
    expect(geminiReviewResponseSchema.parse(response)).toEqual(response);
  });

  test('validates response with empty comments', () => {
    const response = {
      summary: 'Infrastructure flake, not related to code changes',
      comments: [],
      confidence: 'low' as const,
    };
    expect(geminiReviewResponseSchema.parse(response)).toEqual(response);
  });

  test('rejects invalid confidence level', () => {
    expect(() =>
      geminiReviewResponseSchema.parse({
        summary: 'test',
        comments: [],
        confidence: 'unknown',
      })
    ).toThrow();
  });

  test('rejects comment with negative line number', () => {
    expect(() =>
      geminiReviewResponseSchema.parse({
        summary: 'test',
        comments: [{ path: 'a.ts', line: -1, side: 'RIGHT', body: 'bad' }],
        confidence: 'high',
      })
    ).toThrow();
  });

  test('rejects comment with wrong side', () => {
    expect(() =>
      geminiReviewResponseSchema.parse({
        summary: 'test',
        comments: [{ path: 'a.ts', line: 1, side: 'LEFT', body: 'bad' }],
        confidence: 'high',
      })
    ).toThrow();
  });
});

// --- Prompt tests ---

describe('buildPrompt', () => {
  test('includes diff and job logs', () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,3 @@\n-old\n+new';
    const jobs = [
      {
        id: 1,
        name: 'test',
        conclusion: 'failure',
        logs: 'Error: test failed',
      },
    ];

    const prompt = buildPrompt(diff, jobs, []);
    expect(prompt).toContain(diff);
    expect(prompt).toContain('Error: test failed');
    expect(prompt).toContain('Failed Job: "test"');
  });

  test('includes multiple failed jobs', () => {
    const diff = 'some diff';
    const jobs = [
      { id: 1, name: 'lint', conclusion: 'failure', logs: 'lint error' },
      { id: 2, name: 'test', conclusion: 'failure', logs: 'test error' },
    ];

    const prompt = buildPrompt(diff, jobs, []);
    expect(prompt).toContain('Failed Job: "lint"');
    expect(prompt).toContain('Failed Job: "test"');
    expect(prompt).toContain('lint error');
    expect(prompt).toContain('test error');
  });

  test('includes external CI failures', () => {
    const prompt = buildPrompt(
      'diff',
      [],
      [
        {
          name: 'CentOS CI',
          description: 'build failed',
          url: 'https://jenkins.example.com/job/123/',
          source: 'status',
        },
        {
          name: 'rpm-build:centos-9',
          description: 'RPM build error',
          url: 'https://dashboard.packit.dev/jobs/copr/123',
          source: 'check-run',
        },
      ]
    );
    expect(prompt).toContain('CentOS CI');
    expect(prompt).toContain('build failed');
    expect(prompt).toContain('https://jenkins.example.com/job/123/');
    expect(prompt).toContain('Commit Status');
    expect(prompt).toContain('rpm-build:centos-9');
    expect(prompt).toContain('Check Run');
  });

  test('includes JSON output format instructions', () => {
    const prompt = buildPrompt(
      'diff',
      [{ id: 1, name: 'test', conclusion: 'failure', logs: 'error' }],
      []
    );
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"comments"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('suggestion');
  });
});

// --- Config tests ---

describe('getConfig', () => {
  beforeEach(() => {
    vi.stubEnv(
      'INPUT_PR-METADATA',
      JSON.stringify({
        number: 1,
        base: 'main',
        ref: 'abc123',
        url: 'https://github.com/owner/repo/pull/1',
        labels: [],
        milestone: null,
        commits: [],
        metadata: [],
      })
    );
    vi.stubEnv('INPUT_TOKEN', 'ghp_test');
    vi.stubEnv('INPUT_GEMINI-API-KEY', 'test-api-key');
    vi.stubEnv('INPUT_MODEL', '');
    vi.stubEnv('INPUT_REVIEW-EVENT', '');
    vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('parses valid config with defaults', () => {
    const config = getConfig();
    expect(config.prMetadata.number).toBe(1);
    expect(config.token).toBe('ghp_test');
    expect(config.geminiApiKey).toBe('test-api-key');
    expect(config.model).toBe('gemini-2.5-flash');
    expect(config.reviewEvent).toBe('COMMENT');
    expect(config.owner).toBe('test-owner');
    expect(config.repo).toBe('test-repo');
  });

  test('parses custom model and review event', () => {
    vi.stubEnv('INPUT_MODEL', 'gemini-2.5-pro');
    vi.stubEnv('INPUT_REVIEW-EVENT', 'REQUEST_CHANGES');
    const config = getConfig();
    expect(config.model).toBe('gemini-2.5-pro');
    expect(config.reviewEvent).toBe('REQUEST_CHANGES');
  });

  test('throws on invalid pr-metadata JSON', () => {
    vi.stubEnv('INPUT_PR-METADATA', 'not-json');
    expect(() => getConfig()).toThrow('Failed to parse pr-metadata');
  });

  test('throws on missing pr-metadata fields', () => {
    vi.stubEnv('INPUT_PR-METADATA', JSON.stringify({ number: 1 }));
    expect(() => getConfig()).toThrow('Invalid action configuration');
  });
});

// --- Action orchestration tests ---

vi.mock('../src/github', () => ({
  getFailedJobs: vi.fn(),
  getFailedCheckRuns: vi.fn().mockResolvedValue([]),
  getFailedCommitStatuses: vi.fn().mockResolvedValue([]),
  getPullRequestDiff: vi.fn(),
  truncateDiff: vi.fn((diff: string) => diff),
  createPullRequestReview: vi.fn(),
}));

const mockAnalyzeFailure = vi.fn();

vi.mock('../src/gemini', () => {
  return {
    GeminiClient: class {
      analyzeFailure = mockAnalyzeFailure;
    },
  };
});

vi.mock('@actions/github', async importOriginal => {
  const original = await importOriginal<typeof import('@actions/github')>();
  return {
    ...original,
    context: {
      ...original.context,
      repo: { owner: 'test-owner', repo: 'test-repo' },
      payload: {
        workflow_run: { head_sha: 'abc1234567890' },
      },
    },
  };
});

describe('action', () => {
  const mockConfig: ActionConfig = {
    prMetadata: {
      number: 42,
      base: 'main',
      ref: 'abc1234567890',
      url: 'https://github.com/owner/repo/pull/42',
      labels: [],
      milestone: null,
      commits: [],
      metadata: [],
    },
    token: 'ghp_test',
    geminiApiKey: 'test-key',
    model: 'gemini-2.5-flash',
    reviewEvent: 'COMMENT',
    owner: 'test-owner',
    repo: 'test-repo',
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns no-failure status when no jobs failed', async () => {
    const { getFailedJobs } = await import('../src/github');
    vi.mocked(getFailedJobs).mockResolvedValue([]);

    const status = await action({} as CustomOctokit, mockConfig);
    expect(status).toContain('No CI failures detected');
  });

  test('posts review when Gemini returns inline comments', async () => {
    const { getFailedJobs, getPullRequestDiff, createPullRequestReview } =
      await import('../src/github');

    vi.mocked(getFailedJobs).mockResolvedValue([
      { id: 1, name: 'test', conclusion: 'failure', logs: 'Error: assertion' },
    ]);
    vi.mocked(getPullRequestDiff).mockResolvedValue('diff content');
    vi.mocked(createPullRequestReview).mockResolvedValue(999);

    mockAnalyzeFailure.mockResolvedValue({
      summary: 'Test assertion failure caused by missing null check',
      comments: [
        {
          path: 'src/main.ts',
          line: 10,
          side: 'RIGHT',
          body: 'Add null check',
        },
      ],
      confidence: 'high',
    });

    const status = await action({} as CustomOctokit, mockConfig);
    expect(status).toContain('1 CI failure comment(s) posted');
    expect(status).toContain('high');
    expect(createPullRequestReview).toHaveBeenCalledWith(
      expect.anything(),
      'test-owner',
      'test-repo',
      42,
      'abc1234567890',
      expect.stringContaining('Review Buddy'),
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/main.ts', line: 10 }),
      ]),
      'COMMENT'
    );
  });

  test('returns summary when Gemini returns no inline comments', async () => {
    const { getFailedJobs, getPullRequestDiff } = await import('../src/github');

    vi.mocked(getFailedJobs).mockResolvedValue([
      { id: 1, name: 'deploy', conclusion: 'failure', logs: 'Timeout' },
    ]);
    vi.mocked(getPullRequestDiff).mockResolvedValue('diff');

    mockAnalyzeFailure.mockResolvedValue({
      summary: 'Infrastructure timeout, not related to code changes',
      comments: [],
      confidence: 'low',
    });

    const status = await action({} as CustomOctokit, mockConfig);
    expect(status).toContain('no code changes identified');
    expect(status).toContain('low');
  });

  test('returns warning status when Gemini fails with Error', async () => {
    const { getFailedJobs, getPullRequestDiff } = await import('../src/github');

    vi.mocked(getFailedJobs).mockResolvedValue([
      { id: 1, name: 'test', conclusion: 'failure', logs: 'Error' },
    ]);
    vi.mocked(getPullRequestDiff).mockResolvedValue('diff');

    mockAnalyzeFailure.mockRejectedValue(new Error('API quota exceeded'));

    const status = await action({} as CustomOctokit, mockConfig);
    expect(status).toContain('could not be completed');
    expect(status).toContain('API quota exceeded');
  });

  test('returns warning status when Gemini fails with non-Error', async () => {
    const { getFailedJobs, getPullRequestDiff } = await import('../src/github');

    vi.mocked(getFailedJobs).mockResolvedValue([
      { id: 1, name: 'test', conclusion: 'failure', logs: 'Error' },
    ]);
    vi.mocked(getPullRequestDiff).mockResolvedValue('diff');

    mockAnalyzeFailure.mockRejectedValue('string error');

    const status = await action({} as CustomOctokit, mockConfig);
    expect(status).toContain('could not be completed');
    expect(status).toContain('string error');
  });

  test('handles review creation failure gracefully', async () => {
    const { getFailedJobs, getPullRequestDiff, createPullRequestReview } =
      await import('../src/github');

    vi.mocked(getFailedJobs).mockResolvedValue([
      { id: 1, name: 'test', conclusion: 'failure', logs: 'Error' },
    ]);
    vi.mocked(getPullRequestDiff).mockResolvedValue('diff');
    vi.mocked(createPullRequestReview).mockRejectedValue(
      new Error('Validation Failed')
    );

    mockAnalyzeFailure.mockResolvedValue({
      summary: 'Bug in the code',
      comments: [
        { path: 'src/main.ts', line: 99, side: 'RIGHT', body: 'Fix this' },
      ],
      confidence: 'medium',
    });

    const status = await action({} as CustomOctokit, mockConfig);
    expect(status).toContain('review could not be posted');
    expect(status).toContain('medium');
  });
});
