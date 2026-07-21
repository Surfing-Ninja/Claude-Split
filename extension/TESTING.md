# Extension manual test checklist

Automated tests cover the parser and attribution math (`npm test`). The
following need a real browser + claude.ai account. Run through this list
before tagging a release.

## Fresh install (Phase 1–2 acceptance)

- [ ] Load unpacked (`chrome://extensions` → Developer mode) — no manifest
      errors. Firefox: `about:debugging` → Load Temporary Add-on.
- [ ] Open claude.ai, send one message. Popup shows session + weekly bars
      whose values match Settings → Usage in Claude's own UI (popup shows
      the unrounded value).
- [ ] Popup shows "updated Ns ago" and it ticks.
- [ ] Close all claude.ai tabs. Use Claude elsewhere (Claude Code / phone)
      for ~10 min. Popup numbers still move within ~3 min (background poll).

## Device identity + local attribution (Phase 3)

- [ ] Popup → Settings shows a default device name ("Chrome on mac" etc.);
      rename sticks across browser restarts.
- [ ] Send two messages on claude.ai. "This device used X%" moves by the
      same amount as Claude's own pct moved.
- [ ] Wait for (or force) a session reset → local counter returns to 0.

## Sync + combined dashboard (Phase 5)

- [ ] Settings → backend URL + Create account → succeeds, device appears.
- [ ] Second browser profile, same account (Log in): both devices appear in
      both popups; combined total matches; each device's split is plausible.
- [ ] Kill the backend, send a message → alert shows "N event(s) queued";
      restart backend → queue flushes (alert clears, summary updates).
- [ ] Log out of claude.ai → popup shows the "logged out" notice within a
      few polls; polling stops (check service-worker console — no request
      spam). Log back in, open claude.ai → tracking resumes.

## Warn / block (Phase 6 acceptance, §9)

- [ ] Lower the session warn slider below the current pct → banner appears
      near the composer within 5s ("Session at N% · resets in …").
- [ ] Lower the block slider below current pct (hard block ON) → send button
      disabled + overlay with countdown; Enter-to-send intercepted.
- [ ] Click **Send anyway** → sending works immediately (override lasts
      10 min).
- [ ] Raise the threshold back → banner/overlay clear without a reload.
- [ ] Toggle hard block OFF → only the banner remains at any usage level.

## Fail-soft

- [ ] With the service worker console open, no uncaught errors during any of
      the above.
- [ ] Simulate parser breakage (edit `usage-parser.js` to return null) →
      popup shows "usage source changed — update needed"; claude.ai itself
      is unaffected.

## Store packaging

- [ ] `npm run package` produces `dist/claude-split-chrome.zip` and
      `dist/claude-split-firefox.zip`; each loads cleanly in its browser.
