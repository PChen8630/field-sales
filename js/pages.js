/* Pages: Today, Accounts, Pipeline, Activity */
(function (G) {
  'use strict';
  const { html, useState, useMemo, useCallback } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const { useDB, UI, MapView, PrioTag, StatusTag, GeoTag } = G.UIX;
  const go = (h) => { location.hash = h; };
  const STAGE_PROB = { Lead: 0.1, Quoted: 0.4, 'In Progress': 0.7, Won: 1, Lost: 0 };

  // ---------------- Today ----------------
  function Today() {
    const db = useDB(), s = db.settings, t = FS.today();
    const ranked = useMemo(() => FS.rankCustomers(db.customers, s), [db.customers, db.settings]);
    const active = db.customers.filter((c) => c.status !== 'Inactive');
    const overdueVisits = ranked.filter((r) => r.overdueVisit);
    const overdueA = overdueVisits.filter((r) => r.c.priority === 'A').length;
    const follow = db.customers.filter((c) => c.nextFollowUp && c.nextFollowUp <= FS.addDays(t, 7) && c.status !== 'Inactive').sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
    const followOverdue = follow.filter((c) => c.nextFollowUp < t).length;
    const monthStart = t.slice(0, 8) + '01', yearStart = t.slice(0, 5) + '01-01';
    const visitsMonth = db.visits.filter((v) => v.date >= monthStart && v.date <= t && v.type === 'In-person').length;
    const open = db.projects.filter((p) => !['Won', 'Lost'].includes(p.stage));
    const openAmt = open.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const weighted = open.reduce((a, p) => a + (Number(p.amount) || 0) * STAGE_PROB[p.stage], 0);
    const wonYTD = db.projects.filter((p) => p.stage === 'Won' && (p.closeDate || p.updatedAt || '').slice(0, 10) >= yearStart).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const yr = Number(t.slice(0, 4));
    const posThis = db.customers.reduce((a, c) => a + FS.posOf(c, yr), 0), posLast = db.customers.reduce((a, c) => a + FS.posOf(c, yr - 1), 0);
    const buyers = db.customers.filter((c) => FS.posOf(c, yr) > 0).length;
    const noPin = db.customers.filter((c) => !FS.hasGeo(c)).length;
    const noStatus = db.customers.filter((c) => !c.status).length;
    const noRegion = db.customers.filter((c) => !c.regionId).length;
    const future = db.customers.filter((c) => c.lastVisit && c.lastVisit > t).length;
    const weeks = [...Array(12)].map((_, i) => FS.addDays(FS.startOfWeek(t), -7 * (11 - i)));
    const perWeek = weeks.map((w) => db.visits.filter((v) => v.date >= w && v.date < FS.addDays(w, 7)).length);
    const maxW = Math.max(1, ...perWeek);
    const upcoming = db.trips.filter((tr) => tr.endDate >= t).sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 3);
    const backupAge = s.lastBackup ? FS.daysBetween(s.lastBackup.slice(0, 10), t) : null;

    if (!db.customers.length) return html`<div class="head"><h1>Welcome${s.ownerName ? ', ' + s.ownerName : ''}</h1></div>
      <div class="card" style="max-width:640px"><h2>Get started in 3 steps</h2><ol style="line-height:1.9;margin:0;padding-left:20px">
        <li>Export your customers from Base44 (or any CRM / spreadsheet) as a CSV file.</li>
        <li>Go to <a href="#/data">Data → Import CSV</a>. Columns are matched automatically and duplicates are flagged for review.</li>
        <li>Click <strong>Locate all</strong> on the Data page so every account gets a map pin. Then plan your first trip.</li></ol>
        <div class="row" style="margin-top:14px"><button class="primary" onClick=${() => go('#/data')}>Import customers</button><button onClick=${() => UI.editCustomer(null)}>Add one manually</button></div></div>`;

    return html`
      <div class="head"><div class="grow"><h1>Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}${s.ownerName ? ', ' + s.ownerName : ''}</h1><div class="muted">${FS.fmtDay(t)} · ${active.length} active accounts</div></div>
        <button class="primary talk-big" onClick=${() => G.Talk.open()}>🎙 Talk</button><button onClick=${() => UI.logVisit(null)}>+ Log activity</button><button class="primary" onClick=${() => go('#/trips/new')}>Plan a trip</button></div>
      <${G.Talk.QueueBanner} />
      ${(noPin || noStatus || future || backupAge === null || backupAge > 7) && html`<div class="card" style="margin-bottom:14px"><h3>Needs attention</h3><div class="stack">
        ${noPin > 0 && html`<div class="row"><span class="tag warn">${noPin}</span> accounts have no map pin, so they won't show on the map or be routed well.<span class="spacer"></span><button class="sm primary" onClick=${() => go('#/data?locate=1')}>Locate all</button></div>`}
        ${noStatus > 0 && html`<div class="row"><span class="tag bad">${noStatus}</span> accounts have no relationship status.<span class="spacer"></span><button class="sm" onClick=${() => go('#/accounts?status=__none')}>Review & bulk set</button></div>`}
        ${noRegion > 0 && html`<div class="row"><span class="tag">${noRegion}</span> accounts have no region.<span class="spacer"></span><button class="sm" onClick=${() => go('#/accounts?region=__none')}>Review</button></div>`}
        ${future > 0 && html`<div class="row"><span class="tag bad">${future}</span> accounts have a last-visit date in the future (data error).<span class="spacer"></span><button class="sm" onClick=${() => go('#/accounts?due=future')}>Fix</button></div>`}
        ${(backupAge === null || backupAge > 7) && html`<div class="row"><span class="tag warn">Backup</span> ${backupAge === null ? 'You have never backed up.' : `Last backup ${backupAge} days ago.`} Data lives only in this browser.<span class="spacer"></span><button class="sm" onClick=${() => go('#/data')}>Back up now</button></div>`}
      </div></div>`}
      <div class="grid kpis" style="margin-bottom:14px">
        <div class="card kpi click" onClick=${() => go('#/accounts?due=overdue')}><div class="label">Visits overdue</div><div class="value">${overdueVisits.length}</div><div class="sub">${overdueA} are A accounts</div></div>
        <div class="card kpi click" onClick=${() => go('#/accounts?due=follow')}><div class="label">Follow-ups ≤ 7 days</div><div class="value">${follow.length}</div><div class="sub">${followOverdue} overdue</div></div>
        <div class="card kpi click" onClick=${() => go('#/activity')}><div class="label">In-person visits · month</div><div class="value">${visitsMonth}</div><div class="sub">${db.visits.filter((v) => v.date >= monthStart).length} total activities</div></div>
        ${posThis + posLast > 0 && html`<div class="card kpi click" onClick=${() => go('#/accounts?sort=pos')}><div class="label">POS sales ${yr}</div><div class="value">${FS.money(posThis)}</div><div class="sub">${buyers} buying dealers · ${yr - 1}: ${FS.money(posLast)}</div></div>`}
        <div class="card kpi click" onClick=${() => go('#/pipeline')}><div class="label">Open pipeline</div><div class="value">${FS.money(openAmt)}</div><div class="sub">Weighted ${FS.money(weighted)}</div></div>
        <div class="card kpi click" onClick=${() => go('#/pipeline')}><div class="label">Won this year</div><div class="value">${FS.money(wonYTD)}</div>
          ${s.annualTarget ? html`<div class="meter" style="margin-top:6px"><div style=${'width:' + Math.min(100, wonYTD / s.annualTarget * 100) + '%'}></div></div><div class="sub">${Math.round(wonYTD / s.annualTarget * 100)}% of ${FS.money(s.annualTarget)}</div>` : html`<div class="sub"><a href="#/data">Set annual target</a></div>`}</div>
      </div>
      <div class="grid g2">
        <div class="card flush"><div style="padding:14px 16px 6px" class="row between"><h2 style="margin:0">Follow-ups due</h2><span class="muted small">overdue + next 7 days</span></div>
          ${follow.length ? follow.slice(0, 12).map((c) => html`<div class="list-item">
            <span class=${'tag ' + (c.nextFollowUp < t ? 'bad' : c.nextFollowUp === t ? 'warn' : '')} style="width:78px;text-align:center">${c.nextFollowUp < t ? FS.daysBetween(c.nextFollowUp, t) + 'd late' : c.nextFollowUp === t ? 'Today' : FS.fmtDay(c.nextFollowUp).replace(/,.*/, '')}</span>
            <a style="flex:1;cursor:pointer" onClick=${() => UI.openCustomer(c.id)}>${c.name}<div class="small muted">${c.city || ''}</div></a>
            <${PrioTag} p=${c.priority} /><button class="sm" onClick=${() => UI.logVisit(c.id)}>Log</button></div>`) : html`<div class="empty">Nothing due. Nice.</div>`}
        </div>
        <div class="card flush"><div style="padding:14px 16px 6px" class="row between"><h2 style="margin:0">Who to see next</h2><a class="small" href="#/accounts">All accounts →</a></div>
          ${ranked.slice(0, 10).map((r) => html`<div class="list-item">
            <span class="num" style="width:30px;font-weight:700">${r.score}</span>
            <a style="flex:1;cursor:pointer;min-width:0" onClick=${() => UI.openCustomer(r.c.id)}>${r.c.name}<div class="small muted">${r.c.city || ''} · ${r.reasons.slice(1).join(' · ') || 'on schedule'}</div></a>
            <${PrioTag} p=${r.c.priority} /></div>`)}
        </div>
        <div class="card"><h2>Activity · last 12 weeks</h2>
          <div class="bars">${perWeek.map((n, i) => html`<div class="b" title=${'Week of ' + FS.fmtDate(weeks[i]) + ': ' + n}><span class="bv">${n || ''}</span><div class="bar" style=${'height:' + (n / maxW * 85) + '%'}></div><span class="bl">${FS.parseISO(weeks[i]).toLocaleDateString('en-CA', { month: 'numeric', day: 'numeric' })}</span></div>`)}</div></div>
        <div class="card"><div class="row between"><h2 style="margin:0">Upcoming trips</h2><a class="small" href="#/trips">All trips →</a></div>
          ${upcoming.length ? upcoming.map((tr) => html`<div class="list-item" style="cursor:pointer;padding-left:0" onClick=${() => go('#/trips/' + tr.id)}><div style="flex:1"><strong>${tr.name}</strong><div class="small muted">${FS.fmtDate(tr.startDate)} → ${FS.fmtDate(tr.endDate)} · ${(tr.days || []).flat().length} stops</div></div><span class=${'tag ' + (tr.status === 'confirmed' ? 'ok' : '')}>${tr.status || 'draft'}</span></div>`)
            : html`<div class="empty">No upcoming trips.<br/><button style="margin-top:8px" onClick=${() => go('#/trips/new')}>Plan one</button></div>`}</div>
      </div>`;
  }

  // ---------------- Accounts ----------------
  function Accounts({ params }) {
    const db = useDB(), s = db.settings, t = FS.today();
    const [q, setQ] = useState(params.q || '');
    const [region, setRegion] = useState(params.region || '');
    const [prio, setPrio] = useState(params.prio || '');
    const [status, setStatus] = useState(params.status || '');
    const [due, setDue] = useState(params.due || '');
    const [sort, setSort] = useState(params.sort || 'score');
    const [dist, setDist] = useState('');
    const yr = Number(t.slice(0, 4));
    const [inView, setInView] = useState(false);
    const [bounds, setBounds] = useState(null);
    const [sel, setSel] = useState(new Set());
    const [hover, setHover] = useState(null);
    const onBounds = useCallback((b) => setBounds(b), []);

    const rows = useMemo(() => {
      const nq = FS.norm(q);
      let r = db.customers.map((c) => ({ c, ...FS.scoreCustomer(c, s) }));
      r = r.filter(({ c, overdueVisit }) => {
        if (nq && !(FS.norm(c.name).includes(nq) || FS.norm(c.city).includes(nq) || FS.norm(c.contactName).includes(nq) || FS.norm(c.postal).includes(nq))) return false;
        if (region === '__none' ? c.regionId : region && c.regionId !== region) return false;
        if (prio && (c.priority || 'C') !== prio) return false;
        if (status === '__none' ? c.status : status && c.status !== status) return false;
        if (due === 'overdue' && !(overdueVisit && c.status !== 'Inactive')) return false;
        if (due === 'follow' && !(c.nextFollowUp && c.nextFollowUp <= FS.addDays(t, 7))) return false;
        if (due === 'never' && c.lastVisit) return false;
        if (due === 'nopin' && FS.hasGeo(c)) return false;
        if (due === 'future' && !(c.lastVisit && c.lastVisit > t)) return false;
        if (inView && bounds && !(FS.hasGeo(c) && bounds.contains([c.lat, c.lng]))) return false;
        return true;
      });
      if (dist) r = r.filter(({ c }) => (c.distributor || '').toLowerCase().includes(dist.toLowerCase()));
      const posKey = (c) => FS.posOf(c, yr) * 1e6 + FS.posOf(c, yr - 1);
      const cmp = { score: (a, b) => b.score - a.score, name: (a, b) => a.c.name.localeCompare(b.c.name), last: (a, b) => (a.c.lastVisit || '').localeCompare(b.c.lastVisit || ''), city: (a, b) => (a.c.city || '').localeCompare(b.c.city || ''), pos: (a, b) => posKey(b.c) - posKey(a.c) }[sort];
      return r.sort(cmp);
    }, [db.customers, db.settings, q, region, prio, status, due, sort, inView, bounds, dist]);
    const distributors = useMemo(() => [...new Set(db.customers.flatMap((c) => String(c.distributor || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean)))].sort(), [db.customers]);
    const regionName = Object.fromEntries(db.regions.map((r) => [r.id, r.name]));
    const points = useMemo(() => rows.map((r) => ({ c: r.c, overdue: r.overdueVisit && r.c.status !== 'Inactive' })), [rows]);
    const toggle = (id) => setSel((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
    const allSel = rows.length && rows.every((r) => sel.has(r.c.id));
    const bulk = (field, value) => {
      if (!value) return;
      Store.commit((d) => d.customers.forEach((c) => { if (sel.has(c.id)) { c[field] = value === '__clear' ? null : value; c.updatedAt = new Date().toISOString(); } }));
      UI.toast(`Updated ${sel.size} accounts`);
    };
    const exportRows = () => {
      const list = rows.map((r) => r.c);
      FS.download(`accounts-${t}.csv`, FS.toCSV(['customer_name', 'address', 'city', 'province', 'postal_code', 'region', 'account_priority', 'partner_level', 'relationship_status', 'last_visit_date', 'next_follow_up_date', 'contact_name', 'contact_email', 'contact_phone', 'latitude', 'longitude', 'dealer_id', 'dealer_since', 'distributor', `pos_${yr - 1}`, `pos_${yr}`, 'score', 'notes'],
        list.map((c) => [c.name, c.address, c.city, c.province, c.postal, regionName[c.regionId] || '', c.priority, c.partnerLevel, c.status, c.lastVisit, c.nextFollowUp, c.contactName, c.contactEmail, c.contactPhone, c.lat, c.lng, c.dealerId, c.dealerSince, c.distributor, FS.posOf(c, yr - 1) || '', FS.posOf(c, yr) || '', FS.scoreCustomer(c, s).score, c.notes])));
    };
    return html`
      <div class="head"><h1 class="grow">Accounts <span class="muted" style="font-weight:400;font-size:15px">${rows.length} of ${db.customers.length}</span></h1>
        <button onClick=${exportRows}>Export CSV</button><button class="primary" onClick=${() => UI.editCustomer(null)}>+ New account</button></div>
      <div class="filters">
        <input type="search" placeholder="Search name, city, contact, postal…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <select value=${region} onChange=${(e) => setRegion(e.target.value)}><option value="">All regions</option><option value="__none">(no region)</option>${db.regions.map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select>
        <select value=${prio} onChange=${(e) => setPrio(e.target.value)}><option value="">All priorities</option>${FS.PRIORITIES.map((p) => html`<option value=${p}>Priority ${p}</option>`)}</select>
        <select value=${status} onChange=${(e) => setStatus(e.target.value)}><option value="">All statuses</option><option value="__none">(no status)</option>${FS.STATUSES.map((p) => html`<option>${p}</option>`)}</select>
        <select value=${due} onChange=${(e) => setDue(e.target.value)}><option value="">Any timing</option><option value="overdue">Visit overdue</option><option value="follow">Follow-up ≤ 7 days</option><option value="never">Never visited</option><option value="nopin">No map pin</option><option value="future">Visit date in future</option></select>
        ${distributors.length > 0 && html`<select value=${dist} onChange=${(e) => setDist(e.target.value)}><option value="">All distributors</option>${distributors.map((x) => html`<option>${x}</option>`)}</select>`}
        <label class="chk small"><input type="checkbox" checked=${inView} onChange=${(e) => setInView(e.target.checked)} /> Only in map view</label>
        ${(q || region || prio || status || due || inView || dist) && html`<button class="sm ghost" onClick=${() => { setQ(''); setRegion(''); setPrio(''); setStatus(''); setDue(''); setInView(false); setDist(''); }}>Clear</button>`}
      </div>
      ${sel.size > 0 && html`<div class="bulk row"><strong>${sel.size} selected</strong>
        <select onChange=${(e) => { bulk('status', e.target.value); e.target.value = ''; }}><option value="">Set status…</option>${FS.STATUSES.map((p) => html`<option>${p}</option>`)}</select>
        <select onChange=${(e) => { bulk('priority', e.target.value); e.target.value = ''; }}><option value="">Set priority…</option>${FS.PRIORITIES.map((p) => html`<option>${p}</option>`)}</select>
        <select onChange=${(e) => { bulk('regionId', e.target.value); e.target.value = ''; }}><option value="">Set region…</option>${db.regions.map((r) => html`<option value=${r.id}>${r.name}</option>`)}<option value="__clear">(clear)</option></select>
        ${due === 'future' && html`<button class="sm" onClick=${() => { Store.commit((d) => d.customers.forEach((c) => { if (sel.has(c.id) && c.lastVisit > t) c.lastVisit = null; })); UI.toast('Cleared future dates'); }}>Clear future visit dates</button>`}
        <button class="sm" onClick=${() => { sessionStorage.setItem('fscc.cart', JSON.stringify([...sel])); go('#/trips/new'); }}>Plan trip with these</button>
        <span class="spacer"></span><button class="sm ghost" onClick=${() => setSel(new Set())}>Clear selection</button></div>`}
      <div class="acct">
        <${MapView} points=${points} selected=${hover} onPick=${(id) => UI.openCustomer(id)} onBounds=${onBounds} />
        <div class="card flush tablewrap"><table>
          <thead><tr><th style="width:28px"><input type="checkbox" checked=${allSel} onChange=${() => setSel(allSel ? new Set() : new Set(rows.map((r) => r.c.id)))} /></th>
            <th style="cursor:pointer" onClick=${() => setSort('name')}>Account ${sort === 'name' ? '↓' : ''}</th><th class="hide-m" style="cursor:pointer" onClick=${() => setSort('city')}>City ${sort === 'city' ? '↓' : ''}</th><th>Pri</th><th class="hide-m">Status</th>
            <th class="hide-m" style="cursor:pointer;text-align:right" onClick=${() => setSort('pos')} title=${'POS sales ' + yr + ' (' + (yr - 1) + ' below)'}>POS ${yr} ${sort === 'pos' ? '↓' : ''}</th>
            <th style="cursor:pointer" onClick=${() => setSort('last')}>Last visit ${sort === 'last' ? '↓' : ''}</th><th style="cursor:pointer" onClick=${() => setSort('score')} title="Visit priority score (0-100)">Score ${sort === 'score' ? '↓' : ''}</th></tr></thead>
          <tbody>${rows.slice(0, 400).map(({ c, score, since, overdueVisit }) => html`<tr class=${'click' + (sel.has(c.id) ? ' sel' : '')} onMouseEnter=${() => setHover(c.id)} onClick=${() => UI.openCustomer(c.id)}>
            <td onClick=${(e) => e.stopPropagation()}><input type="checkbox" checked=${sel.has(c.id)} onChange=${() => toggle(c.id)} /></td>
            <td><strong>${c.name}</strong> <${GeoTag} c=${c} />${c.nextFollowUp && c.nextFollowUp < t ? html` <span class="tag bad">follow-up late</span>` : ''}<div class="small muted">${regionName[c.regionId] || ''}${c.partnerLevel ? ' · ' + c.partnerLevel : ''}</div></td>
            <td class="hide-m">${c.city}</td><td><${PrioTag} p=${c.priority} /></td><td class="hide-m"><${StatusTag} s=${c.status} /></td>
            <td class="hide-m num small" style="text-align:right">${FS.posOf(c, yr) ? FS.money(FS.posOf(c, yr)) : html`<span class="muted">—</span>`}${FS.posOf(c, yr - 1) ? html`<div class="muted">${FS.money(FS.posOf(c, yr - 1))}</div>` : ''}</td>
            <td class="small">${c.lastVisit ? html`<span class=${overdueVisit ? '' : 'muted'} style=${overdueVisit ? 'color:var(--bad);font-weight:600' : ''}>${since}d ago</span>` : html`<span class="muted">never</span>`}</td>
            <td class="num"><strong>${score}</strong></td></tr>`)}</tbody></table>
          ${rows.length > 400 && html`<div class="empty small">Showing first 400. Narrow the filters to see the rest.</div>`}
          ${!rows.length && html`<div class="empty">No accounts match.</div>`}
        </div>
      </div>`;
  }

  // ---------------- Pipeline ----------------
  function Pipeline() {
    const db = useDB(), t = FS.today();
    const [region, setRegion] = useState('');
    const [dragId, setDragId] = useState(null);
    const [over, setOver] = useState(null);
    const [showClosed, setShowClosed] = useState(true);
    const byId = Object.fromEntries(db.customers.map((c) => [c.id, c]));
    const list = db.projects.filter((p) => !region || (byId[p.customerId] && byId[p.customerId].regionId === region));
    const stages = showClosed ? FS.STAGES : FS.STAGES.filter((s) => !['Won', 'Lost'].includes(s));
    const open = list.filter((p) => !['Won', 'Lost'].includes(p.stage));
    const sum = (a) => a.reduce((x, p) => x + (Number(p.amount) || 0), 0);
    const weighted = open.reduce((x, p) => x + (Number(p.amount) || 0) * STAGE_PROB[p.stage], 0);
    const in90 = open.filter((p) => p.closeDate && p.closeDate <= FS.addDays(t, 90));
    const won = list.filter((p) => p.stage === 'Won'), lost = list.filter((p) => p.stage === 'Lost');
    const drop = (stage) => { if (dragId) { const p = db.projects.find((x) => x.id === dragId); if (p && p.stage !== stage) { Store.upsert('projects', { id: p.id, stage, closeDate: (stage === 'Won' || stage === 'Lost') && !p.closeDate ? t : p.closeDate }); UI.toast(`Moved to ${stage}`); } } setDragId(null); setOver(null); };
    return html`
      <div class="head"><h1 class="grow">Pipeline</h1>
        <select value=${region} onChange=${(e) => setRegion(e.target.value)}><option value="">All regions</option>${db.regions.map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select>
        <label class="chk small"><input type="checkbox" checked=${showClosed} onChange=${(e) => setShowClosed(e.target.checked)} /> Show won/lost</label>
        <button onClick=${() => FS.download(`pipeline-${t}.csv`, FS.toCSV(['account', 'opportunity', 'product', 'stage', 'amount', 'close_date', 'notes'], list.map((p) => [byId[p.customerId] ? byId[p.customerId].name : '', p.name, p.product, p.stage, p.amount, p.closeDate, p.notes])))}>Export</button>
        <button class="primary" onClick=${() => UI.editProject({})}>+ Opportunity</button></div>
      <div class="grid kpis" style="margin-bottom:14px">
        <div class="card kpi"><div class="label">Open pipeline</div><div class="value">${FS.money(sum(open))}</div><div class="sub">${open.length} deals</div></div>
        <div class="card kpi"><div class="label">Weighted forecast</div><div class="value">${FS.money(weighted)}</div><div class="sub">Lead 10% · Quoted 40% · In progress 70%</div></div>
        <div class="card kpi"><div class="label">Closing ≤ 90 days</div><div class="value">${FS.money(sum(in90))}</div><div class="sub">${in90.length} deals</div></div>
        <div class="card kpi"><div class="label">Win rate</div><div class="value">${won.length + lost.length ? Math.round(won.length / (won.length + lost.length) * 100) + '%' : '—'}</div><div class="sub">${won.length} won · ${lost.length} lost</div></div>
      </div>
      ${!db.projects.length && html`<div class="okbox" style="margin-bottom:14px">Track quotes and projects here. Add one with <strong>+ Opportunity</strong>, or from any account's detail panel. Drag cards between columns to change stage.</div>`}
      <div class="kanban" style=${'grid-template-columns:repeat(' + stages.length + ',minmax(210px,1fr))'}>${stages.map((st) => {
        const items = list.filter((p) => p.stage === st).sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
        return html`<div class=${'col' + (over === st ? ' drop' : '')} onDragOver=${(e) => { e.preventDefault(); setOver(st); }} onDragLeave=${() => setOver(null)} onDrop=${() => drop(st)}>
          <div class="chead"><span>${st} <span class="muted">(${items.length})</span></span><span class="num">${FS.money(sum(items))}</span></div>
          ${items.map((p) => { const c = byId[p.customerId]; const late = p.closeDate && p.closeDate < t && !['Won', 'Lost'].includes(p.stage);
            return html`<div class="deal" draggable="true" onDragStart=${() => setDragId(p.id)} onClick=${() => UI.editProject(p)}>
              <div style="font-weight:600">${p.name}</div>
              <div class="small muted"><a onClick=${(e) => { e.stopPropagation(); c && UI.openCustomer(c.id); }} style="cursor:pointer">${c ? c.name : '(deleted account)'}</a></div>
              <div class="row between" style="margin-top:6px"><span class="amt">${FS.money(p.amount)}</span>${p.closeDate && html`<span class=${'small ' + (late ? '' : 'muted')} style=${late ? 'color:var(--bad)' : ''}>${late ? 'late · ' : ''}${FS.fmtDate(p.closeDate)}</span>`}</div>
            </div>`; })}
        </div>`; })}</div>`;
  }

  // ---------------- Activity + weekly report ----------------
  function Activity() {
    const db = useDB(), t = FS.today();
    const [range, setRange] = useState('thisweek');
    const [from, setFrom] = useState(FS.startOfWeek(t));
    const [to, setTo] = useState(t);
    const [type, setType] = useState('');
    const [report, setReport] = useState(null);
    const setPreset = (r) => {
      setRange(r);
      const sw = FS.startOfWeek(t);
      if (r === 'thisweek') { setFrom(sw); setTo(FS.addDays(sw, 6)); }
      if (r === 'lastweek') { setFrom(FS.addDays(sw, -7)); setTo(FS.addDays(sw, -1)); }
      if (r === 'month') { setFrom(t.slice(0, 8) + '01'); setTo(t); }
      if (r === 'quarter') { const m = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1; setFrom(`${t.slice(0, 4)}-${FS.pad(m)}-01`); setTo(t); }
      if (r === 'all') { setFrom('2000-01-01'); setTo('2999-12-31'); }
    };
    const byId = Object.fromEntries(db.customers.map((c) => [c.id, c]));
    const list = db.visits.filter((v) => v.date >= from && v.date <= to && (!type || v.type === type)).sort((a, b) => b.date.localeCompare(a.date));
    const counts = FS.VISIT_TYPES.map((ty) => [ty, list.filter((v) => v.type === ty).length]);

    const buildReport = () => {
      const s = db.settings;
      const vis = db.visits.filter((v) => v.date >= from && v.date <= to).sort((a, b) => a.date.localeCompare(b.date));
      const newOpps = db.projects.filter((p) => (p.createdAt || '').slice(0, 10) >= from && (p.createdAt || '').slice(0, 10) <= to);
      const wonP = db.projects.filter((p) => p.stage === 'Won' && (p.closeDate || '') >= from && (p.closeDate || '') <= to);
      const open = db.projects.filter((p) => !['Won', 'Lost'].includes(p.stage));
      const nextFrom = FS.addDays(to, 1), nextTo = FS.addDays(to, 7);
      const nextF = db.customers.filter((c) => c.nextFollowUp && c.nextFollowUp >= nextFrom && c.nextFollowUp <= nextTo).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
      const trips = db.trips.filter((tr) => tr.startDate <= nextTo && tr.endDate >= nextFrom);
      const L = [];
      L.push(`ACTIVITY REPORT — ${s.ownerName || 'RSM'}, Canada East`);
      L.push(`Period: ${FS.fmtDate(from)} – ${FS.fmtDate(to)}`, '');
      L.push(`SUMMARY`);
      L.push(`• ${vis.length} activities (${FS.VISIT_TYPES.map((ty) => `${vis.filter((v) => v.type === ty).length} ${ty.toLowerCase()}`).join(', ')})`);
      L.push(`• ${new Set(vis.map((v) => v.customerId)).size} unique accounts touched`);
      L.push(`• ${newOpps.length} new opportunities (${FS.money(newOpps.reduce((a, p) => a + (Number(p.amount) || 0), 0))})`);
      L.push(`• ${wonP.length} won (${FS.money(wonP.reduce((a, p) => a + (Number(p.amount) || 0), 0))})`);
      L.push(`• Open pipeline: ${FS.money(open.reduce((a, p) => a + (Number(p.amount) || 0), 0))} across ${open.length} deals`, '');
      if (vis.length) { L.push('VISITS & CALLS'); vis.forEach((v) => { const c = byId[v.customerId]; L.push(`• ${v.date} [${v.type}] ${c ? c.name : v.customerName}${c && c.city ? ' (' + c.city + ')' : ''}`); if (v.outcome) L.push(`    ${v.outcome.replace(/\n/g, ' ')}`); if (v.nextAction) L.push(`    Next: ${v.nextAction}`); }); L.push(''); }
      if (newOpps.length || wonP.length) { L.push('OPPORTUNITIES'); newOpps.forEach((p) => L.push(`• NEW: ${byId[p.customerId] ? byId[p.customerId].name : ''} — ${p.name} — ${FS.money(p.amount)} (${p.stage})`)); wonP.forEach((p) => L.push(`• WON: ${byId[p.customerId] ? byId[p.customerId].name : ''} — ${p.name} — ${FS.money(p.amount)}`)); L.push(''); }
      L.push('NEXT WEEK');
      trips.forEach((tr) => L.push(`• Trip: ${tr.name} (${FS.fmtDate(tr.startDate)} – ${FS.fmtDate(tr.endDate)}), ${(tr.days || []).flat().length} visits planned`));
      nextF.forEach((c) => L.push(`• Follow up: ${c.name} (${FS.fmtDate(c.nextFollowUp)})`));
      if (!trips.length && !nextF.length) L.push('• (nothing scheduled yet)');
      setReport(L.join('\n'));
    };
    return html`
      <div class="head"><h1 class="grow">Activity</h1><button onClick=${buildReport}>📝 Weekly report</button><button class="primary" onClick=${() => UI.logVisit(null)}>+ Log activity</button></div>
      <div class="filters">
        ${[['thisweek', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['quarter', 'This quarter'], ['all', 'All time']].map(([k, l]) => html`<button class=${'sm ' + (range === k ? 'primary' : '')} onClick=${() => setPreset(k)}>${l}</button>`)}
        <input type="date" value=${from} onInput=${(e) => { setFrom(e.target.value); setRange(''); }} /> → <input type="date" value=${to} onInput=${(e) => { setTo(e.target.value); setRange(''); }} />
        <select value=${type} onChange=${(e) => setType(e.target.value)}><option value="">All types</option>${FS.VISIT_TYPES.map((x) => html`<option>${x}</option>`)}</select>
      </div>
      <div class="grid kpis" style="margin-bottom:14px">${counts.map(([ty, n]) => html`<div class="card kpi"><div class="label">${ty}</div><div class="value">${n}</div></div>`)}<div class="card kpi"><div class="label">Accounts touched</div><div class="value">${new Set(list.map((v) => v.customerId)).size}</div></div></div>
      <div class="card flush scroll"><table><thead><tr><th>Date</th><th>Account</th><th>Type</th><th>Outcome</th><th class="hide-m">Next</th></tr></thead>
        <tbody>${list.map((v) => { const c = byId[v.customerId]; return html`<tr class="click" onClick=${() => UI.modal({ kind: 'visit', customerId: v.customerId, visit: v })}>
          <td class="num" style="white-space:nowrap">${v.date}</td><td><a onClick=${(e) => { e.stopPropagation(); c && UI.openCustomer(c.id); }}>${c ? c.name : v.customerName}</a><div class="small muted">${c ? c.city || '' : ''}</div></td>
          <td><span class="tag">${v.type}</span></td><td style="max-width:420px;white-space:pre-wrap">${v.outcome}</td><td class="hide-m small">${v.nextAction}${v.nextFollowUp ? html`<div class="muted">${FS.fmtDate(v.nextFollowUp)}</div>` : ''}</td></tr>`; })}</tbody></table>
        ${!list.length && html`<div class="empty">No activity in this period.<br/>Tip: log right after each visit from your phone. It takes 20 seconds.</div>`}</div>
      ${report && html`<${G.UIX.Modal} title="Activity report" wide onClose=${() => setReport(null)} footer=${html`<button onClick=${() => FS.download(`report-${from}.txt`, report, 'text/plain')}>Download .txt</button><button class="primary" onClick=${() => { navigator.clipboard.writeText(report).then(() => UI.toast('Copied. Paste into your email.')); }}>Copy to clipboard</button>`}>
        <p class="muted small" style="margin-top:0">Ready to paste into an email to your manager. Covers the selected period (${FS.fmtDate(from)} – ${FS.fmtDate(to)}).</p><pre class="report">${report}</pre><//>`}`;
  }

  G.Pages = { Today, Accounts, Pipeline, Activity, go };
})(window);
