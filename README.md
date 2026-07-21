# Claude Split

**Personal multi-device usage tracker for Claude Pro/Max.**

One Claude subscription, several devices — laptop browser, tablet, phone,
Claude Code in a terminal — and a single opaque usage limit shared by all of
them. Claude shows you _that_ you're at 62%, but not _what got you there_.
Claude Split does:

- **Always-fresh combined numbers** — session % and weekly %, with reset
  countdowns, taken straight from Claude's own official usage data. Fresh
  within ~3 minutes even when no claude.ai tab is open (so heavy Claude Code
  sessions no longer eat your limit invisibly).
- **Per-device split** — "Laptop browser used 12% of this session, Tablet 6%,
  Laptop Claude Code 18%." Best-effort estimates, clearly labeled as such.
- **Warn + soft-block** — a banner at 90%, and (optionally) a hold on the
  send button at 98% with an always-visible one-click **Send anyway**
  override. You are never locked out by your own tool.

## What Claude Split is _not_

- **Not an account-sharing tool.** One user, one Claude account, multiple
  devices owned by that same person. Nothing here helps several people split
  a subscription, and the backend isolates every registered user completely.
- **Not a content reader.** No prompts, responses, titles, or any message
  text are ever read, stored, or transmitted — only usage percentages,
  timestamps, device names, and reset times.
- **Not a credential relay.** Your Claude session cookie/token never leaves
  the device it lives on. The backend only ever receives usage numbers.
- Not a billing or cost-estimation tool.

## How it works

```
┌─────────────────────┐   ┌─────────────────────┐   ┌──────────────────────────┐
│ Laptop browser      │   │ Tablet browser      │   │ Laptop terminal          │
│ [extension]         │   │ [extension]         │   │ [claude-split-agent]     │
│  - intercept /usage │   │  - same             │   │  - watch ~/.claude/      │
│  - detect sends     │   │                     │   │    projects/**/*.jsonl   │
│  - poll in bg       │   │                     │   │  - poll /usage locally   │
└─────────┬───────────┘   └─────────┬───────────┘   └───────────┬──────────────┘
          │  HTTPS + Bearer token   │                           │
          ▼                         ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Backend — Node/Express + Neon Postgres                    │
│   auth · devices · usage_events · summary aggregation · settings             │
└──────────────────────────────────────────────────────────────────────────────┘
```

Claude's own `/usage` endpoint and live `message_limit` SSE data are the
source of truth for totals. Each device watches the official percentage
before and after its own sends; the _delta_ is what gets attributed to that
device and synced. The backend never sees anything Claude-flavored beyond
those numbers.

Anything nobody observed — the Claude Desktop app, a missed event — shows up
honestly as an **Unattributed** row rather than being guessed at.

## Quick start

### 1. Backend (5 minutes, free)

```bash
git clone https://github.com/Surfing-Ninja/Claude-Split && cd claude-split
npm install
cd server && cp .env.example .env   # paste a Neon (or any Postgres) URL
npm run migrate && npm run build && npm start
```

Full walkthrough incl. Neon signup and HTTPS: [server/SETUP.md](server/SETUP.md).

### 2. Extension (each browser device)

1. Chrome: `chrome://extensions` → Developer mode → **Load unpacked** →
   select the `extension/` folder.
   Firefox: `about:debugging` → This Firefox → **Load Temporary Add-on** →
   select `extension/manifest.json`.
2. Add the extension's origin to `CORS_ORIGINS` in `server/.env` (see SETUP.md).
3. Open the popup → Settings → enter your backend URL → **Create account**
   (first device) or **Log in** (the rest). Give each device a name.
4. Open claude.ai once. Bars appear; background polling keeps them fresh.

### 3. CLI agent (machines running Claude Code)

```bash
npx claude-split-agent init   # creates ~/.claude-split/config.json
# fill in the 4 fields — see agent/README.md for the cookie walkthrough
npx claude-split-agent
```

The agent registers itself as its own device ("&lt;hostname&gt; — Claude Code")
and attributes Claude Code prompts to it.

## Privacy guarantees

1. Nothing content-like is ever read beyond classifying "a send happened",
   and nothing content-like is ever stored or transmitted.
2. Claude credentials never leave the device they live on.
3. The backend stores only: email, password hash (argon2id), device names,
   usage percentages, timestamps. Events are pruned after 90 days (configurable).
4. One request (`DELETE /api/v1/me`) wipes your account and all data.
5. Self-hosting is the first-class path — your data can live entirely on
   infrastructure you control (Neon free tier + any Node host).

Details and threat model: [SECURITY.md](SECURITY.md).

## Honest limitations

- **Attribution is an estimate.** Anthropic exposes no per-surface breakdown.
  Simultaneous sends from two devices can overlap; when that happens the
  dashboard flags it ("overlap detected") instead of pretending precision.
  Claude's own live numbers are always the truth for totals.
- **Claude Desktop usage is unattributable** in v1 — it lands in
  "Unattributed" (the totals still include it, since it draws from the same
  pool).
- **Breakage risk.** The interception targets Claude's internal frontend
  endpoints, which can change without notice. All such assumptions live in
  two files (`extension/src/lib/usage-parser.js`, `extension/src/injected/bridge.js`);
  when they break, the extension fails soft with a "usage source changed"
  notice — it never breaks the page.
- **The CLI agent's cookie expires** every so often; the agent stops with a
  clear message and never retry-loops. Refresh takes a minute.

## Repository layout

| Path                       | What                                                 |
| -------------------------- | ---------------------------------------------------- |
| [extension/](extension/)   | MV3 browser extension (Chrome + Firefox), vanilla JS |
| [server/](server/)         | Express + Drizzle + Postgres backend, TypeScript     |
| [agent/](agent/)           | `claude-split-agent` npm package, TypeScript         |
| [SECURITY.md](SECURITY.md) | Threat model + reporting                             |
| [NOTICES.md](NOTICES.md)   | Third-party credits                                  |

Manual extension test plan: [extension/TESTING.md](extension/TESTING.md) ·
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Credits

The usage-interception technique (observing claude.ai's `/usage` endpoint
and `message_limit` SSE events from the page context) originates from
[**claude-counter**](https://github.com/she-llac/claude-counter) by
she-llac (MIT). Claude Split reimplements it with credit — see
[NOTICES.md](NOTICES.md).

Claude Split is an independent open-source project, not affiliated with or
endorsed by Anthropic.

## License

MIT — see [LICENSE](LICENSE).
