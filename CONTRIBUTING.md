# Contributing

Thanks for helping! A few ground rules keep this project safe to use.

## Non-negotiables (enforced in review)

1. **No field anywhere in the API or schema may carry Claude cookies,
   tokens, or message content.** All request schemas are zod `.strict()`;
   keep them that way. PRs weakening this are rejected regardless of intent.
2. **Claude endpoint assumptions live only in**
   `extension/src/lib/usage-parser.js`, `extension/src/injected/bridge.js`,
   and `agent/src/claude-usage.ts` (the agent's mirror). New assumptions go
   there, nowhere else, and must fail soft (return null, set the
   "parser broken" flag — never throw into the page).
3. **Official numbers over estimates.** Warn/block thresholds and combined
   totals always come from Claude's live numbers, never from our cumulative
   attribution.
4. One user, one account. Features that make account sharing easier are out
   of scope.

## Dev setup

```bash
npm install          # root — installs all three workspaces
npm run lint         # eslint + prettier across the repo
npm run build        # server + agent TypeScript
npm test             # extension (node:test) + server (vitest/PGlite) + agent (vitest)
```

Server integration tests run against in-memory Postgres (PGlite) — no
database or Docker needed.

- Extension: plain JS (no build step) — load `extension/` unpacked. Manual
  test plan: [extension/TESTING.md](extension/TESTING.md).
- Server: `cd server && npm run dev` (needs `DATABASE_URL` in `.env`).
- Agent: `cd agent && npm run dev`.

## Style

ESLint + Prettier are configured at the root; CI enforces both plus the
test suites on every PR. Keep commits scoped and describe _why_ in the body
when the change isn't obvious.

## Releases

- Extension zips: `cd extension && npm run package` (see
  `extension/STORE_LISTING.md` for store copy).
- Agent: `cd agent && npm publish` (builds `dist/` via prepack).
