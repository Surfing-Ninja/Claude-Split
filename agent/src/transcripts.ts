// Classification of Claude Code transcript lines (~/.claude/projects/**/*.jsonl).
//
// PRIVACY (§7.4): we parse only the minimal structural fields needed to decide
// "was this a real user send?" — entry type, meta/sidechain flags, and the
// *types* of content items. Message text is never read, stored, or forwarded.

type MinimalEntry = {
  type?: unknown;
  isMeta?: unknown;
  isSidechain?: unknown;
  message?: { content?: unknown };
};

/**
 * A newly appended transcript entry counts as one user send iff:
 * - type === 'user' (assistant turns, summaries, etc. don't count)
 * - not a meta entry and not a sidechain (sub-agent) turn
 * - its content is a plain string, or an array containing at least one
 *   non-tool_result item — tool results echo back as `user` entries and
 *   must not be counted as sends.
 */
export function isUserSend(line: string): boolean {
  let entry: MinimalEntry;
  try {
    entry = JSON.parse(line) as MinimalEntry;
  } catch {
    return false; // partial/corrupt line
  }
  if (entry?.type !== 'user') return false;
  if (entry.isMeta === true || entry.isSidechain === true) return false;

  const content = entry.message?.content;
  if (typeof content === 'string') return content.length > 0;
  if (Array.isArray(content)) {
    return content.some(
      (item) =>
        item != null &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type !== 'tool_result',
    );
  }
  return false;
}

/** Split a chunk of appended bytes into complete lines + the leftover tail. */
export function splitCompleteLines(buffer: string): { lines: string[]; rest: string } {
  const lastNewline = buffer.lastIndexOf('\n');
  if (lastNewline < 0) return { lines: [], rest: buffer };
  const lines = buffer
    .slice(0, lastNewline)
    .split('\n')
    .filter((l) => l.trim().length > 0);
  return { lines, rest: buffer.slice(lastNewline + 1) };
}
