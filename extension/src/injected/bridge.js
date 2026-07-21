// Runs in the PAGE context (injected via web_accessible_resources).
// Observes — never modifies — claude.ai traffic to read Claude's own usage
// numbers. Technique credit: she-llac/claude-counter (MIT), see NOTICES.md.
//
// All endpoint assumptions live here and in ../lib/usage-parser.js (§7.1).

import {
  isCompletionUrl,
  isUsageUrl,
  orgIdFromUsageUrl,
  parseSseEvent,
  parseUsageResponse,
  sseDataPayloads,
} from '../lib/usage-parser.js';

const SOURCE = 'claude-split#bridge';

function post(type, payload) {
  try {
    window.postMessage({ source: SOURCE, type, payload }, window.location.origin);
  } catch {
    // never break the page
  }
}

function observeUsageResponse(response) {
  response
    .clone()
    .json()
    .then((json) => {
      const snapshot = parseUsageResponse(json, 'fetch');
      if (snapshot) post('snapshot', snapshot);
      else post('parse-miss', { endpoint: 'usage' });
    })
    .catch(() => {});
}

function observeSseStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const pump = () =>
    reader
      .read()
      .then(({ done, value }) => {
        if (done) {
          drain(buffer);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        // only hand complete lines to the parser; keep the tail
        const lastNewline = buffer.lastIndexOf('\n');
        if (lastNewline >= 0) {
          drain(buffer.slice(0, lastNewline + 1));
          buffer = buffer.slice(lastNewline + 1);
        }
        return pump();
      })
      .catch(() => {});
  const drain = (text) => {
    for (const payload of sseDataPayloads(text)) {
      const partial = parseSseEvent(payload);
      if (partial) post('snapshot-partial', partial);
    }
  };
  pump();
}

const originalFetch = window.fetch;
window.fetch = function (input, init) {
  let url = '';
  let method = 'GET';
  try {
    url = typeof input === 'string' ? input : (input?.url ?? String(input));
    method = String(init?.method ?? (typeof input === 'object' && input?.method) ?? 'GET');
  } catch {
    // fall through with defaults
  }

  const isSend = method.toUpperCase() === 'POST' && isCompletionUrl(url);
  if (isSend) post('send-detected', { at: new Date().toISOString() });

  const resultPromise = originalFetch.apply(this, arguments);

  resultPromise
    .then((response) => {
      try {
        if (isUsageUrl(url)) {
          const orgId = orgIdFromUsageUrl(url);
          if (orgId) post('org-id', { orgId });
          if (response.ok) observeUsageResponse(response);
        } else if (
          isSend &&
          response.ok &&
          (response.headers.get('content-type') || '').includes('text/event-stream') &&
          response.body
        ) {
          observeSseStream(response.clone());
        }
      } catch {
        // observation must never affect the page's own request handling
      }
    })
    .catch(() => {});

  return resultPromise;
};

// Some flows may use EventSource instead of fetch-streamed SSE; observe those
// too. Named `message_limit` events carry the payload without a `type` field.
const OriginalEventSource = window.EventSource;
if (typeof OriginalEventSource === 'function') {
  const WrappedEventSource = function (url, config) {
    const es = new OriginalEventSource(url, config);
    const relay = (event) => {
      try {
        const data = JSON.parse(event.data);
        const partial = parseSseEvent(
          data.type ? data : { type: 'message_limit', message_limit: data },
        );
        if (partial) post('snapshot-partial', partial);
      } catch {
        // non-JSON event — ignore
      }
    };
    es.addEventListener('message_limit', relay);
    es.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.type === 'message_limit') relay(event);
      } catch {
        // ignore
      }
    });
    return es;
  };
  WrappedEventSource.prototype = OriginalEventSource.prototype;
  Object.setPrototypeOf(WrappedEventSource, OriginalEventSource);
  window.EventSource = WrappedEventSource;
}

post('bridge-ready', { at: new Date().toISOString() });
