import { info, warning } from '@actions/core';

import type { CustomOctokit } from './octokit';
import type { ExternalFailure, FailedJob, ReviewComment } from './schema';

export async function getFailedJobs(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  headSha: string
): Promise<FailedJob[]> {
  // Find all failed workflow runs for this commit SHA
  const runsResponse = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/runs',
    { owner, repo, head_sha: headSha, status: 'failure', per_page: 100 }
  );

  const failedRuns = runsResponse.data.workflow_runs;

  if (failedRuns.length === 0) {
    info('No failed workflow runs found for this commit');
    return [];
  }

  info(
    `Found ${failedRuns.length} failed workflow run(s): ${failedRuns.map((r: { name: string }) => r.name).join(', ')}`
  );

  // Collect failed jobs across all failed workflow runs
  const results: FailedJob[] = [];

  for (const run of failedRuns) {
    const jobsResponse = await octokit.request(
      'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
      { owner, repo, run_id: run.id, filter: 'latest', per_page: 100 }
    );

    const failedJobs = jobsResponse.data.jobs.filter(
      (job: { conclusion: string | null }) => job.conclusion === 'failure'
    );

    for (const job of failedJobs) {
      try {
        const logs = await getJobLogs(octokit, owner, repo, job.id);
        results.push({
          id: job.id,
          name: `${run.name} / ${job.name}`,
          conclusion: job.conclusion ?? 'failure',
          logs: truncateLogs(logs),
        });
      } catch (error) {
        warning(
          `Failed to fetch logs for job "${job.name}" (${job.id}): ${error}`
        );
      }
    }
  }

  if (results.length === 0) {
    info('No failed jobs found across workflow runs');
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

export async function getFailedCheckRuns(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  headSha: string
): Promise<ExternalFailure[]> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
    { owner, repo, ref: headSha, status: 'completed', per_page: 100 }
  );

  return response.data.check_runs
    .filter(
      (run: { conclusion: string | null; app: { slug: string } }) =>
        run.conclusion === 'failure' && run.app.slug !== 'github-actions'
    )
    .map(
      (run: {
        name: string;
        details_url: string | null;
        output: { summary: string | null };
        app: { slug: string };
      }) => ({
        name: run.name,
        description: run.output?.summary || `Check run from ${run.app.slug}`,
        url: run.details_url || '',
        source: 'check-run' as const,
      })
    );
}

export async function getFailedCommitStatuses(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  headSha: string
): Promise<ExternalFailure[]> {
  const response = await octokit.request(
    'GET /repos/{owner}/{repo}/commits/{ref}/status',
    { owner, repo, ref: headSha }
  );

  return response.data.statuses
    .filter(
      (status: { state: string }) =>
        status.state === 'failure' || status.state === 'error'
    )
    .map(
      (status: {
        context: string;
        description: string | null;
        target_url: string | null;
      }) => ({
        name: status.context,
        description: status.description || '',
        url: status.target_url || '',
        source: 'status' as const,
      })
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
