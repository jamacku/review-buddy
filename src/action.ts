import { info, warning } from '@actions/core';
import { context } from '@actions/github';

import type { CustomOctokit } from './octokit';
import { GeminiClient } from './gemini';
import {
  getFailedJobs,
  getPullRequestDiff,
  truncateDiff,
  createPullRequestReview,
} from './github';
import { buildPrompt } from './prompt';
import type { ActionConfig, GeminiReviewResponse } from './schema';

export default async function action(
  octokit: CustomOctokit,
  config: ActionConfig
): Promise<string> {
  const { prMetadata, owner, repo, geminiApiKey, model, reviewEvent } = config;
  const { number: pullNumber, ref: commitId } = prMetadata;

  info(`Analyzing PR #${pullNumber} (commit: ${commitId.slice(0, 7)})`);

  const runId = getWorkflowRunId();

  info('Fetching failed CI job logs...');
  const failedJobs = await getFailedJobs(octokit, owner, repo, runId);

  if (failedJobs.length === 0) {
    info('No failed jobs found. Nothing to review.');
    return formatStatus(null);
  }

  info(`Found ${failedJobs.length} failed job(s)`);

  info('Fetching PR diff...');
  const rawDiff = await getPullRequestDiff(octokit, owner, repo, pullNumber);
  const diff = truncateDiff(rawDiff);
  info(`PR diff: ${rawDiff.length} chars (${diff.length} after truncation)`);

  const prompt = buildPrompt(diff, failedJobs);
  info(`Prompt size: ${prompt.length} chars`);

  const gemini = new GeminiClient(geminiApiKey, model);
  let analysis: GeminiReviewResponse;

  try {
    analysis = await gemini.analyzeFailure(prompt);
  } catch (error) {
    warning(`Gemini analysis failed: ${error}`);
    return formatStatus(null, error);
  }

  info(
    `Gemini analysis: ${analysis.comments.length} comments, confidence: ${analysis.confidence}`
  );

  const reviewBody = formatReviewBody(analysis);

  if (analysis.comments.length > 0) {
    try {
      const reviewId = await createPullRequestReview(
        octokit,
        owner,
        repo,
        pullNumber,
        commitId,
        reviewBody,
        analysis.comments,
        reviewEvent
      );
      info(
        `Posted review #${reviewId} with ${analysis.comments.length} inline comments`
      );
      return formatStatus(analysis, undefined, reviewId);
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
  error?: unknown,
  reviewId?: number
): string {
  const lines: string[] = [];

  if (error) {
    lines.push(
      `:warning: AI analysis of CI failures could not be completed - ${error instanceof Error ? error.message : String(error)}`
    );
    return lines.join('\n');
  }

  if (!analysis) {
    lines.push(':green_circle: No CI failures detected');
    return lines.join('\n');
  }

  const badge = confidenceBadge(analysis.confidence);

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

function getWorkflowRunId(): number {
  const runId = context.payload?.workflow_run?.id;
  if (!runId) {
    throw new Error(
      'Could not determine workflow run ID. This action must be triggered by a workflow_run event.'
    );
  }
  return runId as number;
}
