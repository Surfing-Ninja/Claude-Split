// Content script (isolated world): injects the page-context bridge, relays
// its observations to the background worker, and renders the warn banner /
// hard-block overlay (§7.1). Thresholds always compare against Claude's LIVE
// numbers from the latest snapshot — never our own cumulative estimates.

const BRIDGE_SOURCE = 'claude-split#bridge';
const BYPASS_DURATION_MS = 10 * 60 * 1000;

// DOM assumptions about claude.ai's composer, kept in one place. These are
// best-effort: if they break, warn/block degrades gracefully — tracking and
// attribution are unaffected.
const SELECTORS = {
  composer: 'div[contenteditable="true"]',
  sendButton: 'button[aria-label*="send" i], button[data-testid*="send" i]',
};

// ---------- bridge injection ----------

function injectBridge() {
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('src/injected/bridge.js');
    script.type = 'module';
    (document.head || document.documentElement).appendChild(script);
    script.addEventListener('load', () => script.remove());
  } catch (err) {
    console.warn('[claude-split] bridge injection failed', err);
  }
}
injectBridge();

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== BRIDGE_SOURCE) return;
  chrome.runtime.sendMessage({ type: `bridge:${data.type}`, payload: data.payload }).catch(() => {
    // worker may be restarting; alarms + storage make this loss-tolerant
  });
});

// ---------- warn / block state ----------

const state = {
  snapshot: null,
  settings: null,
  bypassUntil: 0,
};

chrome.storage.local
  .get(['latestSnapshot', 'settings', 'bypassUntil'])
  .then((stored) => {
    state.snapshot = stored.latestSnapshot ?? null;
    state.settings = stored.settings ?? null;
    state.bypassUntil = stored.bypassUntil ?? 0;
    render();
  })
  .catch(() => {});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.latestSnapshot) state.snapshot = changes.latestSnapshot.newValue ?? null;
  if (changes.settings) state.settings = changes.settings.newValue ?? null;
  if (changes.bypassUntil) state.bypassUntil = changes.bypassUntil.newValue ?? 0;
  render();
});

function evaluate() {
  const snap = state.snapshot;
  const settings = state.settings;
  if (!snap || !settings) return { warn: null, block: null };

  const now = Date.now();
  const windows = [
    {
      label: 'Session',
      pct: snap.sessionPct,
      resetAt: snap.sessionResetAt,
      warnAt: settings.warnSession,
      blockAt: settings.blockSession,
    },
    ...(snap.weekly ?? []).map((w) => ({
      label: w.limitType === 'all_models' ? 'Weekly' : `Weekly (${w.limitType})`,
      pct: w.pct,
      resetAt: w.resetAt,
      warnAt: settings.warnWeekly,
      blockAt: settings.blockWeekly,
    })),
  ].filter((w) => !w.resetAt || new Date(w.resetAt).getTime() > now);

  let warn = null;
  let block = null;
  for (const w of windows) {
    if (w.pct >= w.blockAt && (!block || w.pct - w.blockAt > block.pct - block.blockAt)) block = w;
    else if (w.pct >= w.warnAt && (!warn || w.pct > warn.pct)) warn = w;
  }
  if (!settings.hardBlockEnabled || now < state.bypassUntil) block = null;
  return { warn: block ? null : warn, block };
}

function formatCountdown(resetAt) {
  if (!resetAt) return '';
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return 'resets any moment';
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = days
    ? [`${days}d`, `${hours}h`]
    : hours
      ? [`${hours}h`, `${minutes}m`]
      : [`${minutes}m`];
  return `resets in ${parts.join(' ')}`;
}

// ---------- UI ----------

let bannerEl = null;
let overlayEl = null;
let renderTimer = null;

function ensureStyles() {
  if (document.getElementById('claude-split-styles')) return;
  const style = document.createElement('style');
  style.id = 'claude-split-styles';
  style.textContent = `
    #claude-split-banner {
      position: fixed; bottom: 86px; left: 50%; transform: translateX(-50%);
      z-index: 2147483646; background: #4a3800; color: #ffd666;
      font: 13px/1.4 system-ui, sans-serif; padding: 8px 14px;
      border-radius: 8px; border: 1px solid #7a5c00;
      box-shadow: 0 2px 12px rgba(0,0,0,.35); pointer-events: none;
    }
    #claude-split-overlay {
      position: fixed; bottom: 76px; left: 50%; transform: translateX(-50%);
      z-index: 2147483647; background: #3d0f0f; color: #ffb3b3;
      font: 13px/1.5 system-ui, sans-serif; padding: 12px 16px;
      border-radius: 10px; border: 1px solid #7a1f1f; max-width: 460px;
      box-shadow: 0 4px 18px rgba(0,0,0,.45); text-align: center;
    }
    #claude-split-overlay button {
      margin-top: 8px; background: transparent; color: #ffd666;
      border: 1px solid #ffd666; border-radius: 6px; padding: 4px 12px;
      font: inherit; cursor: pointer;
    }
    #claude-split-overlay button:hover { background: rgba(255,214,102,.12); }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function render() {
  if (!document.body) {
    setTimeout(render, 500);
    return;
  }
  ensureStyles();
  const { warn, block } = evaluate();

  if (warn) {
    if (!bannerEl) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'claude-split-banner';
      document.body.appendChild(bannerEl);
    }
    bannerEl.textContent = `${warn.label} at ${Math.round(warn.pct * 100)}% · ${formatCountdown(warn.resetAt)}`;
  } else if (bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }

  if (block) {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'claude-split-overlay';
      const text = document.createElement('div');
      text.className = 'cs-text';
      const button = document.createElement('button');
      button.textContent = 'Send anyway';
      button.addEventListener('click', () => {
        // The user must never be locked out by their own tool (§7.1).
        chrome.storage.local.set({ bypassUntil: Date.now() + BYPASS_DURATION_MS }).catch(() => {});
      });
      overlayEl.append(text, button);
      document.body.appendChild(overlayEl);
    }
    overlayEl.querySelector('.cs-text').textContent =
      `Claude Split: ${block.label.toLowerCase()} limit at ${Math.round(block.pct * 100)}% — ` +
      `sending is paused to save your last messages. ${formatCountdown(block.resetAt)}.`;
    setSendDisabled(true);
  } else {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    setSendDisabled(false);
  }

  // countdowns + state clear automatically when the reset passes (§9)
  clearTimeout(renderTimer);
  if (warn || block) renderTimer = setTimeout(render, 30 * 1000);
}

function setSendDisabled(disabled) {
  for (const button of document.querySelectorAll(SELECTORS.sendButton)) {
    button.style.pointerEvents = disabled ? 'none' : '';
    button.style.opacity = disabled ? '0.4' : '';
  }
}

// Intercept Enter-to-send and clicks while blocked (capture phase).
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (!event.target?.matches?.(SELECTORS.composer)) return;
    if (!evaluate().block) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);

document.addEventListener(
  'click',
  (event) => {
    if (!evaluate().block) return;
    if (!event.target?.closest?.(SELECTORS.sendButton)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true,
);
