import { info, warning } from '@actions/core';

import type { CustomOctokit } from './octokit';
import type { FailedJob, ReviewComment } from './schema';

export async function getFailedJobs(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  runId: number
): Promise<FailedJob[]> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
    { owner, repo, run_id: runId, filter: 'latest', per_page: 100 }
  );

  const failedJobs = response.data.jobs.filter(
    (job: { conclusion: string | null }) => job.conclusion === 'failure'
  );

  if (failedJobs.length === 0) {
    info('No failed jobs found in the workflow run');
    return [];
  }

  const results: FailedJob[] = [];

  for (const job of failedJobs) {
    try {
      const logs = await getJobLogs(octokit, owner, repo, job.id);
      results.push({
        id: job.id,
        name: job.name,
        conclusion: job.conclusion ?? 'failure',
        logs: truncateLogs(logs),
      });
    } catch (error) {
      warning(
        `Failed to fetch logs for job "${job.name}" (${job.id}): ${error}`
      );
    }
  }

  return results;
}

async function getJobLogs(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  jobId: number
): Promise<string> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
    { owner, repo, job_id: jobId }
  );

  return typeof response.data === 'string'
    ? response.data
    : String(response.data);
}

function truncateLogs(logs: string, maxChars: number = 30_000): string {
  if (logs.length <= maxChars) return logs;
  return (
    `... [truncated, showing last ${maxChars} chars] ...\n` +
    logs.slice(-maxChars)
  );
}

export async function getPullRequestDiff(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}',
    {
      owner,
      repo,
      pull_number: pullNumber,
      headers: { accept: 'application/vnd.github.v3.diff' },
    }
  );

  return typeof response.data === 'string'
    ? response.data
    : String(response.data);
}

export function truncateDiff(diff: string, maxChars: number = 50_000): string {
  if (diff.length <= maxChars) return diff;
  return (
    diff.slice(0, maxChars) +
    `\n... [diff truncated, showing first ${maxChars} chars] ...`
  );
}

export async function createPullRequestReview(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitId: string,
  body: string,
  comments: ReviewComment[],
  event: 'COMMENT' | 'REQUEST_CHANGES'
): Promise<number> {
  const apiComments = comments.map(comment => ({
    path: comment.path,
    line: comment.line,
    side: comment.side as 'RIGHT',
    body: comment.body,
  }));

  const response = await octokit.request(
    'POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews',
    {
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: commitId,
      body,
      event,
      comments: apiComments,
    }
  );

  return response.data.id;
}
