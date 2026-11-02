/* Shared UI: hooks, modal/drawer, map, forms, account drawer, quick visit log. */
(function (G) {
  'use strict';
  const { html, useState, useEffect, useRef, useMemo } = htmPreact;
  const FS = G.FS, Store = FS.Store;

  // Re-render on any data change.
  function useDB() {
    const [, set] = useState(0);
    useEffect(() => Store.subscribe(() => set((n) => n + 1)), []);
    return Store.db;
  }

  // App-level UI state (drawer, modals, toast)
  const uiSubs = new Set();
  const UI = {
    state: { customerId: null, modal: null, toast: null },
    set(p) { UI.state = { ...UI.state, ...p }; uiSubs.forEach((f) => f()); },
    openCustomer(id) { UI.set({ customerId: id }); },
    closeCustomer() { UI.set({ customerId: null }); },
    modal(m) { UI.set({ modal: m }); },
    close() { UI.set({ modal: null }); },
    toast(msg) { UI.set({ toast: msg }); clearTimeout(UI._t); UI._t = setTimeout(() => UI.set({ toast: null }), 2600); },
    logVisit(customerId, extra) { UI.modal({ kind: 'visit', customerId, ...extra }); },
    editCustomer(id) { UI.modal({ kind: 'customer', id }); },
    editProject(p) { UI.modal({ kind: 'project', project: p }); },
    editContact(c) { UI.modal({ kind: 'contact', contact: c }); },
  };
  function useUI() { const [, set] = useState(0); useEffect(() => { const f = () => set((n) => n + 1); uiSubs.add(f); return () => uiSubs.delete(f); }, []); return UI.state; }

  function Modal({ title, wide, onClose, children, footer }) {
    useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
    return html`<div class="overlay center" onMouseDown=${(e) => e.target === e.currentTarget && onClose()}>
      <div class=${'modal' + (wide ? ' wide' : '')} role="dialog">
        <div class="mhead"><h2 style="margin:0;flex:1">${title}</h2><button class="ghost" onClick=${onClose} aria-label="Close">✕</button></div>
        <div class="mbody">${children}</div>
        ${footer && html`<div class="mfoot">${footer}</div>`}
      </div></div>`;
  }

  const PrioTag = ({ p }) => html`<span class=${'tag ' + (p || 'C')}>${p || 'C'}</span>`;
  const statusCls = { 'Active Customer': 'ok', 'Follow-up Needed': 'warn', 'Meeting Scheduled': 'blue', Inactive: '', Prospect: '' };
  const StatusTag = ({ s }) => s ? html`<span class=${'tag ' + (statusCls[s] || '')}>${s}</span>` : html`<span class="tag bad">No status</span>`;
  const GeoTag = ({ c }) => !FS.hasGeo(c) ? html`<span class="tag warn" title="No map location">No pin</span>` : (c.geo === 'city' || c.geo === 'postal') ? html`<span class="tag" title="Approximate location">≈ ${c.geo}</span>` : null;

  // ---------- Leaflet map ----------
  const PRIO_COLOR = { A: '#c2410c', B: '#d97706', C: '#64748b' };
  function MapView({ points, onPick, selected, height, onBounds, route, pickMode, onMapClick }) {
    const el = useRef(), map = useRef(), layer = useRef(), routeLayer = useRef(), fitted = useRef(false);
    useEffect(() => {
      map.current = L.map(el.current, { zoomControl: true }).setView([46.5, -66], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      routeLayer.current = L.layerGroup().addTo(map.current);
      const ro = new ResizeObserver(() => map.current.invalidateSize()); ro.observe(el.current);
      return () => { ro.disconnect(); map.current.remove(); };
    }, []);
    useEffect(() => {
      if (!onBounds) return;
      const f = () => onBounds(map.current.getBounds());
      map.current.on('moveend', f); return () => map.current.off('moveend', f);
    }, [onBounds]);
    useEffect(() => {
      const f = (e) => onMapClick && onMapClick(e.latlng);
      map.current.on('click', f); el.current.style.cursor = pickMode ? 'crosshair' : '';
      return () => map.current.off('click', f);
    }, [onMapClick, pickMode]);
    useEffect(() => {
      layer.current.clearLayers();
      const geo = points.filter((p) => FS.hasGeo(p.c));
      geo.forEach((p) => {
        const sel = selected && selected === p.c.id;
        const m = L.circleMarker([p.c.lat, p.c.lng], { radius: sel ? 10 : p.label ? 9 : 7, color: sel ? '#1d4ed8' : p.overdue ? '#b91c1c' : '#fff', weight: sel || p.overdue ? 3 : 1.5, fillColor: p.color || PRIO_COLOR[p.c.priority || 'C'], fillOpacity: .9 });
        m.bindTooltip((p.label ? p.label + '. ' : '') + p.c.name + (p.c.city ? ' — ' + p.c.city : ''));
        if (onPick) m.on('click', () => onPick(p.c.id));
        m.addTo(layer.current);
        if (p.label) L.marker([p.c.lat, p.c.lng], { icon: L.divIcon({ className: '', html: `<div style="color:#fff;font-weight:700;font-size:10px;text-align:center;width:18px;line-height:18px;margin:-9px 0 0 -9px;pointer-events:none">${p.label}</div>` }), interactive: false }).addTo(layer.current);
      });
      if (!fitted.current && geo.length) { map.current.fitBounds(L.latLngBounds(geo.map((p) => [p.c.lat, p.c.lng])).pad(0.1)); fitted.current = true; }
    }, [points, selected]);
    useEffect(() => {
      routeLayer.current.clearLayers();
      (route || []).forEach((r) => { if (r.pts.length > 1) L.polyline(r.pts, { color: r.color, weight: 3, opacity: .8, dashArray: '6 6' }).addTo(routeLayer.current); });
      if (route && route.length) { const all = route.flatMap((r) => r.pts); if (all.length) map.current.fitBounds(L.latLngBounds(all).pad(0.15)); }
    }, [route]);
    useEffect(() => { if (selected) { const p = points.find((x) => x.c.id === selected); if (p && FS.hasGeo(p.c)) map.current.panTo([p.c.lat, p.c.lng]); } }, [selected]);
    return html`<div ref=${el} class="map" style=${height ? 'height:' + height : ''}></div>`;
  }

  // ---------- Forms ----------
  function useForm(init) { const [v, setV] = useState(init); const bind = (k, type) => ({ value: v[k] ?? '', onInput: (e) => setV((o) => ({ ...o, [k]: type === 'num' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })) }); return [v, setV, bind]; }

  function CustomerForm({ id, onClose }) {
    const db = useDB();
    const existing = db.customers.find((c) => c.id === id);
    const [v, setV, bind] = useForm(existing ? { ...existing } : { name: '', priority: 'C', status: 'Prospect', country: 'Canada', province: 'NS' });
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const save = () => {
      if (!String(v.name || '').trim()) return setErr('Company name is required.');
      if (v.contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.contactEmail)) return setErr('Email looks invalid.');
      const addrChanged = existing && (existing.address !== v.address || existing.city !== v.city || existing.postal !== v.postal);
      const rec = { ...v, name: v.name.trim() };
      if (addrChanged && existing.geo !== 'manual') { rec.lat = null; rec.lng = null; rec.geo = null; }
      Store.upsert('customers', rec); UI.toast(existing ? 'Account saved' : 'Account added'); onClose();
    };
    const locate = async () => {
      setBusy(true); setErr('');
      try { const r = await FS.geocodeCustomer(v); if (r) { setV((o) => ({ ...o, lat: r.lat, lng: r.lng, geo: r.geo })); UI.toast('Located (' + r.geo + ')'); } else setErr('Could not find that address. Check spelling or set the pin from the map.'); }
      catch (e) { setErr('Locate failed: ' + e.message); }
      setBusy(false);
    };
    return html`<${Modal} title=${existing ? 'Edit account' : 'New account'} onClose=${onClose}
      footer=${html`${existing && html`<button class="danger" onClick=${() => { if (confirm('Delete ' + existing.name + ' and all its visits, contacts and opportunities?')) { Store.remove('customers', existing.id); UI.closeCustomer(); onClose(); } }}>Delete</button>`}<span class="spacer"></span><button onClick=${onClose}>Cancel</button><button class="primary" onClick=${save}>Save</button>`}>
      ${err && html`<div class="badbox" style="margin-bottom:12px">${err}</div>`}
      <div class="form">
        <label class="f full">Company name *<input ...${bind('name')} autofocus /></label>
        <label class="f full">Street address<input ...${bind('address')} /></label>
        <label class="f">City<input ...${bind('city')} /></label>
        <label class="f">Province<select ...${bind('province')}><option value=""></option>${FS.PROVINCES.map((p) => html`<option>${p}</option>`)}</select></label>
        <label class="f">Postal code<input ...${bind('postal')} /></label>
        <label class="f">Region<select ...${bind('regionId')}><option value="">— None —</option>${db.regions.map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select></label>
        <label class="f">Priority<select ...${bind('priority')}>${FS.PRIORITIES.map((p) => html`<option>${p}</option>`)}</select></label>
        <label class="f">Relationship status<select ...${bind('status')}>${FS.STATUSES.map((p) => html`<option>${p}</option>`)}</select></label>
        <label class="f">Partner level<input ...${bind('partnerLevel')} list="levels" /><datalist id="levels"><option>Partner</option><option>Executive</option><option>Ambassador</option><option>Elite</option></datalist></label>
        <label class="f">Visit every (days) — blank = use priority default<input type="number" min="1" ...${bind('intervalDays', 'num')} /></label>
        <label class="f">Primary contact<input ...${bind('contactName')} /></label>
        <label class="f">Contact email<input type="email" ...${bind('contactEmail')} /></label>
        <label class="f">Contact phone<input ...${bind('contactPhone')} /></label>
        <label class="f">Distributor(s)<input ...${bind('distributor')} /></label>
        <label class="f">Dealer registration #<input ...${bind('dealerId')} /></label>
        <label class="f">Next follow-up<input type="date" ...${bind('nextFollowUp')} /></label>
        <label class="f">Last in-person visit<input type="date" ...${bind('lastVisit')} /></label>
        <label class="f full">Notes<textarea ...${bind('notes')}></textarea></label>
        <div class="full row"><span class="small muted">Map location: ${FS.hasGeo(v) ? `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)} (${v.geo || 'set'})` : 'not set'}</span><span class="spacer"></span><button class="sm" disabled=${busy} onClick=${locate}>${busy ? 'Locating…' : '📍 Locate from address'}</button></div>
      </div><//>`;
  }

  function VisitForm({ customerId, visit, onClose }) {
    const db = useDB();
    const [cid, setCid] = useState(customerId || (visit && visit.customerId) || '');
    const c = db.customers.find((x) => x.id === cid);
    const [v, setV, bind] = useForm(visit ? { ...visit } : { date: FS.today(), type: 'In-person', outcome: '', nextAction: '', nextFollowUp: '' });
    const [setStatus, setSetStatus] = useState('');
    const [q, setQ] = useState('');
    const quick = (d) => setV((o) => ({ ...o, nextFollowUp: FS.addDays(FS.today(), d) }));
    const save = () => {
      if (!cid) return alert('Pick an account.');
      Store.logVisit({ ...v, customerId: cid, customerName: c ? c.name : '', setStatus: setStatus || undefined });
      UI.toast('Visit logged for ' + (c ? c.name : 'account')); onClose();
    };
    const matches = q.length > 1 ? db.customers.filter((x) => FS.norm(x.name).includes(FS.norm(q)) || FS.norm(x.city).includes(FS.norm(q))).slice(0, 8) : [];
    return html`<${Modal} title=${visit ? 'Edit activity' : 'Log activity'} onClose=${onClose}
      footer=${html`${visit && html`<button class="danger" onClick=${() => { if (confirm('Delete this activity?')) { Store.remove('visits', visit.id); onClose(); } }}>Delete</button>`}<span class="spacer"></span><button onClick=${onClose}>Cancel</button><button class="primary" onClick=${save}>Save</button>`}>
      <div class="form">
        <div class="full">${c ? html`<div class="row"><strong>${c.name}</strong><span class="muted">${c.city || ''}</span><${PrioTag} p=${c.priority} />${!customerId && html`<button class="sm ghost" onClick=${() => setCid('')}>change</button>`}</div>`
          : html`<label class="f">Account<input type="search" placeholder="Type a company or city…" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus /></label>
            ${matches.map((m) => html`<div class="list-item click" style="cursor:pointer" onClick=${() => setCid(m.id)}><strong>${m.name}</strong><span class="muted">${m.city}</span></div>`)}`}</div>
        <label class="f">Date<input type="date" ...${bind('date')} /></label>
        <label class="f">Type<select ...${bind('type')}>${FS.VISIT_TYPES.map((t) => html`<option>${t}</option>`)}</select></label>
        <label class="f full">What happened?<textarea ...${bind('outcome')} placeholder="Met with… discussed… products shown…"></textarea></label>
        <label class="f full">Next action<input ...${bind('nextAction')} placeholder="Send quote for 16-cam NVR, book demo…" /></label>
        <label class="f">Next follow-up<input type="date" ...${bind('nextFollowUp')} /></label>
        <div class="row" style="align-self:end"><button class="sm" onClick=${() => quick(7)}>+1 wk</button><button class="sm" onClick=${() => quick(14)}>+2 wk</button><button class="sm" onClick=${() => quick(30)}>+1 mo</button><button class="sm" onClick=${() => quick(90)}>+3 mo</button></div>
        <label class="f full">Update relationship status (optional)<select value=${setStatus} onChange=${(e) => setSetStatus(e.target.value)}><option value="">— Keep ${c && c.status ? c.status : 'as is'} —</option>${FS.STATUSES.map((s) => html`<option>${s}</option>`)}</select></label>
      </div><//>`;
  }

  function ProjectForm({ project, onClose }) {
    const db = useDB();
    const [v, , bind] = useForm({ stage: 'Lead', ...project });
    const save = () => { if (!v.customerId || !String(v.name || '').trim()) return alert('Account and opportunity name are required.'); Store.upsert('projects', v); UI.toast('Opportunity saved'); onClose(); };
    return html`<${Modal} title=${v.id ? 'Edit opportunity' : 'New opportunity'} onClose=${onClose}
      footer=${html`${v.id && html`<button class="danger" onClick=${() => { if (confirm('Delete this opportunity?')) { Store.remove('projects', v.id); onClose(); } }}>Delete</button>`}<span class="spacer"></span><button onClick=${onClose}>Cancel</button><button class="primary" onClick=${save}>Save</button>`}>
      <div class="form">
        <label class="f full">Account<select ...${bind('customerId')}><option value="">— Choose —</option>${db.customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => html`<option value=${c.id}>${c.name}${c.city ? ' — ' + c.city : ''}</option>`)}</select></label>
        <label class="f full">Opportunity / project name<input ...${bind('name')} placeholder="e.g. Halifax school board — 120 cameras" /></label>
        <label class="f">Products<input ...${bind('product')} placeholder="Cameras, NVR, access control…" /></label>
        <label class="f">Amount (CAD)<input type="number" min="0" step="100" ...${bind('amount', 'num')} /></label>
        <label class="f">Stage<select ...${bind('stage')}>${FS.STAGES.map((s) => html`<option>${s}</option>`)}</select></label>
        <label class="f">Expected close<input type="date" ...${bind('closeDate')} /></label>
        <label class="f full">End user / site address<input ...${bind('site')} /></label>
        <label class="f full">Notes<textarea ...${bind('notes')}></textarea></label>
      </div><//>`;
  }

  function ContactForm({ contact, onClose }) {
    const [v, , bind] = useForm({ ...contact });
    const save = () => { if (!String(v.name || '').trim()) return alert('Name is required.'); Store.upsert('contacts', v); onClose(); };
    return html`<${Modal} title=${v.id ? 'Edit contact' : 'New contact'} onClose=${onClose}
      footer=${html`${v.id && html`<button class="danger" onClick=${() => { if (confirm('Delete contact?')) { Store.remove('contacts', v.id); onClose(); } }}>Delete</button>`}<span class="spacer"></span><button onClick=${onClose}>Cancel</button><button class="primary" onClick=${save}>Save</button>`}>
      <div class="form">
        <label class="f">Name<input ...${bind('name')} autofocus /></label>
        <label class="f">Title / role<input ...${bind('title')} placeholder="Owner, Purchasing, Tech lead…" /></label>
        <label class="f">Email<input type="email" ...${bind('email')} /></label>
        <label class="f">Phone<input ...${bind('phone')} /></label>
        <label class="f full">Notes<textarea ...${bind('notes')}></textarea></label>
      </div><//>`;
  }

  // ---------- Account drawer ----------
  function CustomerDrawer({ id }) {
    const db = useDB();
    const c = db.customers.find((x) => x.id === id);
    const [tab, setTab] = useState('activity');
    useEffect(() => { const k = (e) => e.key === 'Escape' && !UI.state.modal && UI.closeCustomer(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
    if (!c) return null;
    const sc = FS.scoreCustomer(c, db.settings);
    const visits = db.visits.filter((v) => v.customerId === id).sort((a, b) => b.date.localeCompare(a.date));
    const contacts = db.contacts.filter((v) => v.customerId === id);
    const projects = db.projects.filter((v) => v.customerId === id);
    const region = db.regions.find((r) => r.id === c.regionId);
    const openPipe = projects.filter((p) => !['Won', 'Lost'].includes(p.stage)).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const nav = FS.mapsLinks(null, [c])[0] || ('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([c.address, c.city, c.province].filter(Boolean).join(', ')));
    return html`<div class="overlay" onMouseDown=${(e) => e.target === e.currentTarget && UI.closeCustomer()}>
      <aside class="drawer">
        <div class="dhead">
          <div class="row"><h2 style="margin:0;flex:1">${c.name}</h2><button class="ghost" onClick=${() => UI.closeCustomer()}>✕</button></div>
          <div class="row small" style="margin-top:6px"><${PrioTag} p=${c.priority} /><${StatusTag} s=${c.status} />${c.partnerLevel && html`<span class="tag">${c.partnerLevel}</span>`}<${GeoTag} c=${c} /><span class="muted">${region ? region.name : 'No region'}</span></div>
          <div class="row" style="margin-top:12px">
            <button class="primary" onClick=${() => UI.logVisit(c.id)}>+ Log activity</button>
            <button onClick=${() => UI.editCustomer(c.id)}>Edit</button>
            <a class="btn" href=${nav} target="_blank" rel="noopener">Directions</a>
            ${c.contactPhone && html`<a class="btn" href=${'tel:' + c.contactPhone}>Call</a>`}
            ${c.contactEmail && html`<a class="btn" href=${'mailto:' + c.contactEmail}>Email</a>`}
          </div>
        </div>
        <div class="dbody">
          <div class="grid g3">
            <div class="card kpi"><div class="label">Visit score</div><div class="value">${sc.score}</div><div class="sub">${sc.reasons.slice(1).join(' · ') || 'Up to date'}</div></div>
            <div class="card kpi"><div class="label">Last visit</div><div class="value" style="font-size:18px">${c.lastVisit ? sc.since + 'd ago' : 'Never'}</div><div class="sub">Target every ${sc.target}d</div></div>
            <div class="card kpi"><div class="label">Open pipeline</div><div class="value" style="font-size:18px">${FS.money(openPipe)}</div><div class="sub">${projects.length} opportunit${projects.length === 1 ? 'y' : 'ies'}</div></div>
          </div>
          ${(c.pos || c.dealerId || c.distributor) && html`<div class="card small"><div class="row" style="gap:18px">
            ${Object.keys(c.pos || {}).sort().reverse().map((y) => html`<div><div class="muted">POS ${y}</div><strong class="num" style="font-size:16px">${FS.money(c.pos[y])}</strong></div>`)}
            ${c.distributor && html`<div><div class="muted">Distributor</div><strong>${c.distributor}</strong></div>`}
            ${c.dealerId && html`<div><div class="muted">Dealer #</div><strong>${c.dealerId}</strong>${c.dealerSince ? html`<div class="muted">since ${FS.fmtDate(c.dealerSince)}</div>` : ''}</div>`}
          </div></div>`}
          <div class="card small">
            <div>${[c.address, c.city, c.province, c.postal].filter(Boolean).join(', ') || html`<span class="muted">No address</span>`}</div>
            <div style="margin-top:6px">${c.contactName || ''} ${c.contactEmail ? '· ' + c.contactEmail : ''} ${c.contactPhone ? '· ' + c.contactPhone : ''}</div>
            ${c.nextFollowUp && html`<div style="margin-top:6px">Next follow-up: <strong class=${c.nextFollowUp < FS.today() ? '' : ''}>${FS.fmtDate(c.nextFollowUp)}</strong> ${c.nextFollowUp < FS.today() && html`<span class="tag bad">overdue</span>`}</div>`}
            ${c.notes && html`<div style="margin-top:8px;white-space:pre-wrap" class="muted">${c.notes}</div>`}
          </div>
          <div class="card">
            <div class="tabs">
              <button class=${tab === 'activity' ? 'on' : ''} onClick=${() => setTab('activity')}>Activity (${visits.length})</button>
              <button class=${tab === 'opps' ? 'on' : ''} onClick=${() => setTab('opps')}>Opportunities (${projects.length})</button>
              <button class=${tab === 'contacts' ? 'on' : ''} onClick=${() => setTab('contacts')}>Contacts (${contacts.length})</button>
            </div>
            ${tab === 'activity' && (visits.length ? html`<div class="tl">${visits.map((v) => html`<div class="it">
                <div class="row"><strong>${FS.fmtDate(v.date)}</strong><span class="tag">${v.type || 'In-person'}</span><span class="spacer"></span><button class="sm ghost" onClick=${() => UI.modal({ kind: 'visit', customerId: c.id, visit: v })}>Edit</button></div>
                ${v.outcome && html`<div style="white-space:pre-wrap;margin-top:4px">${v.outcome}</div>`}
                ${v.nextAction && html`<div class="small muted" style="margin-top:4px">Next: ${v.nextAction}${v.nextFollowUp ? ' (by ' + FS.fmtDate(v.nextFollowUp) + ')' : ''}</div>`}
              </div>`)}</div>` : html`<div class="empty">No activity yet. Log your first visit or call.</div>`)}
            ${tab === 'opps' && html`<div><button class="sm" onClick=${() => UI.editProject({ customerId: c.id })}>+ Opportunity</button>
              ${projects.map((p) => html`<div class="list-item" style="cursor:pointer" onClick=${() => UI.editProject(p)}><div style="flex:1"><strong>${p.name}</strong><div class="small muted">${p.product || ''}${p.closeDate ? ' · close ' + FS.fmtDate(p.closeDate) : ''}</div></div><span class="tag ${p.stage === 'Won' ? 'ok' : p.stage === 'Lost' ? 'bad' : 'blue'}">${p.stage}</span><span class="num">${FS.money(p.amount)}</span></div>`)}
              ${!projects.length && html`<div class="empty">No opportunities.</div>`}</div>`}
            ${tab === 'contacts' && html`<div><button class="sm" onClick=${() => UI.editContact({ customerId: c.id })}>+ Contact</button>
              ${contacts.map((p) => html`<div class="list-item" style="cursor:pointer" onClick=${() => UI.editContact(p)}><div style="flex:1"><strong>${p.name}</strong> <span class="muted small">${p.title || ''}</span><div class="small muted">${[p.email, p.phone].filter(Boolean).join(' · ')}</div></div></div>`)}
              ${!contacts.length && html`<div class="empty">No extra contacts.</div>`}</div>`}
          </div>
        </div>
      </aside></div>`;
  }

  G.UIX = { useDB, useUI, UI, Modal, MapView, PrioTag, StatusTag, GeoTag, CustomerForm, VisitForm, ProjectForm, ContactForm, CustomerDrawer, PRIO_COLOR };
})(window);
