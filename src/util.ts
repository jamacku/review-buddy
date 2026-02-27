export function confidenceBadge(confidence: string): string {
  switch (confidence) {
    case 'high':
      return ':green_circle:';
    case 'medium':
      return ':yellow_circle:';
    default:
      return ':orange_circle:';
  }
}

export function truncateLogs(logs: string, maxChars: number = 30_000): string {
  if (logs.length <= maxChars) return logs;
  return (
    `... [truncated, showing last ${maxChars} chars] ...\n` +
    logs.slice(-maxChars)
  );
}

export function truncateDiff(diff: string, maxChars: number = 50_000): string {
  if (diff.length <= maxChars) return diff;
  return (
    diff.slice(0, maxChars) +
    `\n... [diff truncated, showing first ${maxChars} chars] ...`
  );
}
