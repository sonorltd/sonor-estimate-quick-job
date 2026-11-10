/* sonor-wq-push.js — CANONICAL MASTER (root; synced to every app's data/ by sync-everything.sh)
   ONE WeQuote PUSH transport for every Sonor app (v1.0.0 · 2026-10-09, Garden Lighting v0.2.0 birth of the seam).
   Lifted from APP - Takeoffs/data/sonor-takeoffs-wqpush.js v2.14 `_pushViaEdge` so a second pusher (Garden Lighting)
   never forks the token + chunk-loop logic (HARMONY §3 — the moment of duplication is the moment of extraction).
   Takeoffs keeps its inline copy until its next wqpush bump adopts this master (delegate-with-fallback; B-521).

   What it does: POST {plan, quote_id, unlock, dry, project_ref, resume} to /functions/v1/wq-push with the
   X-Sonor-Push-Token header (wq_config.push_token — service-role only; pasted ONCE per browser, kept in
   localStorage 'sonor-wq-push-token'). The function does ≤60 WeQuote writes per call and returns done:false +
   result → we loop with resume so long pushes never hit the edge wall clock; every log line streams to onLog.

     SonorWqPush.push(plan, { supa, ref, dry, unlock, slot, quoteId, createQuote, onLog(lines), onProgress(pct), onStatus(msg) }) → result | null

   v1.1.0 (2026-10-17, Service Contracts) — opts.createQuote {customer_id, description, project_id?}: when no quote is paired the
   first call asks wq-push (≥ 1.4.0) to create a blank quote; the new id comes back in result.quote_id and every later call
   (resume) targets it. The caller stores result.quote_id / result.quote_no against its record.
     SonorWqPush.setToken()  — re-prompt for the push token (clears the stored one)
     SonorWqPush.hasToken()

   The browser never sees the WeQuote Api-Key; writes happen server-side (wq-push), reads via wq-proxy / SonorWQClient.
*/
(function (global) {
  'use strict';
  var VERSION = '1.2.0';   // 1.2.0 (2026-10-17) — addContact(): a person onto a WeQuote customer through wq-push 1.5.0 add_contact
  var KEY = 'sonor-wq-push-token';
  function _token(force) {
    var t = ''; try { t = localStorage.getItem(KEY) || ''; } catch (_) {}
    if (t && !force) return t;
    t = prompt('WeQuote push token\n\nOne-time setup for this browser: paste wq_config.push_token (Supabase → Table editor → wq_config, or ask Bryn). Stored locally only.', '') || '';
    t = t.trim(); if (t) { try { localStorage.setItem(KEY, t); } catch (_) {} }
    return t;
  }
  async function _pushUrl(supa) {
    try {
      var r = await supa.from('wq_config').select('proxy_url').limit(1).single();
      var u = r.data && r.data.proxy_url; if (u) return String(u).replace(/wq-proxy\/?$/, 'wq-push');
    } catch (_) {}
    try { var base = supa.supabaseUrl || (supa.rest && supa.rest.url && supa.rest.url.replace(/\/rest\/v1\/?$/, '')); if (base) return base + '/functions/v1/wq-push'; } catch (_) {}
    return null;
  }
  function _anonHeaders(supa) {
    var k = ''; try { k = supa.supabaseKey || (supa.rest && supa.rest.headers && supa.rest.headers.apikey) || ''; } catch (_) {}
    return k ? { apikey: k, Authorization: 'Bearer ' + k } : {};
  }
  async function push(plan, opts) {
    opts = opts || {};
    var supa = opts.supa; if (!supa) throw new Error('supa client required');
    var log = function (lines) { if (opts.onLog) opts.onLog(lines || []); };
    var status = function (m) { if (opts.onStatus) opts.onStatus(m); };
    var url = await _pushUrl(supa); if (!url) { status('No wq-push URL — cannot reach the edge function.'); return null; }
    var tok = _token(false); if (!tok) { status('Push cancelled — no push token.'); return null; }
    var quoteId = Number(opts.quoteId || (plan.quote && plan.quote.id)) || null;
    var create = (!quoteId && opts.createQuote && Number(opts.createQuote.customer_id) > 0) ? opts.createQuote : null;   // 1.1.0
    if (!quoteId && !create) { status('No quote paired.'); return null; }
    var total = Math.max(1, Number(plan.totals && plan.totals.wqLines) || 1);
    var resume = null, out = null, calls = 0, t0 = Date.now();
    try {
      while (calls < 200) {
        calls++;
        var payload = { plan: plan, quote_id: quoteId, create_quote: quoteId ? undefined : create, unlock: !!opts.unlock, dry: !!opts.dry, project_ref: opts.ref || (plan.project && (plan.project.ref || plan.project.name)) || '', resume: resume, slot: opts.slot || 'takeoffs-push' };
        var res = await fetch(url, { method: 'POST', headers: Object.assign(_anonHeaders(supa), { 'Content-Type': 'application/json', 'X-Sonor-Push-Token': tok }), body: JSON.stringify(payload) });
        var j = null; try { j = await res.json(); } catch (_) { j = null; }
        if (res.status === 401) { try { localStorage.removeItem(KEY); } catch (_) {} log(['✗ push token rejected — it has been cleared; push again to enter it.']); status('Push token rejected.'); return null; }
        if (res.status === 423) { log(['🔒 ' + ((j && j.error) || 'quote locked')]); status('Quote is locked in WeQuote — create the next revision and pair it.'); return j; }
        if (!j) { log(['✗ HTTP ' + res.status]); status('Push failed: HTTP ' + res.status); return null; }
        log(j.log || []);
        out = j; resume = j.result || resume;
        if (!quoteId && j.result && Number(j.result.quote_id) > 0) quoteId = Number(j.result.quote_id);   // 1.1.0 — created on the first call
        var doneLines = (j.result && j.result.summary && (j.result.summary.lines + j.result.summary.delta_skipped)) || 0;
        if (opts.onProgress) opts.onProgress(Math.min(100, Math.round(100 * doneLines / total)));
        if (!j.ok) { status('Push stopped: ' + (j.error || 'error') + ' — push again to resume (delta skips what is already there).'); return j; }
        if (j.done) break;
      }
    } catch (e) { log(['✗ ' + e.message]); status('Push failed: ' + e.message); return null; }
    if (opts.onProgress) opts.onProgress(100);
    var st = (out && out.result && out.result.summary) || {};
    status((opts.dry ? 'Dry run' : 'Pushed') + ' — quote #' + ((plan.quote && plan.quote.no) || (out && out.result && out.result.quote_no) || quoteId) + ': ' + (st.lines || 0) + ' lines, ' + (st.structures_created || 0) + ' structures, ' + (st.delta_skipped || 0) + ' already there · ' + Math.round((Date.now() - t0) / 1000) + 's');
    return out;
  }
  // 1.2.0 — add a person to a WeQuote customer (WeQuote = the client CRM). wq-push looks first (find_contact) so it never duplicates.
  async function addContact(contact, opts) {
    opts = opts || {}; var supa = opts.supa; if (!supa) throw new Error('supa client required');
    var url = await _pushUrl(supa); if (!url) return { ok: false, error: 'no wq-push URL' };
    var tok = _token(false); if (!tok) return { ok: false, error: 'no push token' };
    var res = await fetch(url, { method: 'POST', headers: Object.assign(_anonHeaders(supa), { 'Content-Type': 'application/json', 'X-Sonor-Push-Token': tok }), body: JSON.stringify({ add_contact: contact, dry: !!opts.dry }) });
    if (res.status === 401) { try { localStorage.removeItem(KEY); } catch (_) {} return { ok: false, error: 'push token rejected' }; }
    var j = null; try { j = await res.json(); } catch (_) {}
    return j || { ok: false, error: 'HTTP ' + res.status };
  }
  global.SonorWqPush = { VERSION: VERSION, push: push, addContact: addContact, setToken: function () { return _token(true); }, hasToken: function () { try { return !!localStorage.getItem(KEY); } catch (_) { return false; } } };
})(window);
