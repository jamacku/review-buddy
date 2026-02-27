import { info, warning } from '@actions/core';
import { context } from '@actions/github';

import type { CustomOctokit } from './octokit';
import { GeminiClient } from './gemini';
import {
  getFailedJobs,
  getFailedCheckRuns,
  getFailedCommitStatuses,
  getPullRequestDiff,
  getPullRequestHeadSha,
  truncateDiff,
  createPullRequestReview,
} from './github';
import { buildPrompt } from './prompt';
import type {
  ActionConfig,
  GeminiReviewResponse,
  ReviewComment,
} from './schema';

export default async function action(
  octokit: CustomOctokit,
  config: ActionConfig
): Promise<string> {
  const { prMetadata, owner, repo, geminiApiKey, model, reviewEvent } = config;
  const { number: pullNumber } = prMetadata;

  const headSha = await resolveHeadSha(octokit, owner, repo, pullNumber);

  info(`Analyzing PR #${pullNumber} (commit: ${headSha.slice(0, 7)})`);

  info('Fetching failed CI job logs...');
  const [failedJobs, failedCheckRuns, failedStatuses] = await Promise.all([
    getFailedJobs(octokit, owner, repo, headSha),
    getFailedCheckRuns(octokit, owner, repo, headSha),
    getFailedCommitStatuses(octokit, owner, repo, headSha),
  ]);

  const externalFailures = [...failedCheckRuns, ...failedStatuses];
  const totalFailures = failedJobs.length + externalFailures.length;

  if (totalFailures === 0) {
    info('No failed jobs found. Nothing to review.');
    return formatStatus(null);
  }

  info(`Found ${failedJobs.length} failed job(s)`);
  if (externalFailures.length > 0) {
    info(
      `Found ${externalFailures.length} external CI failure(s): ${externalFailures.map(f => f.name).join(', ')}`
    );
  }

  info('Fetching PR diff...');
  const rawDiff = await getPullRequestDiff(octokit, owner, repo, pullNumber);
  const diff = truncateDiff(rawDiff);
  info(`PR diff: ${rawDiff.length} chars (${diff.length} after truncation)`);

  const prompt = buildPrompt(diff, failedJobs, externalFailures);
  info(`Prompt size: ${prompt.length} chars`);

  const gemini = new GeminiClient(geminiApiKey, model);
  let analysis: GeminiReviewResponse;

  try {
    analysis = await gemini.analyzeFailure(prompt);
  } catch (error) {
    warning(`Gemini analysis failed: ${error}`);
    return '';
  }

  info(
    `Gemini analysis: ${analysis.comments.length} comments, confidence: ${analysis.confidence}`
  );

  // Map Gemini comments to ReviewComments (add side: RIGHT)
  const reviewComments: ReviewComment[] = analysis.comments.map(c => ({
    path: c.path,
    line: c.line,
    side: 'RIGHT' as const,
    body: c.body,
  }));

  const reviewBody = formatReviewBody(analysis);

  if (reviewComments.length > 0) {
    try {
      const reviewId = await createPullRequestReview(
        octokit,
        owner,
        repo,
        pullNumber,
        headSha,
        reviewBody,
        reviewComments,
        reviewEvent
      );
      info(
        `Posted review #${reviewId} with ${reviewComments.length} inline comments`
      );
      return formatStatus(analysis, reviewId);
    } catch (error) {
      warning(`Failed to create review with inline comments: ${error}`);
      return formatStatus(analysis);
    }
  }

  return formatStatus(analysis);
}

function formatReviewBody(analysis: GeminiReviewResponse): string {
  const badge = confidenceBadge(analysis.confidence);
  return `## Review Buddy - CI Failure Analysis\n\n${badge} **Confidence:** ${analysis.confidence}\n\n${analysis.summary}`;
}

function confidenceBadge(confidence: string): string {
  switch (confidence) {
    case 'high':
      return ':green_circle:';
    case 'medium':
      return ':yellow_circle:';
    default:
      return ':orange_circle:';
  }
}

function formatStatus(
  analysis: GeminiReviewResponse | null,
  reviewId?: number
): string {
  if (!analysis) {
    return ':green_circle: No CI failures detected';
  }

  const badge = confidenceBadge(analysis.confidence);
  const lines: string[] = [];

  if (reviewId !== undefined) {
    lines.push(
      `${badge} ${analysis.comments.length} CI failure comment(s) posted (confidence: ${analysis.confidence})`
    );
  } else if (analysis.comments.length > 0) {
    lines.push(
      `${badge} ${analysis.comments.length} CI failure(s) analyzed but review could not be posted (confidence: ${analysis.confidence})`
    );
  } else {
    lines.push(
      `${badge} CI failures analyzed - no code changes identified as the cause (confidence: ${analysis.confidence})`
    );
  }

  lines.push('');
  lines.push(analysis.summary);

  return lines.join('\n');
}

async function resolveHeadSha(
  octokit: CustomOctokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  // Try workflow_run payload first (available for workflow_run triggers)
  const payloadSha = context.payload?.workflow_run?.head_sha;
  if (payloadSha) {
    info(`Head SHA from workflow_run payload: ${payloadSha}`);
    return payloadSha as string;
  }

  // Fallback: fetch head SHA from PR API (works for schedule, workflow_dispatch, etc.)
  info('No workflow_run payload, fetching head SHA from PR API...');
  return getPullRequestHeadSha(octokit, owner, repo, pullNumber);
}
