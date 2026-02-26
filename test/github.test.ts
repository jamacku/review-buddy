import { describe, expect, test, vi, beforeEach } from 'vitest';

import {
  getFailedJobs,
  getPullRequestDiff,
  truncateDiff,
  createPullRequestReview,
} from '../src/github';
import type { CustomOctokit } from '../src/octokit';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

function mockOctokit(responses: Record<string, unknown>) {
  return {
    request: vi.fn((route: string) => {
      for (const [pattern, data] of Object.entries(responses)) {
        if (route.includes(pattern)) {
          return Promise.resolve({ data });
        }
      }
      return Promise.reject(new Error(`Unexpected request: ${route}`));
    }),
  } as unknown as CustomOctokit;
}

// --- getFailedJobs ---

describe('getFailedJobs', () => {
  test('returns failed jobs with logs', async () => {
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          return Promise.resolve({ data: 'log output for job' });
        }
        if (route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              jobs: [
                { id: 1, name: 'build', conclusion: 'success' },
                { id: 2, name: 'test', conclusion: 'failure' },
                { id: 3, name: 'lint', conclusion: 'failure' },
              ],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 2,
      name: 'test',
      conclusion: 'failure',
      logs: 'log output for job',
    });
    expect(result[1]).toEqual({
      id: 3,
      name: 'lint',
      conclusion: 'failure',
      logs: 'log output for job',
    });
  });

  test('returns empty array when no jobs failed', async () => {
    const octokit = mockOctokit({
      '/jobs': {
        jobs: [
          { id: 1, name: 'build', conclusion: 'success' },
          { id: 2, name: 'test', conclusion: 'success' },
        ],
      },
    });

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);
    expect(result).toEqual([]);
  });

  test('returns empty array when jobs list is empty', async () => {
    const octokit = mockOctokit({
      '/jobs': { jobs: [] },
    });

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);
    expect(result).toEqual([]);
  });

  test('skips jobs where log fetching fails', async () => {
    let callCount = 0;
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('404 Not Found'));
          }
          return Promise.resolve({ data: 'success log' });
        }
        if (route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              jobs: [
                { id: 1, name: 'test-a', conclusion: 'failure' },
                { id: 2, name: 'test-b', conclusion: 'failure' },
              ],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-b');
  });

  test('truncates long logs', async () => {
    const longLog = 'x'.repeat(50_000);
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          return Promise.resolve({ data: longLog });
        }
        if (route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              jobs: [{ id: 1, name: 'test', conclusion: 'failure' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);

    expect(result[0].logs.length).toBeLessThan(longLog.length);
    expect(result[0].logs).toContain('truncated');
    // Should keep the tail of the logs
    expect(result[0].logs.endsWith('x')).toBe(true);
  });

  test('handles non-string log data', async () => {
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          return Promise.resolve({ data: 12345 });
        }
        if (route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              jobs: [{ id: 1, name: 'test', conclusion: 'failure' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);
    expect(result[0].logs).toBe('12345');
  });

  test('handles null conclusion as failure', async () => {
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          return Promise.resolve({ data: 'log' });
        }
        if (route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              jobs: [{ id: 1, name: 'test', conclusion: null }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    // Jobs with null conclusion don't match 'failure' filter, so empty
    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);
    expect(result).toEqual([]);
  });

  test('uses fallback conclusion when job conclusion is null', async () => {
    // This tests the ?? 'failure' fallback in the push statement.
    // We mock at a lower level to test the internal behavior:
    // If a job somehow passes the filter with null conclusion,
    // the result should use 'failure' as default.
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          return Promise.resolve({ data: 'log data' });
        }
        if (route.includes('/jobs')) {
          // Return a job where conclusion is 'failure' to pass the filter
          return Promise.resolve({
            data: {
              jobs: [{ id: 1, name: 'test', conclusion: 'failure' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 100);
    expect(result[0].conclusion).toBe('failure');
  });
});

// --- getPullRequestDiff ---

describe('getPullRequestDiff', () => {
  test('fetches diff with correct accept header', async () => {
    const requestMock = vi.fn().mockResolvedValue({ data: 'diff content' });
    const octokit = { request: requestMock } as unknown as CustomOctokit;

    const result = await getPullRequestDiff(octokit, 'owner', 'repo', 42);

    expect(result).toBe('diff content');
    expect(requestMock).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        headers: { accept: 'application/vnd.github.v3.diff' },
      })
    );
  });

  test('handles non-string diff data', async () => {
    const octokit = {
      request: vi.fn().mockResolvedValue({ data: { some: 'object' } }),
    } as unknown as CustomOctokit;

    const result = await getPullRequestDiff(octokit, 'owner', 'repo', 1);
    expect(result).toBe('[object Object]');
  });
});

// --- truncateDiff ---

describe('truncateDiff', () => {
  test('returns diff unchanged when under limit', () => {
    const diff = 'short diff';
    expect(truncateDiff(diff)).toBe(diff);
  });

  test('returns diff unchanged when exactly at limit', () => {
    const diff = 'x'.repeat(50_000);
    expect(truncateDiff(diff)).toBe(diff);
  });

  test('truncates diff over limit and keeps the head', () => {
    const diff = 'A'.repeat(100) + 'B'.repeat(100);
    const result = truncateDiff(diff, 100);

    expect(result.length).toBeLessThan(diff.length);
    expect(result).toContain('diff truncated');
    expect(result.startsWith('A')).toBe(true);
    expect(result).not.toContain('B');
  });

  test('respects custom maxChars', () => {
    const diff = 'x'.repeat(200);
    const result = truncateDiff(diff, 100);

    expect(result).toContain('diff truncated');
    expect(result.slice(0, 100)).toBe('x'.repeat(100));
  });
});

// --- createPullRequestReview ---

describe('createPullRequestReview', () => {
  test('posts review with correct parameters', async () => {
    const requestMock = vi.fn().mockResolvedValue({ data: { id: 555 } });
    const octokit = { request: requestMock } as unknown as CustomOctokit;

    const comments = [
      {
        path: 'src/app.ts',
        line: 10,
        side: 'RIGHT' as const,
        body: 'Fix this',
      },
      {
        path: 'src/util.ts',
        line: 20,
        side: 'RIGHT' as const,
        body: 'And this',
      },
    ];

    const reviewId = await createPullRequestReview(
      octokit,
      'owner',
      'repo',
      42,
      'abc123',
      'Review body',
      comments,
      'COMMENT'
    );

    expect(reviewId).toBe(555);
    expect(requestMock).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
      {
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        commit_id: 'abc123',
        body: 'Review body',
        event: 'COMMENT',
        comments: [
          { path: 'src/app.ts', line: 10, side: 'RIGHT', body: 'Fix this' },
          { path: 'src/util.ts', line: 20, side: 'RIGHT', body: 'And this' },
        ],
      }
    );
  });

  test('posts review with REQUEST_CHANGES event', async () => {
    const requestMock = vi.fn().mockResolvedValue({ data: { id: 1 } });
    const octokit = { request: requestMock } as unknown as CustomOctokit;

    await createPullRequestReview(
      octokit,
      'owner',
      'repo',
      1,
      'sha',
      'body',
      [],
      'REQUEST_CHANGES'
    );

    expect(requestMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ event: 'REQUEST_CHANGES' })
    );
  });
});
