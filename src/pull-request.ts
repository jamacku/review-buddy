import { info, warning } from '@actions/core';

import type { CustomOctokit } from './octokit';
import type { ExternalFailure, FailedJob } from './schema';
import { truncateLogs } from './util';

export class PullRequest {
  constructor(
    private readonly octokit: CustomOctokit,
    readonly owner: string,
    readonly repo: string,
    readonly number: number
  ) {}

  async getHeadSha(): Promise<string> {
    const response = await this.octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: this.owner, repo: this.repo, pull_number: this.number }
    );

    return response.data.head.sha;
  }

  async getDiff(): Promise<string> {
    const response = await this.octokit.request(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      {
        owner: this.owner,
        repo: this.repo,
        pull_number: this.number,
        headers: { accept: 'application/vnd.github.v3.diff' },
      }
    );

    return typeof response.data === 'string'
      ? response.data
      : String(response.data);
  }

  async getFailedJobs(headSha: string): Promise<FailedJob[]> {
    const runsResponse = await this.octokit.request(
      'GET /repos/{owner}/{repo}/actions/runs',
      {
        owner: this.owner,
        repo: this.repo,
        head_sha: headSha,
        status: 'failure',
        per_page: 100,
      }
    );

    const failedRuns = runsResponse.data.workflow_runs;

    if (failedRuns.length === 0) {
      info('No failed workflow runs found for this commit');
      return [];
    }

    info(
      `Found ${failedRuns.length} failed workflow run(s): ${failedRuns.map((r: { name: string }) => r.name).join(', ')}`
    );

    const results: FailedJob[] = [];

    for (const run of failedRuns) {
      const jobsResponse = await this.octokit.request(
        'GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
        {
          owner: this.owner,
          repo: this.repo,
          run_id: run.id,
          filter: 'latest',
          per_page: 100,
        }
      );

      const failedJobs = jobsResponse.data.jobs.filter(
        (job: { conclusion: string | null }) => job.conclusion === 'failure'
      );

      for (const job of failedJobs) {
        try {
          const logs = await this.getJobLogs(job.id);
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

  async getFailedCheckRuns(headSha: string): Promise<ExternalFailure[]> {
    const response = await this.octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      {
        owner: this.owner,
        repo: this.repo,
        ref: headSha,
        status: 'completed',
        per_page: 100,
      }
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

  async getFailedCommitStatuses(headSha: string): Promise<ExternalFailure[]> {
    const response = await this.octokit.request(
      'GET /repos/{owner}/{repo}/commits/{ref}/status',
      { owner: this.owner, repo: this.repo, ref: headSha }
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

  private async getJobLogs(jobId: number): Promise<string> {
    const response = await this.octokit.request(
      'GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs',
      { owner: this.owner, repo: this.repo, job_id: jobId }
    );

    return typeof response.data === 'string'
      ? response.data
      : String(response.data);
  }
}
