/* Data page: import, geocode, regions, settings, backup */
(function (G) {
  'use strict';
  const { html, useState, useEffect, useRef } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const { useDB, UI, Modal, MapView } = G.UIX;

  // ---------- CSV import wizard ----------
  function ImportWizard({ onClose }) {
    const db = useDB();
    const [step, setStep] = useState(1);
    const [rows, setRows] = useState([]);
    const [headers, setHeaders] = useState([]);
    const [map, setMap] = useState({});
    const [review, setReview] = useState([]);
    const [fileName, setFileName] = useState('');
    const readFile = (f) => {
      if (!f) return; setFileName(f.name);
      const r = new FileReader();
      r.onload = () => { const all = FS.parseCSV(String(r.result)); if (all.length < 2) return alert('That file has no data rows.'); setHeaders(all[0]); setRows(all.slice(1)); setMap(FS.autoMap(all[0])); setStep(2); };
      r.readAsText(f);
    };
    const toRecord = (row) => FS.importRecord(row, map, headers);
    const toReview = () => {
      if (map.name == null || map.name === '') return alert('Map the Company name column first.');
      const seen = [];
      const out = rows.map((row, i) => {
        const rec = toRecord(row);
        if (!rec.name) return { i, rec, action: 'skip', why: 'No name' };
        const dupE = FS.findDuplicate(rec, db.customers);
        const dupI = FS.findDuplicate(rec, seen.map((x) => x.rec));
        seen.push({ rec });
        if (dupE) return { i, rec, match: dupE.match, score: dupE.score, action: 'merge', why: 'Matches existing account' };
        if (dupI) return { i, rec, action: 'skip', why: 'Duplicate row within this file (' + dupI.match.name + ')' };
        return { i, rec, action: 'create' };
      });
      setReview(out); setStep(3);
    };
    const doImport = () => {
      let created = 0, merged = 0, regionsMade = 0, contactsMade = 0;
      Store.commit((d) => {
        const now = new Date().toISOString();
        const regionFor = (name, prov) => {
          if (!name) return null;
          let r = d.regions.find((x) => FS.norm(x.name) === FS.norm(name));
          if (!r) { r = { id: FS.uid(), name, province: prov || '', timezone: FS.TZ_BY_PROV[prov] || 'America/Halifax', createdAt: now }; d.regions.push(r); regionsMade++; }
          return r.id;
        };
        review.forEach((x) => {
          if (x.action === 'skip') return;
          const { _region, _contacts, ...rec } = x.rec;
          const regionId = regionFor(_region, rec.province);
          if (regionId) rec.regionId = regionId;
          let cid = null;
          if (x.action === 'merge' && x.match) {
            const c = d.customers.find((y) => y.id === x.match.id);
            if (c) {
              Object.entries(rec).forEach(([k, v]) => { if (k === 'pos') c.pos = { ...v, ...(c.pos || {}) }; else if (c[k] == null || c[k] === '') c[k] = v; });
              c.updatedAt = now; merged++; cid = c.id;
            }
          }
          if (!cid) { cid = FS.uid(); d.customers.push({ id: cid, createdAt: now, updatedAt: now, ...rec }); created++; }
          (_contacts || []).forEach((k) => {
            const dupe = d.contacts.some((y) => y.customerId === cid && ((k.email && (y.email || '').toLowerCase() === k.email.toLowerCase()) || FS.norm(y.name) === FS.norm(k.name)));
            if (!dupe) { d.contacts.push({ id: FS.uid(), createdAt: now, updatedAt: now, customerId: cid, ...k }); contactsMade++; }
          });
        });
      });
      UI.toast(`Imported: ${created} new, ${merged} merged${regionsMade ? ', ' + regionsMade + ' regions' : ''}${contactsMade ? ', ' + contactsMade + ' extra contacts' : ''}`);
      onClose();
    };
    const fields = Object.keys(FS.FIELD_LABELS);
    const counts = { create: review.filter((r) => r.action === 'create').length, merge: review.filter((r) => r.action === 'merge').length, skip: review.filter((r) => r.action === 'skip').length };
    const flagged = review.filter((r) => r.match || r.why);
    return html`<${Modal} wide title=${'Import accounts from CSV' + (fileName ? ' · ' + fileName : '')} onClose=${onClose}
      footer=${step === 2 ? html`<button onClick=${() => setStep(1)}>Back</button><button class="primary" onClick=${toReview}>Next: check duplicates</button>`
        : step === 3 ? html`<button onClick=${() => setStep(2)}>Back</button><button class="primary" onClick=${doImport}>Import ${counts.create} new + merge ${counts.merge}</button>` : null}>
      ${step === 1 && html`<div class="stack">
        <p style="margin:0">Choose a CSV exported from Base44, Excel or your CRM. Columns are matched automatically, and you can adjust the matching on the next screen.</p>
        <input type="file" accept=".csv,text/csv" onChange=${(e) => readFile(e.target.files[0])} />
        <div class="small muted">Tip: in Excel use <em>File → Save As → CSV UTF-8</em>. A "region" column with names (e.g. "Halifax Metro") creates regions automatically. Region IDs from Base44 can't be matched, so export region names instead.</div>
        <button class="sm" style="align-self:flex-start" onClick=${() => FS.download('account-template.csv', FS.toCSV(['customer_name', 'address', 'city', 'province', 'postal_code', 'region', 'account_priority', 'partner_level', 'relationship_status', 'last_visit_date', 'next_follow_up_date', 'contact_name', 'contact_email', 'contact_phone', 'notes'], [['ABC Security Ltd', '123 Main St', 'Moncton', 'NB', 'E1C 1A1', 'Moncton', 'A', 'Executive', 'Active Customer', '2026-09-15', '2026-11-10', 'Jane Doe', 'jane@abc.ca', '506-555-0100', '']]))}>Download template</button></div>`}
      ${step === 2 && html`<div>
        <p class="muted small" style="margin-top:0">${rows.length} rows found. Check each field points at the right column.</p>
        <div class="form">${fields.map((f) => html`<label class="f">${FS.FIELD_LABELS[f]}<select value=${map[f] ?? ''} onChange=${(e) => setMap({ ...map, [f]: e.target.value === '' ? null : Number(e.target.value) })}><option value="">— not imported —</option>${headers.map((h, i) => html`<option value=${i}>${h}${rows[0] && rows[0][i] ? ' (e.g. ' + String(rows[0][i]).slice(0, 24) + ')' : ''}</option>`)}</select></label>`)}</div></div>`}
      ${step === 3 && html`<div class="stack">
        <div class="row"><span class="tag ok">${counts.create} new</span><span class="tag blue">${counts.merge} merge</span><span class="tag">${counts.skip} skip</span></div>
        <div class="small muted">"Merge" fills only the blank fields of the existing account and never overwrites your data. Review the flagged rows below.</div>
        ${(() => { const recs = review.filter((r) => r.action !== 'skip').map((r) => r.rec); const pos = recs.filter((r) => r.pos).length, ct = recs.reduce((a, r) => a + ((r._contacts || []).length), 0), np = recs.filter((r) => !r.province).length;
          return html`<div class="small">Also found: ${pos} accounts with POS sales · ${ct} additional contacts · ${recs.filter((r) => r.distributor).length} with distributor${np ? html` · <span style="color:var(--bad)">${np} with unknown province</span>` : ''}</div>`; })()}
        ${flagged.length ? html`<div class="scroll" style="max-height:48vh"><table><thead><tr><th>Row</th><th>From file</th><th>Possible match</th><th>Action</th></tr></thead><tbody>
          ${flagged.map((r) => html`<tr><td class="num">${r.i + 2}</td><td><strong>${r.rec.name || '(blank)'}</strong><div class="small muted">${[r.rec.address, r.rec.city].filter(Boolean).join(', ')}</div></td>
            <td>${r.match ? html`<strong>${r.match.name}</strong> <span class="tag warn">${r.score}%</span><div class="small muted">${[r.match.address, r.match.city].filter(Boolean).join(', ')}</div>` : html`<span class="small muted">${r.why}</span>`}</td>
            <td><select value=${r.action} onChange=${(e) => setReview(review.map((x) => x.i === r.i ? { ...x, action: e.target.value } : x))}>${r.match && html`<option value="merge">Merge into existing</option>`}<option value="create">Create new</option><option value="skip">Skip</option></select></td></tr>`)}
        </tbody></table></div>` : html`<div class="okbox">No duplicates found.</div>`}</div>`}
    <//>`;
  }

  // ---------- Geocoding ----------
  const geoJob = { running: false, stop: false, done: 0, total: 0, found: 0, failed: 0, current: '' };
  const geoSubs = new Set();
  const geoEmit = () => geoSubs.forEach((f) => f());
  async function runGeocode(retryFailed) {
    if (geoJob.running) return;
    const todo = Store.db.customers.filter((c) => !FS.hasGeo(c) && (retryFailed || c.geo !== 'failed') && (c.address || c.city || c.postal));
    Object.assign(geoJob, { running: true, stop: false, done: 0, total: todo.length, found: 0, failed: 0, current: '' }); geoEmit();
    for (const c of todo) {
      if (geoJob.stop) break;
      geoJob.current = c.name; geoEmit();
      let r = null, err = null;
      try { r = await FS.geocodeCustomer(c); } catch (e) { err = e; }
      if (err && /429|HTTP 5/.test(err.message)) { await FS.sleep(5000); }
      Store.commit((d) => { const x = d.customers.find((y) => y.id === c.id); if (!x) return; if (r) { x.lat = r.lat; x.lng = r.lng; x.geo = r.geo; } else if (!err) x.geo = 'failed'; });
      r ? geoJob.found++ : geoJob.failed++;
      geoJob.done++; geoEmit();
      await FS.sleep(1100); // OpenStreetMap fair-use limit: max 1 request / second
    }
    geoJob.running = false; geoJob.current = ''; geoEmit();
    UI.toast(`Locating done: ${geoJob.found} found, ${geoJob.failed} not found`);
  }
  function useGeo() { const [, s] = useState(0); useEffect(() => { const f = () => s((n) => n + 1); geoSubs.add(f); return () => geoSubs.delete(f); }, []); return geoJob; }

  function PinModal({ customer, onClose }) {
    const [pt, setPt] = useState(FS.hasGeo(customer) ? { lat: customer.lat, lng: customer.lng } : null);
    const points = pt ? [{ c: { ...customer, ...pt } }] : [];
    return html`<${Modal} title=${'Set pin: ' + customer.name} onClose=${onClose} footer=${html`<button onClick=${onClose}>Cancel</button><button class="primary" disabled=${!pt} onClick=${() => { Store.upsert('customers', { id: customer.id, lat: pt.lat, lng: pt.lng, geo: 'manual' }); onClose(); }}>Save pin</button>`}>
      <p class="small muted" style="margin-top:0">${[customer.address, customer.city, customer.province, customer.postal].filter(Boolean).join(', ') || 'No address'}. Zoom in and click the exact spot.</p>
      <${MapView} points=${points} height="380px" pickMode=${true} onMapClick=${(ll) => setPt({ lat: ll.lat, lng: ll.lng })} /><//>`;
  }

  function GeoCard({ autoStart }) {
    const db = useDB(), job = useGeo();
    const [pin, setPin] = useState(null);
    const missing = db.customers.filter((c) => !FS.hasGeo(c));
    const failed = missing.filter((c) => c.geo === 'failed' || !(c.address || c.city || c.postal));
    const approx = db.customers.filter((c) => c.geo === 'city' || c.geo === 'postal').length;
    useEffect(() => { if (autoStart && missing.length && !job.running) runGeocode(false); }, []);
    const etaMin = Math.ceil((job.total - job.done) * 1.6 / 60);
    return html`<div class="card"><h2>Map pins</h2>
      <div class="row" style="margin-bottom:10px"><span class="tag ok">${db.customers.length - missing.length} located</span>${approx > 0 && html`<span class="tag">${approx} approximate</span>`}<span class="tag warn">${missing.length} missing</span></div>
      ${job.running ? html`<div class="stack"><div class="progress"><div style=${'width:' + (job.total ? job.done / job.total * 100 : 0) + '%'}></div></div>
          <div class="small">${job.done}/${job.total} · ${job.found} found · ${job.failed} not found · ~${etaMin} min left<br/><span class="muted">Now: ${job.current}</span></div>
          <div class="small muted">Keep this tab open. It uses the free OpenStreetMap geocoder, limited to 1 lookup per second.</div>
          <button style="align-self:flex-start" onClick=${() => { geoJob.stop = true; }}>Stop</button></div>`
        : html`<div class="row"><button class="primary" disabled=${!missing.length} onClick=${() => runGeocode(false)}>📍 Locate all (${missing.length - failed.length})</button>${failed.length > 0 && html`<button onClick=${() => runGeocode(true)}>Retry not-found</button>`}</div>
          <div class="small muted" style="margin-top:8px">Tries street address first, then postal code, then city. Approximate pins still work for planning.</div>`}
      ${!job.running && failed.length > 0 && html`<div style="margin-top:12px"><h3>Couldn't locate (${failed.length}). Set these by hand:</h3><div class="scroll" style="max-height:220px">
        ${failed.map((c) => html`<div class="list-item"><div style="flex:1"><strong>${c.name}</strong><div class="small muted">${[c.address, c.city, c.postal].filter(Boolean).join(', ') || 'no address'}</div></div><button class="sm" onClick=${() => UI.editCustomer(c.id)}>Edit address</button><button class="sm" onClick=${() => setPin(c)}>Set on map</button></div>`)}</div></div>`}
      ${pin && html`<${PinModal} customer=${pin} onClose=${() => setPin(null)} />`}
    </div>`;
  }

  // ---------- Regions ----------
  function RegionsCard() {
    const db = useDB();
    const [name, setName] = useState(''), [prov, setProv] = useState('NS');
    const count = (id) => db.customers.filter((c) => c.regionId === id).length;
    const add = () => { if (!name.trim()) return; Store.upsert('regions', { name: name.trim(), province: prov, timezone: FS.TZ_BY_PROV[prov] || 'America/Halifax' }); setName(''); };
    return html`<div class="card"><h2>Regions (${db.regions.length})</h2>
      <div class="row" style="margin-bottom:10px"><input placeholder="New region name" value=${name} onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && add()} /><select value=${prov} onChange=${(e) => setProv(e.target.value)}>${FS.PROVINCES.map((p) => html`<option>${p}</option>`)}</select><button onClick=${add}>Add</button></div>
      <div class="scroll" style="max-height:300px">${db.regions.slice().sort((a, b) => a.name.localeCompare(b.name)).map((r) => html`<div class="list-item">
        <input style="flex:1" value=${r.name} onChange=${(e) => Store.upsert('regions', { id: r.id, name: e.target.value })} />
        <select value=${r.province} onChange=${(e) => Store.upsert('regions', { id: r.id, province: e.target.value, timezone: FS.TZ_BY_PROV[e.target.value] || r.timezone })}>${FS.PROVINCES.map((p) => html`<option>${p}</option>`)}</select>
        <a class="small num" href=${'#/accounts?region=' + r.id} style="width:70px">${count(r.id)} accts</a>
        <button class="sm danger" onClick=${() => confirm(`Delete region "${r.name}"? ${count(r.id)} accounts will become unassigned (not deleted).`) && Store.remove('regions', r.id)}>✕</button></div>`)}
      ${!db.regions.length && html`<div class="empty small">No regions yet. They're created automatically on import if your CSV has a region column.</div>`}</div></div>`;
  }

  // ---------- Settings ----------
  function SettingsCard() {
    const db = useDB(), s = db.settings;
    const [busy, setBusy] = useState(false);
    const set = (k, num) => (e) => Store.commit((d) => { d.settings[k] = num ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value; });
    const locate = async () => { setBusy(true); try { const r = await FS.geocodeText(s.homeLabel + ', Canada'); if (r) Store.commit((d) => { d.settings.homeLat = r.lat; d.settings.homeLng = r.lng; }); else alert('Not found'); } catch (e) { alert(e.message); } setBusy(false); };
    return html`<div class="card"><h2>Settings</h2><div class="form">
      <label class="f">Your name<input value=${s.ownerName} onChange=${set('ownerName')} /></label>
      <label class="f">Annual sales target (CAD)<input type="number" min="0" step="1000" value=${s.annualTarget || ''} onChange=${set('annualTarget', true)} /></label>
      <label class="f">Visit A accounts every (days)<input type="number" min="1" value=${s.intervalA} onChange=${set('intervalA', true)} /></label>
      <label class="f">Visit B accounts every (days)<input type="number" min="1" value=${s.intervalB} onChange=${set('intervalB', true)} /></label>
      <label class="f">Visit C accounts every (days)<input type="number" min="1" value=${s.intervalC} onChange=${set('intervalC', true)} /></label>
      <div></div>
      <label class="f full">Home base (default trip start)<div class="row"><input style="flex:1" value=${s.homeLabel} onChange=${set('homeLabel')} placeholder="e.g. Dartmouth, NS" /><button disabled=${busy || !s.homeLabel} onClick=${locate}>📍 Locate</button></div><span class="small">${Number.isFinite(s.homeLat) ? '✓ located' : 'not located'}</span></label>
    </div>
    <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">How the visit score works (0–100)</summary><div class="small" style="line-height:1.7;margin-top:6px">
      <strong>Priority</strong>: A = 40, B = 25, C = 10.<br/>
      <strong>Visit timing</strong> (up to 40): never visited = 40, otherwise 20 × days since last in-person visit ÷ target interval. 2× overdue maxes it out.<br/>
      <strong>Follow-up</strong>: overdue = 20, due within 7 days = 10.<br/>Inactive accounts are excluded from suggestions unless a trip includes them.</div></details></div>`;
  }

  // ---------- Backup ----------
  function BackupCard() {
    const db = useDB();
    const fileRef = useRef();
    const backup = () => {
      Store.commit((d) => { d.settings.lastBackup = new Date().toISOString(); });
      setTimeout(() => FS.download(`fscc-backup-${FS.today()}.json`, JSON.stringify(Store.db, null, 1), 'application/json'), 200);
    };
    const restore = (f) => {
      if (!f) return; const r = new FileReader();
      r.onload = () => { try { const j = JSON.parse(String(r.result)); if (!Array.isArray(j.customers)) throw new Error('Not a backup file'); if (confirm(`Replace ALL current data with this backup (${j.customers.length} accounts, ${(j.visits || []).length} activities)?`)) { Store.replaceAll(j); UI.toast('Backup restored'); } } catch (e) { alert('Restore failed: ' + e.message); } };
      r.readAsText(f);
    };
    const size = (() => { try { return Math.round(JSON.stringify(db).length / 1024); } catch (e) { return 0; } })();
    return html`<div class="card"><h2>Backup & restore</h2>
      <p class="small muted" style="margin-top:0">${G.Sync.signedIn
        ? `Your data (${size} KB) is synced to the cloud. A monthly downloaded backup in OneDrive is still a good extra safety net.`
        : `Your data is stored only in this browser on this device (${size} KB). Download a backup weekly and keep it in OneDrive. Restore it on another computer to move your data.`}</p>
      ${Store.saveError && html`<div class="badbox">Saving failed: ${Store.saveError}</div>`}
      <div class="row"><button class="primary" onClick=${backup}>⬇ Download backup</button><button onClick=${() => fileRef.current.click()}>Restore from file…</button><input ref=${fileRef} type="file" accept=".json" style="display:none" onChange=${(e) => restore(e.target.files[0])} /></div>
      <div class="small muted" style="margin-top:8px">Last backup: ${db.settings.lastBackup ? FS.fmtDate(db.settings.lastBackup.slice(0, 10)) : 'never'}</div>
      <details style="margin-top:14px"><summary class="small" style="cursor:pointer;color:var(--bad)">Danger zone</summary>
        <button class="danger" style="margin-top:8px" onClick=${() => { if (prompt(G.Sync.signedIn ? 'This erases your data here AND in the cloud (the daily cloud copy can bring it back). Type DELETE to continue' : 'Type DELETE to erase all data in this browser') === 'DELETE') { Store.replaceAll({}); UI.toast('All data erased'); } }}>Erase all data</button></details></div>`;
  }

  // ---------- Sample data (for trying the app) ----------
  function loadSample() {
    const now = new Date().toISOString(), t = FS.today();
    const regs = [['Halifax Metro', 'NS', 44.65, -63.58], ['Moncton', 'NB', 46.09, -64.78], ['Saint John', 'NB', 45.27, -66.06], ['Fredericton', 'NB', 45.96, -66.64], ['Charlottetown', 'PE', 46.24, -63.13], ['Quebec City', 'QC', 46.81, -71.21]];
    const names = ['Secure Point', 'Atlantic Integrated', 'Harbour Alarm', 'Maritime CCTV', 'Bluenose Systems', 'Coastal Access', 'North Shore Security', 'Fundy Tech', 'Island Surveillance', 'Capital Low Voltage', 'Brunswick Integrators', 'Seaside Networks'];
    const d = { regions: [], customers: [], visits: [], contacts: [], projects: [], trips: [], settings: { ...Store.db.settings, ownerName: Store.db.settings.ownerName || 'Demo' } };
    regs.forEach(([name, prov, lat, lng], ri) => {
      const rid = FS.uid(); d.regions.push({ id: rid, name, province: prov, timezone: FS.TZ_BY_PROV[prov], createdAt: now });
      for (let i = 0; i < 6; i++) {
        const p = i === 0 ? 'A' : i < 2 ? 'B' : 'C';
        const cid = FS.uid();
        const last = Math.random() < .25 ? null : FS.addDays(t, -Math.floor(Math.random() * 150));
        d.customers.push({ id: cid, createdAt: now, updatedAt: now, name: `${names[(ri * 6 + i) % names.length]} ${name.split(' ')[0]}${i > 2 ? ' ' + (i - 1) : ''}`, city: name.replace(' Metro', ''), province: prov, address: `${100 + i * 37} Main St`, regionId: rid,
          lat: lat + (Math.random() - .5) * .25, lng: lng + (Math.random() - .5) * .35, geo: 'exact', priority: p, partnerLevel: p === 'A' ? 'Executive' : 'Partner', status: last ? 'Active Customer' : 'Prospect',
          lastVisit: last, nextFollowUp: Math.random() < .3 ? FS.addDays(t, Math.floor(Math.random() * 20) - 8) : null, contactName: 'Sample Contact', contactPhone: '902-555-01' + String(ri * 6 + i).padStart(2, '0') });
        if (last) d.visits.push({ id: FS.uid(), customerId: cid, date: last, type: 'In-person', outcome: 'Reviewed current projects and new camera line.', createdAt: now });
        if (i < 2) d.projects.push({ id: FS.uid(), customerId: cid, name: `${name} ${i ? 'retail' : 'school'} retrofit`, product: 'IP cameras + NVR', amount: 15000 + Math.round(Math.random() * 90) * 1000, stage: FS.STAGES[Math.floor(Math.random() * 4)], closeDate: FS.addDays(t, Math.floor(Math.random() * 120) - 20), createdAt: now, updatedAt: now });
      }
    });
    Store.replaceAll(d); UI.toast('Sample data loaded');
  }

  function DataPage({ params }) {
    const db = useDB();
    const [imp, setImp] = useState(false);
    return html`<div class="head"><h1 class="grow">Data & settings</h1><button class="primary" onClick=${() => setImp(true)}>⬆ Import CSV</button></div>
      ${!db.customers.length && html`<div class="okbox" style="margin-bottom:14px">No accounts yet. Import your CSV, or <a style="cursor:pointer;text-decoration:underline" onClick=${loadSample}>load sample data</a> to try the app first (erase it later in Backup → Danger zone).</div>`}
      <div class="grid g2">
        <${G.Sync.CloudCard} />
        <${GeoCard} autoStart=${params.locate === '1'} />
        <${BackupCard} />
        <${SettingsCard} />
        <${RegionsCard} />
      </div>
      ${imp && html`<${ImportWizard} onClose=${() => setImp(false)} />`}`;
  }

  G.DataPage = DataPage;
})(window);
