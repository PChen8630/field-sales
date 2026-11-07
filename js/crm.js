/* Dynamics 365 import: read a CRM export (.xlsx or .csv) in the browser, match it to the app's
   dealers, show every difference, and change nothing until the user taps Apply. One-step Undo.
   The file never leaves the device: it is read here and only the chosen changes are saved. */
(function (G) {
  'use strict';
  const { html, useState, useMemo } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const { useDB, UI, Modal } = G.UIX;
  const UNDO_KEY = 'fscc.crmUndo';

  // ---------- Reading .xlsx without a library (zip + XML) ----------
  async function inflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function unzip(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf), files = {};
    let e = buf.byteLength - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('This is not an Excel (.xlsx) file.');
    let p = v.getUint32(e + 16, true); const n = v.getUint16(e + 10, true);
    const dec = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      files[name] = { method, data: u8.subarray(start, start + size) };
      p += 46 + nl + xl + cl;
    }
    return async (name) => { const f = files[name]; if (!f) return null; return dec.decode(f.method === 8 ? await inflate(f.data) : f.data); };
  }
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const tags = (node, t) => Array.from(node.getElementsByTagNameNS('*', t));
  const colIdx = (ref) => { const m = /^([A-Z]+)/.exec(ref || ''); let n = 0; if (!m) return -1; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function readXlsx(buf) {
    const get = await unzip(buf);
    const wb = xml(await get('xl/workbook.xml'));
    const rels = xml(await get('xl/_rels/workbook.xml.rels') || '<r/>');
    const target = {}; tags(rels, 'Relationship').forEach((r) => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const sheets = tags(wb, 'sheet');
    const sh = sheets.find((s) => !s.getAttribute('state') || s.getAttribute('state') === 'visible') || sheets[0];
    const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
    let path = (target[rid] || 'worksheets/sheet1.xml').replace(/^\//, '');
    if (!path.startsWith('xl/')) path = 'xl/' + path;
    const ss = await get('xl/sharedStrings.xml');
    const shared = ss ? tags(xml(ss), 'si').map((si) => tags(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')) : [];
    const doc = xml(await get(path));
    const rows = [];
    tags(doc, 'row').forEach((r) => {
      const row = [];
      tags(r, 'c').forEach((c, k) => {
        const i = c.getAttribute('r') ? colIdx(c.getAttribute('r')) : k;
        const t = c.getAttribute('t'), vEl = tags(c, 'v')[0], val = vEl ? vEl.textContent : '';
        row[i] = t === 's' ? (shared[Number(val)] ?? '') : t === 'inlineStr' ? tags(c, 't').map((x) => x.textContent).join('') : t === 'b' ? (val === '1' ? 'TRUE' : 'FALSE') : val;
      });
      for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
      rows.push(row);
    });
    return { sheet: sh.getAttribute('name'), rows: rows.filter((r) => r.some((x) => String(x).trim() !== '')) };
  }

  // ---------- Column matching ----------
  const COLS = {
    crmId: ['do not modify account', 'account id', 'accountid', 'guid'],
    checksum: ['do not modify row checksum', 'row checksum'],
    modifiedOn: ['do not modify modified on', 'modified on'],
    name: ['account name', 'company name', 'name', 'company'],
    accountCode: ['account code', 'account number', 'dealer code', 'customer code', 'account no'],
    city: ['address 1 city', 'city'],
    province: ['address 1 state province', 'state province', 'province', 'address 1 state'],
    postal: ['address 1 zip postal code', 'zip postal code', 'postal code', 'postal', 'address 1 postal code'],
    address: ['address 1 street 1', 'street 1', 'address 1', 'street', 'address'],
    phone: ['main phone', 'phone', 'business phone', 'telephone', 'phone number'],
    email: ['email', 'e mail', 'email address'],
    contactName: ['primary contact', 'contact', 'contact name'],
    status: ['status', 'account status', 'status reason', 'state'],
    purchase: ['annual actual purchase', 'actual purchase', 'annual purchase'],
  };
  const COL_LABELS = { crmId: 'CRM record ID (hidden column)', checksum: 'Row checksum (hidden)', modifiedOn: 'Modified on (hidden)', name: 'Account name *', accountCode: 'Account code', address: 'Street', city: 'City', province: 'Province', postal: 'Postal code', phone: 'Phone', email: 'Email', contactName: 'Primary contact', status: 'Status', purchase: 'Annual actual purchase' };
  function autoCols(headers) {
    const h = headers.map((x) => FS.norm(x)), map = {}, used = new Set();
    Object.entries(COLS).forEach(([f, syn]) => { const i = h.findIndex((x, k) => !used.has(k) && syn.includes(x)); if (i >= 0) { map[f] = i; used.add(i); } });
    ['accountCode', 'purchase', 'crmId'].forEach((f) => { if (map[f] != null) return; const i = h.findIndex((x, k) => !used.has(k) && COLS[f].some((s) => x.includes(s))); if (i >= 0) { map[f] = i; used.add(i); } });
    return map;
  }

  // ---------- Normalising for comparison ----------
  const deacc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const SUFFIX = /\b(inc|incorporated|ltd|ltee|limited|limitee|corp|corporation|co|company|enr|senc|llc|the)\b/g;
  const normName = (s) => FS.norm(deacc(s).replace(/&/g, ' and ')).replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();
  const compactPostal = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fmtPostal = (s) => { const c = compactPostal(s); return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(c) ? c.slice(0, 3) + ' ' + c.slice(3) : String(s || '').trim(); };
  const phone10 = (s) => FS.digits(s);
  const isActive = (v) => { const n = FS.norm(deacc(v)); return /\b(active|actif)\b/.test(n) && !/\b(inactive|inactif)\b/.test(n); };
  const cleanGuid = (s) => String(s || '').trim().replace(/[{}]/g, '').toLowerCase();
  const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null; };

  // field in app, label, column in CRM, how to compare, how to store the CRM value in the app
  const FIELDS = [
    ['name', 'Company name', 'name', normName, (v) => String(v).trim()],
    ['address', 'Street', 'address', (v) => FS.norm(deacc(v)), (v) => String(v).trim()],
    ['city', 'City', 'city', (v) => FS.norm(deacc(v)), (v) => FS.niceCity(v)],
    ['province', 'Province', 'province', (v) => FS.normProvince(v) || FS.norm(v), (v) => FS.normProvince(v) || String(v).trim()],
    ['postal', 'Postal code', 'postal', compactPostal, fmtPostal],
    ['contactPhone', 'Phone', 'phone', phone10, (v) => String(v).trim()],
    ['contactEmail', 'Email', 'email', (v) => String(v).trim().toLowerCase(), (v) => String(v).trim()],
    ['contactName', 'Primary contact', 'contactName', (v) => FS.norm(deacc(v)), (v) => String(v).trim()],
  ];
  const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const blank = (v) => v == null || String(v).trim() === '';

  function crmRecord(row, map) {
    const g = (f) => map[f] != null && map[f] !== '' ? String(row[map[f]] ?? '').trim() : '';
    const r = {}; Object.keys(COLS).forEach((f) => { r[f] = g(f); });
    r.crmId = cleanGuid(r.crmId); r.purchaseNum = num(r.purchase);
    return r;
  }
  // What does each side know about this dealer? Used to judge name-only matches.
  const crmInfo = (r) => [r.accountCode && 'account code ' + r.accountCode, r.purchaseNum ? 'purchases ' + FS.money(r.purchaseNum) : null, r.address && 'street', r.phone && 'phone', r.email && 'email', r.contactName && 'contact'].filter(Boolean);
  function appInfo(c, db) {
    const yrs = Object.keys(c.pos || {}).filter((y) => Number(c.pos[y]));
    const visits = db.visits.filter((v) => v.customerId === c.id).length;
    return [c.dealerId && 'dealer # ' + c.dealerId, yrs.length ? 'POS ' + yrs.sort().map((y) => y + ' ' + FS.money(c.pos[y])).join(', ') : null, visits && visits + ' activities', c.address && 'street', c.contactPhone && 'phone', c.contactEmail && 'email'].filter(Boolean);
  }

  // ---------- Matching: CRM ID first, then name / email / phone / postal code ----------
  function buildPlan(rows, map, db) {
    const recs = rows.map((row, i) => ({ i, ...crmRecord(row, map) })).filter((r) => r.name);
    const byGuid = {}; db.customers.forEach((c) => { if (c.crmId) byGuid[cleanGuid(c.crmId)] = c; });
    const usedApp = new Set(), matches = [], left = [];
    recs.forEach((r) => { const c = r.crmId && byGuid[r.crmId]; if (c && !usedApp.has(c.id)) { usedApp.add(c.id); matches.push({ r, c, how: ['CRM ID'], nameOnly: false, score: 100 }); } else left.push(r); });
    const cands = [];
    const appKeys = db.customers.filter((c) => !usedApp.has(c.id)).map((c) => ({ c, n: normName(c.name), e: String(c.contactEmail || '').trim().toLowerCase(), p: phone10(c.contactPhone), z: compactPostal(c.postal) }));
    left.forEach((r) => {
      const n = normName(r.name), e = r.email.toLowerCase(), p = phone10(r.phone), z = compactPostal(r.postal);
      appKeys.forEach((a) => {
        let s = 0; const how = [];
        if (n && a.n === n) { s += 50; how.push('name'); }
        else if (n.length > 4 && a.n.length > 4 && (a.n.includes(n) || n.includes(a.n))) { s += 30; how.push('similar name'); }
        if (e && a.e === e) { s += 35; how.push('email'); }
        if (p.length === 10 && a.p === p) { s += 35; how.push('phone'); }
        if (z.length === 6 && a.z === z) { s += 20; how.push('postal code'); }
        if (s >= 50) cands.push({ r, c: a.c, how, score: s });
      });
    });
    cands.sort((a, b) => b.score - a.score);
    const usedCrm = new Set();
    cands.forEach((m) => { if (usedApp.has(m.c.id) || usedCrm.has(m.r.i)) return; usedApp.add(m.c.id); usedCrm.add(m.r.i); matches.push({ ...m, nameOnly: m.how.every((h) => h === 'name' || h === 'similar name') }); });
    const crmOnly = left.filter((r) => !usedCrm.has(r.i));
    const appOnly = db.customers.filter((c) => !usedApp.has(c.id));
    matches.forEach((m) => {
      m.diffs = []; m.fills = []; m.crmBlank = [];
      FIELDS.forEach(([f, label, col, cmp, store]) => {
        const a = m.c[f], b = m.r[col];
        if (blank(b) && blank(a)) return;
        if (blank(a)) m.fills.push({ f, label, crm: store(b) });
        else if (blank(b)) m.crmBlank.push({ f, label, app: a });
        else if (cmp(a) !== cmp(b)) m.diffs.push({ f, label, app: a, crm: store(b) });
      });
    });
    return { matches, crmOnly, appOnly, hasStatus: map.status != null && map.status !== '' };
  }

  // ---------- Small pieces ----------
  const Info = ({ label, items }) => html`<div class="small"><span class="muted">${label}:</span> ${items.length ? items.join(' · ') : html`<span style="color:var(--bad)">nothing on file</span>`}</div>`;
  function Pick({ value, onChange, opts }) {
    return html`<div class="seg" style="align-self:flex-start;flex-wrap:wrap">${opts.map(([v, l]) => html`<button class=${value === v ? 'on' : ''} style="padding:6px 12px" onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
  }
  function DiffRows({ m, pick, setPick, disabled }) {
    return html`${m.diffs.map((d) => { const k = m.c.id + ':' + d.f, v = pick[k] || 'app';
      return html`<div class="list-item" style="flex-wrap:wrap;opacity:${disabled ? .5 : 1}"><div style="flex:1;min-width:200px"><strong>${d.label}</strong>
        <div class="small"><span class="muted">App:</span> ${d.app}</div><div class="small"><span class="muted">CRM:</span> ${d.crm}</div></div>
        <${Pick} value=${v} onChange=${(x) => setPick({ ...pick, [k]: x })} opts=${[['app', 'App is right'], ['crm', 'CRM is right']]} /></div>`; })}`;
  }

  // ---------- The wizard ----------
  function CrmImport({ onClose }) {
    const db = useDB();
    const [step, setStep] = useState(1);
    const [file, setFile] = useState(null);       // { name, headers, rows, sheet }
    const [map, setMap] = useState({});
    const [plan, setPlan] = useState(null);
    const [tab, setTab] = useState('conflicts');
    const [pick, setPick] = useState({});         // "customerId:field" -> 'app' | 'crm'
    const [fill, setFill] = useState({});         // "customerId:field" -> false to skip a blank fill
    const [same, setSame] = useState({});         // name-only match: customerId -> 'same' | 'diff' | 'later'
    const [add, setAdd] = useState({});           // CRM-only row index -> true to add
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(null);

    const readFile = async (f) => {
      if (!f) return; setBusy(true);
      try {
        let rows, sheet = '';
        if (/\.xlsx$/i.test(f.name)) {
          if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old to read Excel files. Update it, or save the export as CSV.');
          const x = await readXlsx(await f.arrayBuffer()); rows = x.rows; sheet = x.sheet;
        } else rows = FS.parseCSV(await f.text());
        if (rows.length < 2) throw new Error('That file has no data rows.');
        const headers = rows[0].map((h) => String(h));
        setFile({ name: f.name, headers, rows: rows.slice(1), sheet }); setMap(autoCols(headers)); setStep(2);
      } catch (e) { alert('Could not read the file: ' + e.message); }
      setBusy(false);
    };
    const compare = () => {
      if (map.name == null || map.name === '') return alert('Choose the Account name column first.');
      const p = buildPlan(file.rows, map, Store.db);
      const a = {}; p.crmOnly.forEach((r) => { if (p.hasStatus && isActive(r.status)) a[r.i] = true; });
      const s = {}; p.matches.filter((m) => m.nameOnly).forEach((m) => { s[m.c.id] = 'later'; });
      setPlan(p); setAdd(a); setSame(s); setPick({}); setFill({});
      setTab(p.matches.some((m) => !m.nameOnly && m.diffs.length) ? 'conflicts' : 'nameonly'); setStep(3);
    };

    const linked = (m) => !m.nameOnly || same[m.c.id] === 'same';
    const summary = useMemo(() => {
      if (!plan) return null;
      const L = plan.matches.filter(linked);
      const changes = L.reduce((n, m) => n + m.diffs.filter((d) => pick[m.c.id + ':' + d.f] === 'crm').length + m.fills.filter((x) => fill[m.c.id + ':' + x.f] !== false).length, 0);
      const splitNew = plan.matches.filter((m) => m.nameOnly && same[m.c.id] === 'diff').map((m) => m.r);
      return { linked: L.length, changes, adds: plan.crmOnly.filter((r) => add[r.i]).length + splitNew.filter((r) => add['n' + r.i]).length, splitNew,
        undecided: plan.matches.filter((m) => m.nameOnly && same[m.c.id] === 'later').length };
    }, [plan, pick, fill, same, add]);

    const apply = () => {
      if (!confirm(`Apply to the app?\n\n• Link ${summary.linked} dealers to their CRM record\n• Change ${summary.changes} fields\n• Add ${summary.adds} new dealers\n\nNothing is deleted. You can undo this from Data & settings.`)) return;
      const snapshot = JSON.parse(JSON.stringify(Store.db)), at = new Date().toISOString();
      try { localStorage.setItem(UNDO_KEY, JSON.stringify({ at, file: file.name, snapshot })); } catch (e) { if (!confirm('Could not save an undo copy on this device (storage full). Continue anyway? A backup download first is safer.')) return; }
      let linkedN = 0, changed = 0, added = 0;
      Store.commit((d) => {
        const crmFields = (r) => ({ crmId: r.crmId || undefined, crmCode: r.accountCode || undefined, crmChecksum: r.checksum || undefined, crmModifiedOn: r.modifiedOn || undefined,
          crmStatus: r.status || undefined, crmPurchase: r.purchaseNum ?? undefined, crmSyncedAt: at });
        const strip = (o) => { Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]); return o; };
        plan.matches.filter(linked).forEach((m) => {
          const c = d.customers.find((x) => x.id === m.c.id); if (!c) return;
          Object.assign(c, strip(crmFields(m.r))); linkedN++;
          m.diffs.forEach((x) => { if (pick[m.c.id + ':' + x.f] === 'crm') { c[x.f] = x.crm; changed++; } });
          m.fills.forEach((x) => { if (fill[m.c.id + ':' + x.f] !== false) { c[x.f] = x.crm; changed++; } });
          c.updatedAt = at;
        });
        const newRows = [...plan.crmOnly.filter((r) => add[r.i]), ...summary.splitNew.filter((r) => add['n' + r.i])];
        newRows.forEach((r) => {
          const rec = { id: FS.uid(), createdAt: at, updatedAt: at, name: r.name, priority: 'C', country: 'Canada', source: 'Dynamics 365',
            status: r.purchaseNum > 0 ? 'Active Customer' : 'Prospect', ...strip(crmFields(r)) };
          FIELDS.forEach(([f, , col, , store]) => { if (!blank(r[col]) && f !== 'name') rec[f] = store(r[col]); });
          d.customers.push(rec); added++;
        });
      });
      setDone({ linkedN, changed, added }); UI.toast(`CRM import: ${linkedN} linked, ${changed} fields changed, ${added} added`);
    };

    // List for updating the CRM by hand: where the app is right and the CRM differs or is blank, plus app-only dealers.
    const exportForCrm = () => {
      const out = [];
      plan.matches.filter(linked).forEach((m) => {
        m.diffs.forEach((x) => { if (pick[m.c.id + ':' + x.f] !== 'crm') out.push([m.r.crmId, m.r.accountCode, m.r.name, x.label, x.crm, x.app, 'App is right']); });
        m.crmBlank.forEach((x) => out.push([m.r.crmId, m.r.accountCode, m.r.name, x.label, '', x.app, 'Blank in CRM']));
      });
      plan.appOnly.forEach((c) => out.push(['', '', c.name, 'Whole account', '', [c.address, c.city, c.province, c.postal].filter(Boolean).join(', '), 'Only in the app']));
      plan.matches.filter((m) => m.nameOnly && same[m.c.id] === 'later').forEach((m) => out.push([m.r.crmId, m.r.accountCode, m.r.name, 'Same company?', m.r.name, m.c.name, 'Not decided']));
      FS.download(`crm-updates-${FS.today()}.csv`, FS.toCSV(['CRM record ID', 'Account code', 'CRM account name', 'Field', 'CRM now', 'App value', 'Why'], out));
    };

    let body, footer;
    if (done) {
      body = html`<div class="stack"><div class="okbox">Done: ${pl(done.linkedN, 'dealer')} linked to the CRM, ${pl(done.changed, 'field')} changed, ${pl(done.added, 'dealer')} added.</div>
        <div class="small muted">Changed your mind? Use <strong>Undo last CRM import</strong> on Data & settings. It puts everything back as it was just before this import.</div></div>`;
      footer = html`<button onClick=${exportForCrm}>⬇ List of CRM updates</button><span class="spacer"></span><button class="primary" onClick=${onClose}>Close</button>`;
    } else if (step === 1) {
      body = html`<div class="stack">
        <p style="margin:0">Choose your Dynamics 365 account export (Excel). The file is read on this device only and is not uploaded anywhere.</p>
        <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled=${busy} onChange=${(e) => readFile(e.target.files[0])} />
        ${busy && html`<div class="small">Reading…</div>`}
        <div class="small muted">In Dynamics: open your accounts view → <em>Export to Excel → Static worksheet</em>. Keep the hidden columns: the app uses the CRM record ID to recognise each dealer next time.</div></div>`;
    } else if (step === 2) {
      const found = Object.keys(COL_LABELS).filter((f) => map[f] != null && map[f] !== '').length;
      body = html`<div><p class="muted small" style="margin-top:0">${file.rows.length} rows${file.sheet ? ' on sheet “' + file.sheet + '”' : ''}. ${found} columns recognised. Check them, then compare.</p>
        ${(map.crmId == null || map.crmId === '') && html`<div class="badbox small" style="margin-bottom:10px">No hidden CRM record ID column found. Matching will use name, email, phone and postal code only.</div>`}
        <div class="form">${Object.keys(COL_LABELS).map((f) => html`<label class="f">${COL_LABELS[f]}<select value=${map[f] ?? ''} onChange=${(e) => setMap({ ...map, [f]: e.target.value === '' ? null : Number(e.target.value) })}><option value="">— not used —</option>${file.headers.map((h, i) => html`<option value=${i}>${h}${file.rows[0] && file.rows[0][i] ? ' (e.g. ' + String(file.rows[0][i]).slice(0, 24) + ')' : ''}</option>`)}</select></label>`)}</div></div>`;
      footer = html`<button onClick=${() => setStep(1)}>Back</button><button class="primary" onClick=${compare}>Compare with the app</button>`;
    } else {
      const P = plan, conf = P.matches.filter((m) => !m.nameOnly && m.diffs.length), nameOnly = P.matches.filter((m) => m.nameOnly);
      const fills = P.matches.filter((m) => linked(m) && m.fills.length);
      const newActive = P.crmOnly.filter((r) => isActive(r.status)).length;
      const tabs = [['conflicts', `Conflicts (${conf.length})`], ['nameonly', `Name-only matches (${nameOnly.length})`], ['new', `Only in CRM (${P.crmOnly.length})`], ['apponly', `Only in app (${P.appOnly.length})`], ['fills', `Blanks to fill (${fills.reduce((n, m) => n + m.fills.length, 0)})`]];
      const setAll = (rows, v) => { const a = { ...add }; rows.forEach((r) => { a[r.i] = v; }); setAdd(a); };
      body = html`<div class="stack">
        <div class="row" style="flex-wrap:wrap"><span class="tag ok">${P.matches.length} matched</span><span class="tag blue">${P.matches.filter((m) => m.how[0] === 'CRM ID').length} by CRM ID</span><span class="tag warn">${nameOnly.length} by name only</span><span class="tag">${P.crmOnly.length} only in CRM</span><span class="tag">${P.appOnly.length} only in app</span></div>
        <div class="small muted">Nothing changes until you tap Apply. Nothing is ever deleted.</div>
        <div class="tabs" style="overflow-x:auto">${tabs.map(([k, l]) => html`<button class=${tab === k ? 'on' : ''} style="white-space:nowrap" onClick=${() => setTab(k)}>${l}</button>`)}</div>
        <div class="scroll" style="max-height:52vh">
        ${tab === 'conflicts' && (conf.length ? conf.map((m) => html`<div class="card" style="margin-bottom:10px"><strong>${m.c.name}</strong> <span class="small muted">matched by ${m.how.join(' + ')}</span>
            <${DiffRows} m=${m} pick=${pick} setPick=${setPick} /></div>`) : html`<div class="okbox">No conflicts. The app and the CRM agree on every matched dealer.</div>`)}
        ${tab === 'nameonly' && (nameOnly.length ? html`<div class="small muted" style="margin-bottom:8px">These were paired by company name alone. Check what each side knows before you decide.</div>${nameOnly.map((m) => html`<div class="card" style="margin-bottom:10px">
            <div><strong>App:</strong> ${m.c.name} <span class="small muted">${[m.c.city, m.c.province].filter(Boolean).join(', ')}</span></div>
            <${Info} label="App has" items=${appInfo(m.c, db)} />
            <div style="margin-top:6px"><strong>CRM:</strong> ${m.r.name} <span class="small muted">${[m.r.city, m.r.province].filter(Boolean).join(', ')}${m.r.status ? ' · ' + m.r.status : ''}</span></div>
            <${Info} label="CRM has" items=${crmInfo(m.r)} />
            <div style="margin:8px 0"><${Pick} value=${same[m.c.id]} onChange=${(v) => setSame({ ...same, [m.c.id]: v })} opts=${[['same', 'Same company'], ['diff', 'Different'], ['later', 'Decide later']]} /></div>
            ${same[m.c.id] === 'same' && html`<${DiffRows} m=${m} pick=${pick} setPick=${setPick} />`}
            ${same[m.c.id] === 'diff' && html`<label class="small"><input type="checkbox" checked=${!!add['n' + m.r.i]} onChange=${(e) => setAdd({ ...add, ['n' + m.r.i]: e.target.checked })} /> Add the CRM one as a new dealer</label>`}
          </div>`)}` : html`<div class="okbox">No name-only matches.</div>`)}
        ${tab === 'new' && html`<div class="small muted" style="margin-bottom:8px">${P.hasStatus ? `${newActive} of ${P.crmOnly.length} are Active in the CRM and are ticked. Untick any you don't want.` : 'No Status column, so nothing is ticked. Tick the ones to add.'}</div>
          <div class="row" style="margin-bottom:6px"><button class="sm" onClick=${() => setAll(P.crmOnly.filter((r) => isActive(r.status)), true)}>Tick Active only</button><button class="sm" onClick=${() => setAll(P.crmOnly, false)}>Untick all</button></div>
          ${P.crmOnly.map((r) => html`<label class="list-item" style="cursor:pointer"><input type="checkbox" checked=${!!add[r.i]} onChange=${(e) => setAdd({ ...add, [r.i]: e.target.checked })} />
            <div style="flex:1"><strong>${r.name}</strong> ${r.status && html`<span class=${'tag ' + (isActive(r.status) ? 'ok' : '')}>${r.status}</span>`}<div class="small muted">${[r.address, r.city, r.province].filter(Boolean).join(', ')}${r.purchaseNum ? ' · purchases ' + FS.money(r.purchaseNum) : ''}</div></div></label>`)}`}
        ${tab === 'apponly' && html`<div class="small muted" style="margin-bottom:8px">These dealers are in the app but not in this CRM export. They stay in the app. They're included in the “List of CRM updates” so you can add them to the CRM.</div>
          ${P.appOnly.map((c) => html`<div class="list-item"><div style="flex:1"><strong>${c.name}</strong> <span class="small muted">${[c.city, c.province].filter(Boolean).join(', ')}</span><${Info} label="App has" items=${appInfo(c, db)} /></div><button class="sm" onClick=${() => UI.openCustomer(c.id)}>Open</button></div>`)}`}
        ${tab === 'fills' && (fills.length ? html`<div class="small muted" style="margin-bottom:8px">The app is blank here and the CRM has a value. Ticked ones are copied from the CRM.</div>${fills.map((m) => html`<div class="card" style="margin-bottom:8px"><strong>${m.c.name}</strong>
            ${m.fills.map((x) => { const k = m.c.id + ':' + x.f; return html`<label class="list-item small" style="cursor:pointer"><input type="checkbox" checked=${fill[k] !== false} onChange=${(e) => setFill({ ...fill, [k]: e.target.checked })} /><span style="flex:1"><span class="muted">${x.label}:</span> ${x.crm}</span></label>`; })}</div>`)}` : html`<div class="okbox">No blanks to fill.</div>`)}
        </div>
        <div class="small"><strong>If you apply now:</strong> link ${pl(summary.linked, 'dealer')} · change ${pl(summary.changes, 'field')} · add ${pl(summary.adds, 'dealer')}${summary.undecided ? ` · ${summary.undecided} name-only matches left for later` : ''}</div></div>`;
      footer = html`<button onClick=${() => setStep(2)}>Back</button><button onClick=${exportForCrm}>⬇ List of CRM updates</button><span class="spacer"></span><button class="primary" onClick=${apply}>Apply</button>`;
    }
    return html`<${Modal} wide title=${'Compare with Dynamics 365' + (file ? ' · ' + file.name : '')} onClose=${onClose} footer=${footer}>${body}<//>`;
  }

  // ---------- Card on Data & settings ----------
  function CrmCard() {
    const db = useDB();
    const [open, setOpen] = useState(false);
    const [, bump] = useState(0);
    let last = null; try { const raw = localStorage.getItem(UNDO_KEY); if (raw) { const j = JSON.parse(raw); last = { at: j.at, file: j.file }; } } catch (e) { /* ignore */ }
    const undo = () => {
      if (!confirm(`Undo the CRM import from ${new Date(last.at).toLocaleString('en-CA')}?\n\nEverything goes back to how it was just before that import, including any edits made since then.`)) return;
      try { const j = JSON.parse(localStorage.getItem(UNDO_KEY)); Store.replaceAll(j.snapshot); localStorage.removeItem(UNDO_KEY); UI.toast('CRM import undone'); bump((n) => n + 1); } catch (e) { alert('Undo failed: ' + e.message); }
    };
    const linkedN = db.customers.filter((c) => c.crmId || c.crmSyncedAt).length;
    return html`<div class="card"><h2>Dynamics 365 (CRM)</h2>
      <p class="small muted" style="margin-top:0">Compare your CRM export with the app. You see every difference and choose which side is right. Nothing changes until you tap Apply.</p>
      <div class="row" style="margin-bottom:8px"><span class="tag ${linkedN ? 'ok' : ''}">${linkedN} of ${db.customers.length} linked to CRM</span></div>
      <div class="row"><button class="primary" onClick=${() => setOpen(true)}>Compare with CRM export…</button>${last && html`<button class="danger" onClick=${undo}>Undo last CRM import</button>`}</div>
      ${last && html`<div class="small muted" style="margin-top:6px">Last import: ${new Date(last.at).toLocaleString('en-CA')} (${last.file}). Undo is kept on this device only.</div>`}
      ${open && html`<${CrmImport} onClose=${() => { setOpen(false); bump((n) => n + 1); }} />`}</div>`;
  }

  G.Crm = { CrmCard, CrmImport, readXlsx, buildPlan, autoCols };
})(window);
