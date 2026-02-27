import { describe, expect, test, vi } from 'vitest';

import { PullRequest } from '../src/pull-request';
import type { CustomOctokit } from '../src/octokit';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

function createPR(handler: (route: string, params?: unknown) => unknown) {
  const octokit = {
    request: vi.fn((route: string, params?: Record<string, unknown>) => {
      const data = handler(route, params);
      if (data instanceof Error) return Promise.reject(data);
      return Promise.resolve({ data });
    }),
  } as unknown as CustomOctokit;

  return new PullRequest(octokit, 'owner', 'repo', 42);
}

// --- getFailedJobs ---

describe('PullRequest.getFailedJobs', () => {
  test('collects failed jobs across multiple workflow runs', async () => {
    const pr = createPR((route, params) => {
      if (route.includes('/logs')) {
        return 'log output';
      }
      if (route.includes('/jobs')) {
        const p = params as { run_id?: number };
        if (p?.run_id === 100)
          return {
            jobs: [
              { id: 1, name: 'build', conclusion: 'success' },
              { id: 2, name: 'test', conclusion: 'failure' },
            ],
          };
        if (p?.run_id === 200)
          return { jobs: [{ id: 3, name: 'eslint', conclusion: 'failure' }] };
      }
      if (route.includes('/actions/runs')) {
        return {
          workflow_runs: [
            { id: 100, name: 'CI' },
            { id: 200, name: 'Lint' },
          ],
        };
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await pr.getFailedJobs('abc123');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('CI / test');
    expect(result[1].name).toBe('Lint / eslint');
  });

  test('returns empty array when no workflow runs failed', async () => {
    const pr = createPR(route => {
      if (route.includes('/actions/runs')) return { workflow_runs: [] };
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await pr.getFailedJobs('abc123');
    expect(result).toEqual([]);
  });

  test('skips jobs where log fetching fails', async () => {
    let logCallCount = 0;
    const pr = createPR(route => {
      if (route.includes('/logs')) {
        logCallCount++;
        if (logCallCount === 1) throw new Error('404 Not Found');
        return 'success log';
      }
      if (route.includes('/jobs')) {
        return {
          jobs: [
            { id: 1, name: 'test-a', conclusion: 'failure' },
            { id: 2, name: 'test-b', conclusion: 'failure' },
          ],
        };
      }
      if (route.includes('/actions/runs'))
        return { workflow_runs: [{ id: 100, name: 'CI' }] };
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await pr.getFailedJobs('abc123');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CI / test-b');
  });

  test('truncates long logs', async () => {
    const longLog = 'x'.repeat(50_000);
    const pr = createPR(route => {
      if (route.includes('/logs')) return longLog;
      if (route.includes('/jobs'))
        return { jobs: [{ id: 1, name: 'test', conclusion: 'failure' }] };
      if (route.includes('/actions/runs'))
        return { workflow_runs: [{ id: 100, name: 'CI' }] };
      throw new Error(`Unexpected: ${route}`);
    });

    const result = await pr.getFailedJobs('abc123');
    expect(result[0].logs.length).toBeLessThan(longLog.length);
    expect(result[0].logs).toContain('truncated');
  });
});

// --- getHeadSha ---

describe('PullRequest.getHeadSha', () => {
  test('returns the head SHA from PR API', async () => {
    const pr = createPR(route => {
      if (route.includes('/pulls/')) return { head: { sha: 'abc123def456' } };
      throw new Error(`Unexpected: ${route}`);
    });

    const sha = await pr.getHeadSha();
    expect(sha).toBe('abc123def456');
  });
});

// --- getDiff ---

describe('PullRequest.getDiff', () => {
  test('fetches diff', async () => {
    const pr = createPR(() => 'diff content');
    const result = await pr.getDiff();
    expect(result).toBe('diff content');
  });
});

// --- getFailedCheckRuns ---

describe('PullRequest.getFailedCheckRuns', () => {
  test('returns failed check runs excluding github-actions', async () => {
    const pr = createPR(route => {
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

    const result = await pr.getFailedCheckRuns('abc123');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('rpm-build');
    expect(result[0].source).toBe('check-run');
  });
});

// --- getFailedCommitStatuses ---

describe('PullRequest.getFailedCommitStatuses', () => {
  test('returns failed and error commit statuses', async () => {
    const pr = createPR(route => {
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

    const result = await pr.getFailedCommitStatuses('abc123');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('CentOS CI (Stream 9)');
    expect(result[0].source).toBe('status');
  });
});
