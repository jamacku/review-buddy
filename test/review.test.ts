import { describe, expect, test, vi } from 'vitest';

import { Review } from '../src/review';
import type { CustomOctokit } from '../src/octokit';

function createMockOctokit(handler: (route: string) => unknown) {
  return {
    request: vi.fn((route: string) => {
      const data = handler(route);
      if (data instanceof Error) return Promise.reject(data);
      return Promise.resolve({ data });
    }),
  } as unknown as CustomOctokit;
}

// --- findExistingFingerprint ---

describe('Review.findExistingFingerprint', () => {
  test('returns fingerprint from existing review', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/reviews')) {
        return [
          { body: 'Some other review', user: { login: 'user1' } },
          {
            body: '## Review Buddy\n<!-- review-buddy-fingerprint:abc123def456 -->\nanalysis',
            user: { login: 'github-actions[bot]' },
          },
        ];
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const fp = await Review.findExistingFingerprint(
      octokit,
      'owner',
      'repo',
      1
    );
    expect(fp).toBe('abc123def456');
  });

  test('returns null when no Review Buddy reviews exist', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/reviews')) {
        return [
          { body: 'LGTM', user: { login: 'user1' } },
          { body: 'Nice work', user: { login: 'user2' } },
        ];
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const fp = await Review.findExistingFingerprint(
      octokit,
      'owner',
      'repo',
      1
    );
    expect(fp).toBeNull();
  });

  test('returns most recent fingerprint', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/reviews')) {
        return [
          {
            body: '<!-- review-buddy-fingerprint:aaa111bbb222ccc3 -->',
            user: { login: 'github-actions[bot]' },
          },
          {
            body: '<!-- review-buddy-fingerprint:ddd444eee555fff6 -->',
            user: { login: 'github-actions[bot]' },
          },
        ];
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const fp = await Review.findExistingFingerprint(
      octokit,
      'owner',
      'repo',
      1
    );
    expect(fp).toBe('ddd444eee555fff6');
  });

  test('returns null when reviews have no fingerprint', async () => {
    const octokit = createMockOctokit(route => {
      if (route.includes('/reviews')) {
        return [
          {
            body: '## Review Buddy - no fingerprint here',
            user: { login: 'github-actions[bot]' },
          },
        ];
      }
      throw new Error(`Unexpected: ${route}`);
    });

    const fp = await Review.findExistingFingerprint(
      octokit,
      'owner',
      'repo',
      1
    );
    expect(fp).toBeNull();
  });
});

// --- post ---

describe('Review.post', () => {
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

    const reviewId = await Review.post(
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
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        commit_id: 'abc123',
        event: 'COMMENT',
      })
    );
  });
});
