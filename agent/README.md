# claude-split-agent

CLI companion for [Claude Split](https://github.com/Surfing-Ninja/Claude-Split):
attributes **Claude Code** usage on this machine to its own device row on
your Claude Split dashboard. Optional — without it, Claude Code usage still
shows up in your combined totals, just as "Unattributed".

## How it works

- Watches Claude Code's local transcript directory
  (`~/.claude/projects/**/*.jsonl`; `%USERPROFILE%\.claude\projects` on
  Windows) for appended entries. A new **user turn** = one send on this
  machine. Only structural fields (entry type, flags, content-item types)
  are parsed — **message text is never read**.
- Polls Claude's official `/usage` numbers around each send and attributes
  the delta to this machine, exactly like the browser extension does.
- Ships events to your Claude Split backend with an offline-safe local queue.

## Setup

```bash
npx claude-split-agent init
```

This creates `~/.claude-split/config.json` (permissions `600`). Fill in:

| Field                 | Where to get it                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `claudeSessionCookie` | see cookie walkthrough below                                                                  |
| `claudeOrgId`         | same place — the `lastActiveOrg` cookie value                                                 |
| `backendUrl`          | your Claude Split backend, e.g. `https://api.example.com`                                     |
| `backendToken`        | log in via the extension popup, or `POST /api/v1/auth/login` with curl — the returned `token` |
| `deviceName`          | anything; defaults to `<hostname> — Claude Code`                                              |

Then run it (a terminal multiplexer or a user service keeps it alive):

```bash
npx claude-split-agent
```

### Cookie walkthrough (one-time, ~1 minute)

The agent needs to ask claude.ai for your usage numbers without a browser.
That requires your claude.ai session cookie — which stays in the local
config file and **is only ever sent to claude.ai**, nowhere else.

1. Open https://claude.ai in your browser, logged in.
2. Open DevTools (`F12` or `Cmd+Option+I`) → **Application** tab (Chrome) /
   **Storage** tab (Firefox).
3. In the left sidebar: **Cookies → https://claude.ai**.
4. Find the row named `sessionKey`. Double-click its **Value**, copy it, and
   paste it as `claudeSessionCookie` in the config.
5. Find the row named `lastActiveOrg`, copy its value into `claudeOrgId`.

When the cookie expires (typically after weeks, or when you log out), the
agent prints a clear message and **stops** — it never retries in a loop.
Repeat the walkthrough to refresh.

## Privacy

- The Claude cookie never leaves this machine (`config.json`, chmod 600).
- Transcript message text is never read, stored, or transmitted.
- The backend receives only: usage percentages, deltas, timestamps, and this
  device's name.

Part of the MIT-licensed [Claude Split](https://github.com/Surfing-Ninja/Claude-Split)
project. Not affiliated with Anthropic.
