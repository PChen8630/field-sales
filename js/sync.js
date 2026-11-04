/* Cloud sync with Supabase.
   The whole database is one JSON row per user (table fscc_state). Each save bumps "rev".
   An upload only succeeds if the cloud is still at the rev this device last saw, so two
   devices can never silently overwrite each other: a mismatch shows a "which copy?" choice.
   Without config.js values the app just works locally, as before. */
(function (G) {
  'use strict';
  const { html, useState, useEffect } = htmPreact;
  const FS = G.FS, Store = FS.Store;

  const cfg = G.FSCC_CONFIG || {};
  const BASE = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const KEY = String(cfg.supabaseKey || '').trim();
  const enabled = !!(BASE && KEY);
  const SKEY = 'fscc.sync', STASH = 'fscc.replaced';

  // Saved between visits: session tokens, the cloud rev this copy is based on, unsaved-edits flag.
  let saved = { session: null, rev: null, userId: null, dirty: false, lastSync: null, skip: false };
  try { Object.assign(saved, JSON.parse(localStorage.getItem(SKEY) || '{}')); } catch (e) { /* ignore */ }
  const keep = () => { try { localStorage.setItem(SKEY, JSON.stringify(saved)); } catch (e) { /* ignore */ } };

  // Runtime state shown in the UI.
  const S = { status: !enabled ? 'off' : saved.session ? 'idle' : 'signedout', message: '', conflict: null };
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());
  const set = (patch) => { Object.assign(S, patch); emit(); };
  function useSync() { const [, f] = useState(0); useEffect(() => { const g = () => f((n) => n + 1); subs.add(g); return () => subs.delete(g); }, []); return S; }

  // ---------- HTTP ----------
  class Offline extends Error {}
  async function request(path, { method = 'GET', body, headers = {}, auth = true } = {}, retried) {
    if (auth) await ensureToken();
    const h = { apikey: KEY, 'Content-Type': 'application/json', ...headers };
    if (auth) h.Authorization = 'Bearer ' + saved.session.access_token;
    let r;
    try { r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (e) { throw new Offline('No connection'); }
    if (r.status === 401 && auth && !retried) { await refresh(true); return request(path, { method, body, headers, auth }, true); }
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
    if (!r.ok) {
      const e = new Error((j && (j.msg || j.message || j.error_description || j.error)) || 'HTTP ' + r.status);
      e.status = r.status; e.code = j && j.code; throw e;
    }
    return j;
  }

  function takeSession(j) {
    saved.session = { access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      email: (j.user && j.user.email) || (saved.session && saved.session.email), id: (j.user && j.user.id) || (saved.session && saved.session.id) };
    keep();
  }
  let refreshing = null;
  function refresh(force) {
    if (!saved.session) return Promise.reject(signedOutError());
    if (!force && saved.session.expires_at * 1000 - 60000 > Date.now()) return Promise.resolve();
    if (!refreshing) {
      refreshing = request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: saved.session.refresh_token } })
        .then(takeSession)
        .catch((e) => { if (!(e instanceof Offline)) { saved.session = null; keep(); set({ status: 'signedout', message: 'Your sign-in expired. Please sign in again.' }); } throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }
  const ensureToken = () => refresh(false);
  function signedOutError() { const e = new Error('Not signed in'); e.status = 401; return e; }

  // ---------- Sync ----------
  let busy = false, again = false, timer = null, editSeq = 0;
  const uidQ = () => 'user_id=eq.' + encodeURIComponent(saved.session.id);
  const hasData = () => { const d = Store.db; return d.customers.length + d.visits.length + d.trips.length + d.projects.length > 0; };

  async function download() {
    const rows = await request('/rest/v1/fscc_state?select=rev,data&' + uidQ());
    if (!rows || !rows[0]) return;
    Store.replaceAll(rows[0].data || {}, { fromCloud: true });
    saved.rev = rows[0].rev; saved.dirty = false; saved.userId = saved.session.id; keep();
  }
  async function upload() {
    const seq = editSeq;
    const now = new Date().toISOString();
    let rows;
    if (saved.rev == null) {
      rows = await request('/rest/v1/fscc_state?select=rev', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: { user_id: saved.session.id, rev: 1, data: Store.db, updated_at: now } });
    } else {
      rows = await request(`/rest/v1/fscc_state?select=rev&${uidQ()}&rev=eq.${saved.rev}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
        body: { rev: saved.rev + 1, data: Store.db, updated_at: now } });
    }
    if (!rows || !rows[0]) { const e = new Error('changed elsewhere'); e.moved = true; throw e; }
    saved.rev = rows[0].rev; saved.userId = saved.session.id;
    if (seq === editSeq) saved.dirty = false; // edits made during the upload go up next time
    keep();
  }
  async function askWhichCopy(reason) {
    const rows = await request('/rest/v1/fscc_state?select=rev,updated_at,data&' + uidQ());
    const r = rows && rows[0];
    if (!r) return;
    const d = r.data || {};
    set({ status: 'conflict', conflict: { reason, rev: r.rev, data: d, updatedAt: r.updated_at,
      cloud: { customers: (d.customers || []).length, visits: (d.visits || []).length, trips: (d.trips || []).length } } });
  }

  async function syncNow() {
    if (!enabled || !saved.session || S.status === 'conflict') return;
    if (busy) { again = true; return; }
    busy = true; clearTimeout(timer);
    if (saved.dirty) set({ status: 'saving', message: '' });
    try {
      // A different person signed in on this device: its local data is not theirs to merge.
      if (saved.userId && saved.userId !== saved.session.id) { saved.rev = null; saved.userId = null; }
      const rows = await request('/rest/v1/fscc_state?select=rev&' + uidQ());
      const remote = rows && rows[0];
      if (!remote) {
        saved.rev = null; await upload(); // first device: the cloud copy starts from this one
      } else if (saved.rev == null) {
        if (hasData()) await askWhichCopy('first'); else await download();
      } else if (remote.rev === saved.rev) {
        if (saved.dirty) await upload();
      } else if (remote.rev > saved.rev && !saved.dirty) {
        await download();
      } else {
        await askWhichCopy('both');
      }
      if (S.status !== 'conflict') { saved.lastSync = new Date().toISOString(); keep(); set({ status: 'idle', message: '' }); }
    } catch (e) {
      if (e.moved) again = true;
      else if (e instanceof Offline) { set({ status: 'offline', message: '' }); timer = setTimeout(syncNow, 30000); }
      else if (e.status === 401 || !saved.session) set({ status: 'signedout' });
      else if (e.code === '42P01' || e.code === 'PGRST205' || e.status === 404) set({ status: 'error', message: 'The cloud table is missing. Run the setup SQL in Supabase (see README).' });
      else { set({ status: 'error', message: e.message }); timer = setTimeout(syncNow, 60000); }
    } finally {
      busy = false;
      if (again) { again = false; setTimeout(syncNow, 300); }
    }
  }

  function stashLocal() { try { localStorage.setItem(STASH, JSON.stringify({ at: new Date().toISOString(), data: Store.db })); } catch (e) { /* too big: skip */ } }
  async function resolve(choice) {
    const c = S.conflict; if (!c) return;
    if (choice === 'cloud') {
      if (hasData()) stashLocal();
      Store.replaceAll(c.data, { fromCloud: true });
      saved.rev = c.rev; saved.dirty = false;
    } else {
      saved.rev = c.rev; saved.dirty = true; // upload this device's copy on top of the cloud one
    }
    saved.userId = saved.session.id; keep();
    set({ status: 'idle', conflict: null });
    syncNow();
  }

  // Local edits: mark unsaved and upload shortly after typing stops.
  Store.onLocalChange(() => {
    if (!enabled) return;
    editSeq++; saved.dirty = true; keep();
    if (!saved.session) return;
    if (S.status !== 'conflict' && S.status !== 'offline') set({ status: 'saving' });
    clearTimeout(timer); timer = setTimeout(syncNow, 1500);
  });

  // ---------- Sign in / out ----------
  async function signIn(email, password) {
    const j = await request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: email.trim(), password } });
    takeSession(j);
    saved.skip = false; keep();
    set({ status: 'idle', message: '' });
    await syncNow();
  }
  async function signOut(wipe) {
    if (saved.dirty && saved.session) { try { await syncNow(); } catch (e) { /* keep going */ } }
    if (saved.dirty && !wipe && !confirm('Some changes have not reached the cloud yet. Sign out anyway? (They stay on this device.)')) return;
    try { if (saved.session) await request('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
    saved.session = null;
    if (wipe) { saved.rev = null; saved.userId = null; saved.dirty = false; Store.replaceAll({}, { fromCloud: true }); }
    keep(); set({ status: 'signedout', conflict: null, message: '' });
  }
  function skip() { saved.skip = true; keep(); emit(); }

  // ---------- Cloud daily copies (made by a database trigger) ----------
  const listSnapshots = () => request('/rest/v1/fscc_snapshots?select=id,taken_at&order=taken_at.desc&limit=30');
  async function restoreSnapshot(id) {
    const rows = await request('/rest/v1/fscc_snapshots?select=data&id=eq.' + encodeURIComponent(id));
    if (!rows || !rows[0]) throw new Error('Copy not found');
    stashLocal();
    Store.replaceAll(rows[0].data); // counts as a local edit, so it is uploaded
  }

  // ---------- Triggers ----------
  if (enabled) {
    addEventListener('online', syncNow);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); else if (saved.dirty) syncNow(); });
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
    if (saved.session) setTimeout(syncNow, 50);
  }

  // ---------- UI ----------
  function SignInScreen() {
    const [email, setEmail] = useState(saved.session && saved.session.email || '');
    const [pw, setPw] = useState('');
    const [err, setErr] = useState(S.message || '');
    const [wait, setWait] = useState(false);
    const go = async (e) => {
      e.preventDefault(); setErr(''); setWait(true);
      try { await signIn(email, pw); } catch (x) { setErr(x instanceof Offline ? 'No internet connection.' : /invalid/i.test(x.message) ? 'Wrong email or password.' : x.message); }
      setWait(false);
    };
    return html`<div class="signin"><form class="card" onSubmit=${go}>
      <div class="logo-lg">Field Sales<br/>Command Center</div>
      <p class="small muted" style="margin-top:0">Sign in to see your accounts on any device.</p>
      <label class="f">Email<input type="email" autocomplete="username" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
      <label class="f" style="margin-top:10px">Password<input type="password" autocomplete="current-password" required value=${pw} onInput=${(e) => setPw(e.target.value)} /></label>
      ${err && html`<div class="badbox small" style="margin-top:10px">${err}</div>`}
      <button class="primary" style="margin-top:14px;width:100%;justify-content:center" disabled=${wait}>${wait ? 'Signing in…' : 'Sign in'}</button>
      <p class="small muted" style="margin:14px 0 0;text-align:center"><a style="cursor:pointer;text-decoration:underline" onClick=${skip}>Use without signing in</a> (data stays on this device only)</p>
    </form></div>`;
  }

  function ConflictModal() {
    const c = S.conflict;
    const local = { customers: Store.db.customers.length, visits: Store.db.visits.length, trips: Store.db.trips.length };
    const line = (x) => `${x.customers} accounts · ${x.visits} activities · ${x.trips} trips`;
    return html`<div class="overlay center"><div class="modal" role="dialog">
      <div class="mhead"><h2 style="margin:0">Which copy should I keep?</h2></div>
      <div class="mbody">
        <p style="margin-top:0">${c.reason === 'first'
          ? 'This device already has data, and so does your cloud account.'
          : 'This device has changes that never reached the cloud, and the cloud was changed from another device in the meantime.'}</p>
        <div class="grid g2">
          <div class="card"><strong>☁ Cloud copy</strong><div class="small muted">${line(c.cloud)}</div><div class="small muted">Saved ${c.updatedAt ? new Date(c.updatedAt).toLocaleString('en-CA') : ''}</div></div>
          <div class="card"><strong>💻 This device</strong><div class="small muted">${line(local)}</div></div>
        </div>
        <p class="small muted">The copy you don't keep is saved on this device. You can download it from Data & settings → Cloud sync.</p>
      </div>
      <div class="mfoot"><button onClick=${() => resolve('device')}>Keep this device's copy</button><button class="primary" onClick=${() => resolve('cloud')}>Keep cloud copy</button></div>
    </div></div>`;
  }

  // Wraps the whole app: sign-in screen when needed, and the conflict question.
  function SyncGate({ children }) {
    const s = useSync();
    if (enabled && !saved.session && !saved.skip) return html`<${SignInScreen} />`;
    return html`${children}${s.status === 'conflict' && s.conflict && html`<${ConflictModal} />`}`;
  }

  const time = (iso) => iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }) : '';
  function statusText(s) {
    if (s.status === 'off') return ['', 'Data saved in this browser.'];
    if (s.status === 'signedout') return ['⚠', 'Not signed in. Data on this device only.'];
    if (s.status === 'saving') return ['⏳', 'Saving to cloud…'];
    if (s.status === 'offline') return ['⚠', saved.dirty ? 'Offline. Changes will sync when back online.' : 'Offline.'];
    if (s.status === 'error') return ['⚠', 'Sync problem. See Data & settings.'];
    if (s.status === 'conflict') return ['⚠', 'Choose which copy to keep.'];
    return ['☁', 'Synced ' + time(saved.lastSync)];
  }
  function StatusLine() { const s = useSync(); const [i, t] = statusText(s); return html`<span title=${saved.session ? saved.session.email : ''}>${i} ${t}</span>`; }
  function StatusIcon() { const s = useSync(); if (s.status === 'off') return null; const [i, t] = statusText(s); return html`<span title=${t} style="font-size:16px">${i}</span>`; }

  function CloudCard() {
    const s = useSync();
    const [snaps, setSnaps] = useState(null);
    const [msg, setMsg] = useState('');
    if (!enabled) return html`<div class="card"><h2>Cloud sync</h2>
      <p class="small muted" style="margin-top:0">Off. To use the app on your phone and keep data in the cloud, add your Supabase address and key to <code>config.js</code> (see README → "Use it on your phone").</p></div>`;
    if (!saved.session) return html`<div class="card"><h2>Cloud sync</h2>
      <p class="small muted" style="margin-top:0">You're not signed in, so your data is only on this device.</p>
      <button class="primary" onClick=${() => { saved.skip = false; keep(); emit(); }}>Sign in</button></div>`;
    let stash = null; try { stash = JSON.parse(localStorage.getItem(STASH) || 'null'); } catch (e) { /* ignore */ }
    const loadSnaps = async () => { setMsg(''); try { setSnaps(await listSnapshots()); } catch (e) { setMsg(e.message); } };
    const restore = async (sn) => {
      if (!confirm(`Replace all current data with the cloud copy from ${new Date(sn.taken_at).toLocaleString('en-CA')}?`)) return;
      try { await restoreSnapshot(sn.id); G.UIX.UI.toast('Restored. Uploading…'); } catch (e) { alert('Restore failed: ' + e.message); }
    };
    const [icon, text] = statusText(s);
    return html`<div class="card"><h2>Cloud sync</h2>
      <p class="small" style="margin-top:0">${icon} ${text}<br/><span class="muted">Signed in as ${saved.session.email}. Every change is saved to the cloud within a few seconds.</span></p>
      ${s.message && html`<div class="badbox small" style="margin-bottom:8px">${s.message}</div>`}
      <div class="row">
        <button onClick=${() => syncNow()}>↻ Sync now</button>
        <button onClick=${loadSnaps}>Daily cloud copies…</button>
        <button onClick=${() => signOut(false)}>Sign out</button>
      </div>
      ${msg && html`<div class="badbox small" style="margin-top:8px">${msg}</div>`}
      ${snaps && html`<div style="margin-top:10px">${!snaps.length ? html`<div class="small muted">No daily copies yet. One is kept each day you make changes (last 60 days).</div>`
        : html`<table><tbody>${snaps.map((sn) => html`<tr><td class="small">${new Date(sn.taken_at).toLocaleString('en-CA')}</td><td style="text-align:right"><button class="sm" onClick=${() => restore(sn)}>Restore</button></td></tr>`)}</tbody></table>`}</div>`}
      ${stash && html`<p class="small muted" style="margin-bottom:0">A replaced copy from ${new Date(stash.at).toLocaleString('en-CA')} is saved on this device.
        <a style="cursor:pointer;text-decoration:underline" onClick=${() => FS.download('fscc-replaced-copy.json', JSON.stringify(stash.data), 'application/json')}>Download it</a></p>`}
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer">On a shared or lost device</summary>
        <button class="danger" style="margin-top:8px" onClick=${() => { if (confirm('Sign out and remove all data from this device? Your cloud copy is kept.')) signOut(true); }}>Sign out and erase this device</button></details>
    </div>`;
  }

  // Calls a Supabase Edge Function as the signed-in user. Errors carry .offline when there is no connection.
  async function callFunction(name, body) {
    if (!enabled || !saved.session) throw signedOutError();
    try { return await request('/functions/v1/' + name, { method: 'POST', body }); }
    catch (e) { if (e instanceof Offline) e.offline = true; throw e; }
  }

  G.Sync = { enabled, state: S, syncNow, callFunction, signIn, signOut, SyncGate, StatusLine, StatusIcon, CloudCard, get signedIn() { return !!saved.session; } };
})(window);
