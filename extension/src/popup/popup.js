// Popup dashboard: combined official bars, per-device split, settings.

let state = null;

function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

const $ = (id) => document.getElementById(id);

function fmtPct(pct) {
  return `${(pct * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

function fmtCountdown(resetAt) {
  if (!resetAt) return '';
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return 'resetting…';
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const s = days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  return `resets in ${s}`;
}

function fmtAge(iso) {
  if (!iso) return 'no data yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `updated ${s}s ago`;
  if (s < 3600) return `updated ${Math.round(s / 60)}m ago`;
  return `updated ${Math.round(s / 3600)}h ago`;
}

function fmtLastSeen(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return 'now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function limitLabel(limitType) {
  return limitType === 'all_models' ? 'Weekly (all models)' : `Weekly (${limitType})`;
}

// ---------- render ----------

function bar(label, pct, resetAt, warnAt, blockAt) {
  const cls = pct >= blockAt ? 'danger' : pct >= warnAt ? 'warn' : '';
  const wrap = document.createElement('div');
  wrap.className = 'bar-block';
  wrap.innerHTML = `
    <div class="bar-head">
      <span>${label} · <strong>${fmtPct(pct)}</strong></span>
      <span class="reset">${fmtCountdown(resetAt)}</span>
    </div>
    <div class="bar"><span class="${cls}" style="width:${Math.min(100, pct * 100)}%"></span></div>`;
  return wrap;
}

function renderAlerts() {
  const alerts = [];
  if (state.claudeLoggedOut) {
    alerts.push({
      text: 'Logged out of claude.ai — open claude.ai and log in to resume tracking.',
    });
  }
  if (state.parserBroken) {
    alerts.push({
      text: 'Usage source changed — Claude Split needs an update. Totals may be stale.',
      error: true,
    });
  }
  if (state.authError) {
    alerts.push({ text: 'Sync sign-in expired — log in again under Settings.', error: true });
  }
  const overlap =
    state.summary?.data?.session?.overlapDetected ||
    (state.summary?.data?.weekly ?? []).some((w) => w.overlapDetected);
  if (overlap) {
    alerts.push({
      text: 'Overlap detected — simultaneous sends on 2+ devices; estimates approximate.',
    });
  }
  if (state.queueLength > 0) {
    alerts.push({
      text: `${state.queueLength} event(s) queued — will sync when the backend is reachable.`,
    });
  }
  const container = $('alerts');
  container.replaceChildren(
    ...alerts.map((a) => {
      const div = document.createElement('div');
      div.className = a.error ? 'alert error' : 'alert';
      div.textContent = a.text;
      return div;
    }),
  );
}

function renderBars() {
  const container = $('bars');
  container.replaceChildren();
  const snap = state.snapshot;
  const s = state.settings;
  if (!snap) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent =
      'No usage data yet — open claude.ai once, or wait for the next background poll.';
    container.appendChild(p);
    return;
  }
  container.appendChild(
    bar('Session', snap.sessionPct, snap.sessionResetAt, s.warnSession, s.blockSession),
  );
  for (const w of snap.weekly ?? []) {
    container.appendChild(
      bar(limitLabel(w.limitType), w.pct, w.resetAt, s.warnWeekly, s.blockWeekly),
    );
  }
  $('data-age').textContent = fmtAge(snap.capturedAt);
}

function renderDevices() {
  const container = $('devices');
  container.replaceChildren();
  const summary = state.summary?.data;

  if (!summary) {
    // Not synced: show at least this device's local counters (Phase 3).
    const local = state.localCounters;
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = local
      ? `This device used ${fmtPct(local.sessionPct)} of the current session. Log in under Settings to see all devices.`
      : 'Log in under Settings to see your per-device split.';
    container.appendChild(p);
    $('devices-note').classList.add('hidden');
    return;
  }

  const table = document.createElement('table');
  table.innerHTML =
    '<thead><tr><th>Device</th><th class="num">Session</th><th class="num">Week</th><th class="num">Seen</th></tr></thead>';
  const tbody = document.createElement('tbody');
  const primaryWeekly = (summary.weekly ?? [])[0];

  for (const device of summary.devices ?? []) {
    const tr = document.createElement('tr');
    if (device.deviceUuid === state.deviceId) tr.className = 'this-device';
    const weeklyPct = primaryWeekly?.devices?.find((d) => d.id === device.id)?.pct ?? 0;
    tr.innerHTML = `
      <td>${escapeHtml(device.name)}${device.deviceUuid === state.deviceId ? ' <span class="kind">(this device)</span>' : ''}
        <span class="kind">${device.kind === 'claude-code' ? '· Claude Code' : ''}</span></td>
      <td class="num">${fmtPct(device.sessionPct)}</td>
      <td class="num">${fmtPct(weeklyPct)}</td>
      <td class="num last-seen">${fmtLastSeen(device.lastSeenAt)}</td>`;
    tbody.appendChild(tr);
  }

  const un = summary.session?.unattributedPct ?? 0;
  const unWeekly = primaryWeekly?.unattributedPct ?? 0;
  if (un > 0.0005 || unWeekly > 0.0005) {
    const tr = document.createElement('tr');
    tr.className = 'unattributed';
    tr.innerHTML = `
      <td>Unattributed <span class="kind">(Desktop app, missed events)</span></td>
      <td class="num">${fmtPct(un)}</td>
      <td class="num">${fmtPct(unWeekly)}</td>
      <td class="num"></td>`;
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
  $('devices-note').classList.remove('hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

function renderSettings() {
  $('device-name').value = state.deviceName ?? '';
  const s = state.settings;
  for (const [id, value] of [
    ['warn-session', s.warnSession],
    ['block-session', s.blockSession],
    ['warn-weekly', s.warnWeekly],
    ['block-weekly', s.blockWeekly],
  ]) {
    $(id).value = Math.round(value * 100);
    $(`${id}-val`).textContent = `${Math.round(value * 100)}%`;
  }
  $('hard-block').checked = Boolean(s.hardBlockEnabled);

  const signedIn = Boolean(state.auth);
  $('account-signed-out').classList.toggle('hidden', signedIn);
  $('account-signed-in').classList.toggle('hidden', !signedIn);
  if (signedIn) {
    $('account-info').textContent = `${state.auth.email} · ${state.auth.backendUrl}`;
  }
}

function render() {
  if (!state) return;
  renderAlerts();
  renderBars();
  renderDevices();
  renderSettings();
}

function showError(message) {
  const el = $('settings-error');
  el.textContent = message ?? '';
  el.classList.toggle('hidden', !message);
  if (message) $('settings').open = true;
}

// ---------- events ----------

async function refreshState(messageType = 'popup:get-state', payload) {
  try {
    const result = await send(messageType, payload);
    if (result?.ok === false) {
      showError(result.error ?? 'something went wrong');
    } else {
      state = result;
      showError(null);
    }
  } catch (err) {
    showError(String(err?.message ?? err));
  }
  render();
}

$('refresh').addEventListener('click', () => void refreshState('popup:refresh'));
$('save-device-name').addEventListener(
  'click',
  () => void refreshState('popup:rename-device', { name: $('device-name').value }),
);

const SLIDER_MAP = {
  'warn-session': 'warnSession',
  'block-session': 'blockSession',
  'warn-weekly': 'warnWeekly',
  'block-weekly': 'blockWeekly',
};
for (const [id, key] of Object.entries(SLIDER_MAP)) {
  $(id).addEventListener('input', () => {
    $(`${id}-val`).textContent = `${$(id).value}%`;
  });
  $(id).addEventListener(
    'change',
    () => void refreshState('popup:set-settings', { [key]: Number($(id).value) / 100 }),
  );
}
$('hard-block').addEventListener(
  'change',
  () => void refreshState('popup:set-settings', { hardBlockEnabled: $('hard-block').checked }),
);

$('login').addEventListener(
  'click',
  () =>
    void refreshState('popup:login', {
      backendUrl: $('backend-url').value,
      email: $('email').value,
      password: $('password').value,
      mode: 'login',
    }),
);
$('register').addEventListener(
  'click',
  () =>
    void refreshState('popup:login', {
      backendUrl: $('backend-url').value,
      email: $('email').value,
      password: $('password').value,
      mode: 'register',
    }),
);
$('logout').addEventListener('click', () => void refreshState('popup:logout'));
$('reset-local').addEventListener('click', () => void refreshState('popup:reset-local'));

// initial load: cached state immediately, then a live refresh
void refreshState().then(() => refreshState('popup:refresh'));
setInterval(() => {
  if (state?.snapshot) $('data-age').textContent = fmtAge(state.snapshot.capturedAt);
}, 5000);
