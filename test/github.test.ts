import { describe, expect, test, vi } from 'vitest';

import {
  getFailedJobs,
  getFailedCheckRuns,
  getFailedCommitStatuses,
  getPullRequestDiff,
  truncateDiff,
  createPullRequestReview,
} from '../src/github';
import type { CustomOctokit } from '../src/octokit';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

// Helper to create a mock octokit that routes requests
function createMockOctokit(handler: (route: string) => unknown) {
  return {
    request: vi.fn((route: string) => {
      const data = handler(route);
      if (data instanceof Error) return Promise.reject(data);
      return Promise.resolve({ data });
    }),
  } as unknown as CustomOctokit;
}

// --- getFailedJobs ---

describe('getFailedJobs', () => {
  test('collects failed jobs across multiple workflow runs', async () => {
    const octokit = {
      request: vi.fn((route: string, params?: Record<string, unknown>) => {
        if (route.includes('/actions/runs') && !route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              workflow_runs: [
                { id: 100, name: 'CI' },
                { id: 200, name: 'Lint' },
              ],
            },
          });
        }
        if (route.includes('/jobs')) {
          const runId = params?.run_id;
          if (runId === 100) {
            return Promise.resolve({
              data: {
                jobs: [
                  { id: 1, name: 'build', conclusion: 'success' },
                  { id: 2, name: 'test', conclusion: 'failure' },
                ],
              },
            });
          }
          if (runId === 200) {
            return Promise.resolve({
              data: {
                jobs: [{ id: 3, name: 'eslint', conclusion: 'failure' }],
              },
            });
          }
        }
        if (route.includes('/logs')) {
          return Promise.resolve({ data: 'log output' });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 'abc123');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: 2,
      name: 'CI / test',
      conclusion: 'failure',
      logs: 'log output',
    });
    expect(result[1]).toEqual({
      id: 3,
      name: 'Lint / eslint',
      conclusion: 'failure',
      logs: 'log output',
    });
  });

  test('returns empty array when no workflow runs failed', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/actions/runs')) {
        return { workflow_runs: [] };
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await getFailedJobs(octokit, 'owner', 'repo', 'abc123');
    expect(result).toEqual([]);
  });

  test('returns empty array when failed runs have no failed jobs', async () => {
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/actions/runs') && !route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              workflow_runs: [{ id: 100, name: 'CI' }],
            },
          });
        }
        if (route.includes('/jobs')) {
          return Promise.resolve({
            data: {
              jobs: [{ id: 1, name: 'test', conclusion: 'success' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 'abc123');
    expect(result).toEqual([]);
  });

  test('skips jobs where log fetching fails', async () => {
    let logCallCount = 0;
    const octokit = {
      request: vi.fn((route: string) => {
        if (route.includes('/logs')) {
          logCallCount++;
          if (logCallCount === 1) {
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
        if (route.includes('/actions/runs')) {
          return Promise.resolve({
            data: {
              workflow_runs: [{ id: 100, name: 'CI' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 'abc123');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CI / test-b');
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
        if (route.includes('/actions/runs')) {
          return Promise.resolve({
            data: {
              workflow_runs: [{ id: 100, name: 'CI' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 'abc123');

    expect(result[0].logs.length).toBeLessThan(longLog.length);
    expect(result[0].logs).toContain('truncated');
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
        if (route.includes('/actions/runs')) {
          return Promise.resolve({
            data: {
              workflow_runs: [{ id: 100, name: 'CI' }],
            },
          });
        }
        return Promise.reject(new Error(`Unexpected: ${route}`));
      }),
    } as unknown as CustomOctokit;

    const result = await getFailedJobs(octokit, 'owner', 'repo', 'abc123');
    expect(result[0].logs).toBe('12345');
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

// --- getFailedCheckRuns ---

describe('getFailedCheckRuns', () => {
  test('returns failed check runs excluding github-actions', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/check-runs')) {
        return {
          check_runs: [
            {
              name: 'rpm-build',
              conclusion: 'failure',
              app: { slug: 'packit-as-a-service' },
              details_url: 'https://dashboard.packit.dev/123',
              output: { summary: 'RPM build failed' },
            },
            {
              name: 'build (gcc)',
              conclusion: 'failure',
              app: { slug: 'github-actions' },
              details_url: 'https://github.com/...',
              output: { summary: null },
            },
            {
              name: 'CodeQL',
              conclusion: 'success',
              app: { slug: 'github-advanced-security' },
              details_url: 'https://github.com/...',
              output: { summary: null },
            },
          ],
        };
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await getFailedCheckRuns(octokit, 'owner', 'repo', 'abc123');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'rpm-build',
      description: 'RPM build failed',
      url: 'https://dashboard.packit.dev/123',
      source: 'check-run',
    });
  });

  test('returns empty array when no check runs failed', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/check-runs')) {
        return {
          check_runs: [
            {
              name: 'test',
              conclusion: 'success',
              app: { slug: 'packit' },
              details_url: null,
              output: { summary: null },
            },
          ],
        };
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await getFailedCheckRuns(octokit, 'owner', 'repo', 'abc123');
    expect(result).toEqual([]);
  });
});

// --- getFailedCommitStatuses ---

describe('getFailedCommitStatuses', () => {
  test('returns failed and error commit statuses', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/status')) {
        return {
          statuses: [
            {
              context: 'CentOS CI (Stream 9)',
              state: 'failure',
              description: 'build failed',
              target_url: 'https://jenkins.example.com/job/123/',
            },
            {
              context: 'CentOS CI (sanitizers)',
              state: 'error',
              description: 'infrastructure error',
              target_url: 'https://jenkins.example.com/job/456/',
            },
            {
              context: 'Other CI',
              state: 'success',
              description: 'build passed',
              target_url: 'https://ci.example.com/789/',
            },
          ],
        };
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await getFailedCommitStatuses(
      octokit,
      'owner',
      'repo',
      'abc123'
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      name: 'CentOS CI (Stream 9)',
      description: 'build failed',
      url: 'https://jenkins.example.com/job/123/',
      source: 'status',
    });
    expect(result[1]).toEqual({
      name: 'CentOS CI (sanitizers)',
      description: 'infrastructure error',
      url: 'https://jenkins.example.com/job/456/',
      source: 'status',
    });
  });

  test('returns empty array when all statuses pass', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/status')) {
        return {
          statuses: [
            {
              context: 'CI',
              state: 'success',
              description: 'ok',
              target_url: null,
            },
          ],
        };
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await getFailedCommitStatuses(
      octokit,
      'owner',
      'repo',
      'abc123'
    );
    expect(result).toEqual([]);
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
          {
            path: 'src/util.ts',
            line: 20,
            side: 'RIGHT',
            body: 'And this',
          },
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
