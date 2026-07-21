# Security Policy

## What Claude Split is — and is not

Claude Split is a **personal, single-owner** usage tracker: one person, one
Claude account, several devices belonging to that same person. It is not an
account-sharing tool, and nothing in this repository is designed to help
multiple people share a Claude subscription.

## Threat model & guarantees

The design goal is that running Claude Split — self-hosted or on a shared
instance — can never put your Claude account or your conversations at risk.

1. **Claude credentials never leave the device they live on.**
   The browser extension uses your existing claude.ai session via browser
   cookie scoping; the CLI agent keeps its copy of the session cookie in a
   local `chmod 600` file. No API field anywhere in the backend schema can
   carry a cookie, token, or credential for claude.ai. This is a hard rule:
   any PR adding such a field will be rejected.

2. **No conversation content.**
   The system observes only: usage percentages, reset timestamps, device
   names, and "a send happened". Prompts, responses, titles, and any other
   message data are never read beyond what is needed to classify an event
   type, and are never stored or transmitted.

3. **Backend stores the minimum.**
   Email, argon2id password hash, device names, usage numbers, timestamps.
   Nothing else. Events are pruned after a configurable retention window
   (default 90 days). `DELETE /api/v1/me` wipes the account and all related
   rows in one transaction.

4. **Auth design.**
   - Passwords: argon2id (64 MiB memory, time cost 3).
   - API tokens: 32 random bytes, opaque (not JWT), stored server-side only
     as SHA-256 hashes; 30-day sliding expiry; revocation deletes the row.
   - Every query is scoped by the `user_id` resolved from the token. No
     endpoint accepts a user id from the client. Cross-user isolation is
     covered by integration tests.
   - Rate limiting on `/auth/*` (per IP, with lockout backoff on repeated
     failures) and on the general API (per token).

5. **Transport.** Run the backend behind HTTPS in production (see
   `server/SETUP.md`). `helmet` defaults are enabled; CORS is an explicit
   allowlist.

## Reporting a vulnerability

Please open a GitHub security advisory on this repository (preferred), or a
private report to the repository owner. Do not open public issues for
exploitable vulnerabilities. You can expect an acknowledgement within a few
days. Reports affecting guarantee 1 or 2 above are treated as highest
severity.
