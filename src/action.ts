import { info, warning } from '@actions/core';
import { context } from '@actions/github';

import { GeminiClient } from './gemini';
import type { CustomOctokit } from './octokit';
import { buildPrompt } from './prompt';
import { PullRequest } from './pull-request';
import { Review } from './review';
import type { ActionConfig, ReviewComment } from './schema';
import { truncateDiff } from './util';

export default async function action(
  octokit: CustomOctokit,
  config: ActionConfig
): Promise<string> {
  const { prMetadata, owner, repo, geminiApiKey, model, reviewEvent } = config;

  const pr = new PullRequest(octokit, owner, repo, prMetadata.number);
  const headSha = await resolveHeadSha(pr);

  info(`Analyzing PR #${pr.number} (commit: ${headSha.slice(0, 7)})`);

  // Collect all CI failures
  info('Fetching failed CI job logs...');
  const [failedJobs, failedCheckRuns, failedStatuses] = await Promise.all([
    pr.getFailedJobs(headSha),
    pr.getFailedCheckRuns(headSha),
    pr.getFailedCommitStatuses(headSha),
  ]);

  const externalFailures = [...failedCheckRuns, ...failedStatuses];
  const totalFailures = failedJobs.length + externalFailures.length;

  if (totalFailures === 0) {
    info('No failed jobs found. Nothing to review.');
    return Review.formatStatus();
  }

  info(`Found ${failedJobs.length} failed job(s)`);
  if (externalFailures.length > 0) {
    info(
      `Found ${externalFailures.length} external CI failure(s): ${externalFailures.map(f => f.name).join(', ')}`
    );
  }

  // Deduplication check
  const fingerprint = Review.computeFingerprint(
    headSha,
    failedJobs,
    externalFailures
  );
  info(`Failure fingerprint: ${fingerprint}`);

  const existingFingerprint = await Review.findExistingFingerprint(
    octokit,
    owner,
    repo,
    pr.number
  );

  if (existingFingerprint === fingerprint) {
    info(
      `Review already posted for this failure state (fingerprint: ${fingerprint}). Skipping.`
    );
    return Review.formatSkippedStatus();
  }

  // Fetch diff and build prompt
  info('Fetching PR diff...');
  const rawDiff = await pr.getDiff();
  const diff = truncateDiff(rawDiff);
  info(`PR diff: ${rawDiff.length} chars (${diff.length} after truncation)`);

  const prompt = buildPrompt(diff, failedJobs, externalFailures);
  info(`Prompt size: ${prompt.length} chars`);

  // Analyze with Gemini
  const gemini = new GeminiClient(geminiApiKey, model);

  let analysis;
  try {
    analysis = await gemini.analyzeFailure(prompt);
  } catch (error) {
    warning(`Gemini analysis failed: ${error}`);
    return Review.formatErrorStatus();
  }

  info(
    `Gemini analysis: ${analysis.comments.length} comments, confidence: ${analysis.confidence}`
  );

  // Post review
  const reviewComments: ReviewComment[] = analysis.comments.map(c => ({
    path: c.path,
    line: c.line,
    side: 'RIGHT' as const,
    body: c.body,
  }));

  const reviewBody = Review.formatBody(analysis, fingerprint);

  if (reviewComments.length > 0) {
    try {
      const reviewId = await Review.post(
        octokit,
        owner,
        repo,
        pr.number,
        headSha,
        reviewBody,
        reviewComments,
        reviewEvent
      );
      info(
        `Posted review #${reviewId} with ${reviewComments.length} inline comments`
      );
      return Review.formatStatus(analysis, reviewId);
    } catch (error) {
      warning(`Failed to create review with inline comments: ${error}`);
      return Review.formatStatus(analysis);
    }
  }

  return Review.formatStatus(analysis);
}

async function resolveHeadSha(pr: PullRequest): Promise<string> {
  const payloadSha = context.payload?.workflow_run?.head_sha;
  if (payloadSha) {
    info(`Head SHA from workflow_run payload: ${payloadSha}`);
    return payloadSha as string;
  }

  info('No workflow_run payload, fetching head SHA from PR API...');
  return pr.getHeadSha();
}
