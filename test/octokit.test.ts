import { describe, expect, test, vi } from 'vitest';

import { getOctokit } from '../src/octokit';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

describe('getOctokit', () => {
  test('returns an Octokit instance with request method', () => {
    const octokit = getOctokit('ghp_test_token');
    expect(octokit).toBeDefined();
    expect(typeof octokit.request).toBe('function');
  });
});
