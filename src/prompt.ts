import type { ExternalFailure, FailedJob } from './schema';

export function buildPrompt(
  diff: string,
  failedJobs: FailedJob[],
  externalFailures: ExternalFailure[]
): string {
  const jobLogsSection = failedJobs
    .map(
      job =>
        `### Failed Job: "${job.name}" (ID: ${job.id})\n\`\`\`\n${job.logs}\n\`\`\``
    )
    .join('\n\n');

  const externalSection =
    externalFailures.length > 0
      ? `## External CI Failures

The following external CI systems also reported failures. Full logs are not available via GitHub API, but the status information and log URLs are provided below.

${externalFailures
  .map(
    f =>
      `### ${f.source === 'status' ? 'Commit Status' : 'Check Run'}: "${f.name}"
- **Description:** ${f.description || 'No description provided'}
- **Logs:** ${f.url || 'No URL available'}`
  )
  .join('\n\n')}

`
      : '';

  return `You are an expert CI/CD failure analyst and code reviewer. Your task is to analyze CI workflow failures in the context of a pull request's code changes, and produce actionable review comments.

## Your Role

You are reviewing a pull request that has caused CI failures. You will be given:
1. The pull request diff (code changes)
2. Logs from failed CI jobs (GitHub Actions)
3. Optionally, information about external CI failures (Jenkins, Packit, etc.) where full logs may not be available

Your goal is to identify which specific code changes in the PR likely caused the CI failures and suggest fixes.

## Output Format

You MUST respond with a JSON object matching this exact structure:

{
  "summary": "A concise (2-4 sentences) summary of the CI failures and their root causes related to the code changes.",
  "comments": [
    {
      "path": "relative/path/to/file.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "Markdown-formatted review comment explaining the issue and suggesting a fix."
    }
  ],
  "confidence": "high" | "medium" | "low"
}

## Rules for Comments

1. **Only comment on lines that appear in the diff.** The "path" must be a file path from the diff, and "line" must be a line number from the new version of the file (lines prefixed with "+" in the diff, counting from the line numbers shown after the @@ markers).
2. **Be specific.** Reference the exact error message from the logs and explain how the code change caused it.
3. **Suggest fixes.** Each comment should include a concrete suggestion for how to fix the issue, ideally with a code snippet using GitHub's suggestion syntax:
   \`\`\`suggestion
   corrected code here
   \`\`\`
4. **Do not be verbose.** Keep comments focused and actionable. Avoid generic advice.
5. **If the failure is not caused by code changes** (e.g., infrastructure flake, timeout, network issue), set "comments" to an empty array and explain in the "summary".
6. **For external CI failures without logs**, mention them in the summary and include the log URL if available. Only add inline comments if the failure cause can be inferred from the diff alone.
7. **Confidence level:**
   - "high": Clear causal link between code change and failure
   - "medium": Likely causal link but some ambiguity
   - "low": Failure may not be related to code changes

## Pull Request Diff

\`\`\`diff
${diff}
\`\`\`

## Failed CI Job Logs

${failedJobs.length > 0 ? jobLogsSection : '_No GitHub Actions job logs available._'}

${externalSection}## Analysis

Analyze the CI failures above in the context of the code diff. Identify which specific code changes caused the failures and respond with the JSON format specified above.`;
}
