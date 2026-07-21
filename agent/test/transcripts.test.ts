import { describe, expect, it } from 'vitest';
import { isUserSend, splitCompleteLines } from '../src/transcripts.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('isUserSend', () => {
  it('counts a real user text turn', () => {
    expect(
      isUserSend(
        line({ type: 'user', message: { role: 'user', content: 'fix the tests please' } }),
      ),
    ).toBe(true);
    expect(
      isUserSend(
        line({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        }),
      ),
    ).toBe(true);
  });

  it('does not count tool_result echo turns', () => {
    expect(
      isUserSend(
        line({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'x', content: 'output' }],
          },
        }),
      ),
    ).toBe(false);
  });

  it('does not count assistant turns, meta, sidechains, or summaries', () => {
    expect(isUserSend(line({ type: 'assistant', message: { content: 'hi' } }))).toBe(false);
    expect(isUserSend(line({ type: 'user', isMeta: true, message: { content: 'caveat' } }))).toBe(
      false,
    );
    expect(
      isUserSend(line({ type: 'user', isSidechain: true, message: { content: 'sub-agent' } })),
    ).toBe(false);
    expect(isUserSend(line({ type: 'summary', summary: 'compacted' }))).toBe(false);
  });

  it('survives malformed lines', () => {
    expect(isUserSend('{broken')).toBe(false);
    expect(isUserSend('')).toBe(false);
    expect(isUserSend(line({ type: 'user' }))).toBe(false);
  });
});

describe('splitCompleteLines', () => {
  it('returns only complete lines and keeps the tail', () => {
    const { lines, rest } = splitCompleteLines('{"a":1}\n{"b":2}\n{"partial');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"partial');
  });

  it('handles chunks with no newline at all', () => {
    const { lines, rest } = splitCompleteLines('{"still-going');
    expect(lines).toEqual([]);
    expect(rest).toBe('{"still-going');
  });
});
