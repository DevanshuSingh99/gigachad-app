/**
 * Prompt-context windowing for AI summaries (docs/08-ai.md).
 *
 * `lines` is newest-first. Trimming drops from the end so the most recent
 * messages stay intact. The request path never runs a tokenizer; the caller
 * supplies a character budget (typically tokens × ~4).
 */
export function trimNewestFirstContext(lines: string[], maxChars: number): string[] {
  const kept = [...lines];
  while (kept.length > 1 && kept.join('\n\n').length > maxChars) {
    kept.pop();
  }
  return kept;
}
