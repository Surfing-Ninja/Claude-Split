# Store listing copy

## Name

Claude Split — personal multi-device usage tracker

## Short description (132 chars max)

See how your own devices consume your Claude Pro/Max limits — live combined usage, per-device split, and a warning before the wall.

## Full description

Claude shows one account-wide usage number. If you use Claude on a laptop,
a tablet, and in the Claude Code terminal, you can't tell what's eating
your limit — until it's gone mid-task.

Claude Split reads Claude's own official usage numbers (the same data
behind Settings → Usage) and shows:

• Live session % and weekly % with reset countdowns — fresh within minutes
even when no claude.ai tab is open
• A per-device breakdown of which of YOUR devices used what (best-effort
estimate, honestly labeled — including an "Unattributed" bucket)
• A configurable warning banner near the composer, and an optional
soft-block at your chosen threshold with a one-click "Send anyway"
override — you are never locked out by your own tool

Pair it with the optional self-hosted sync backend to see all your devices
in one dashboard, and with the claude-split-agent CLI to attribute Claude
Code terminal usage.

WHAT IT IS NOT
— Not an account-sharing tool: one user, one Claude account, that user's
own devices only.
— It never reads, stores, or transmits your conversations. Only usage
percentages, timestamps, device names, and reset times.
— Your Claude login cookie never leaves your browser.

Open source (MIT): https://github.com/your-org/claude-split
Usage-interception technique credit: claude-counter (she-llac, MIT).
Independent project; not affiliated with or endorsed by Anthropic.

## Category

Productivity / Developer Tools

## Permissions justification (for review)

- `storage` — device identity, settings, offline event queue
- `alarms` — 3-minute background freshness poll, housekeeping
- `cookies` — read the `lastActiveOrg` cookie to build the /usage URL for
  your own logged-in claude.ai session
- `host_permissions: https://claude.ai/*` — observe usage responses and
  poll the official usage endpoint; the extension never modifies claude.ai
  traffic
