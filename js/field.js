/* On-the-road pages: "Near me now" (fill a gap after a cancellation) and the meeting prep one-pager. */
(function (G) {
  'use strict';
  const { html, useState, useEffect, useMemo, useRef } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const { useDB, UI, MapView, PrioTag, StatusTag, GeoTag, ResTag } = G.UIX;

  const addr = (c) => [c.address, c.city, c.province].filter(Boolean).join(', ');
  const dirLink = (from, c) => FS.mapsLinks(from && FS.hasGeo(from) ? from : null, [c])[0]
    || 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(FS.hasGeo(c) ? `${c.lat},${c.lng}` : addr(c));
  const ago = (d) => d == null ? 'never visited' : d === 0 ? 'visited today' : `visited ${d}d ago`;

  // ---------- Near me now ----------
  const PREF = 'fscc.near';
  const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch (e) { return {}; } };
  const savePref = (p) => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) { /* ignore */ } };

  // Greedy mini-route: best-value next stop that still fits in the free time.
  function quickRoute(origin, cands, freeMin, meetMin) {
    const out = []; let here = origin, left = freeMin; const pool = cands.slice();
    while (pool.length) {
      let best = null, bi = -1;
      pool.forEach((r, i) => {
        const d = FS.estDriveMin(here, r.c); if (d == null || d + meetMin > left) return;
        const val = r.score - d / 2;
        if (!best || val > best.val) { best = { ...r, drive: d, val }; bi = i; }
      });
      if (!best) break;
      out.push(best); left -= best.drive + meetMin; here = best.c; pool.splice(bi, 1);
    }
    return { stops: out, used: freeMin - left };
  }

  function NearMe() {
    const db = useDB();
    const p0 = loadPref();
    const [maxDrive, setMaxDrive] = useState(p0.maxDrive || 30);
    const [free, setFree] = useState(p0.free || 120);
    const [meet, setMeet] = useState(p0.meet || 45);
    const [origin, setOrigin] = useState(null); // {lat,lng,label}
    const [locErr, setLocErr] = useState('');
    const [locating, setLocating] = useState(false);
    const [q, setQ] = useState('');
    const [hideRes, setHideRes] = useState(!!p0.hideRes);
    useEffect(() => savePref({ maxDrive, free, meet, hideRes }), [maxDrive, free, meet, hideRes]);

    const locate = () => {
      if (!navigator.geolocation) { setLocErr('This browser cannot share your location. Pick a starting point below.'); return; }
      setLocating(true); setLocErr('');
      navigator.geolocation.getCurrentPosition(
        (pos) => { setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Your location' }); setLocating(false); },
        (e) => { setLocating(false); setLocErr(e.code === 1 ? 'Location is blocked. Allow location for this site, or pick a starting point below.' : 'Could not get your location. Pick a starting point below.'); },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 120000 });
    };
    useEffect(locate, []);

    const ranked = useMemo(() => {
      if (!origin) return [];
      return FS.rankCustomers(db.customers.filter(FS.hasGeo), db.settings)
        .filter((r) => !r.c.bizStatus || r.c.bizStatus === 'Active')
        .map((r) => ({ ...r, drive: FS.estDriveMin(origin, r.c), km: FS.haversineKm(origin, r.c) * 1.3 }))
        .filter((r) => r.drive <= maxDrive && (!hideRes || !r.c.residential))
        .map((r) => ({ ...r, val: r.score - r.drive / 2 }))
        .sort((a, b) => b.val - a.val);
    }, [db, origin, maxDrive, hideRes]);
    // Residential dealers need an appointment, so they never go into the drop-in route.
    const route = useMemo(() => origin ? quickRoute(origin, ranked.filter((r) => !r.c.residential).slice(0, 40), free, meet) : { stops: [] }, [ranked, free, meet]);
    const routeLink = origin && route.stops.length ? FS.mapsLinks(origin, route.stops.map((r) => r.c))[0] : null;
    const starts = q.length > 1 ? db.customers.filter((c) => FS.hasGeo(c) && (FS.norm(c.name).includes(FS.norm(q)) || FS.norm(c.city).includes(FS.norm(q)))).slice(0, 6) : [];
    const home = db.settings.homeLat != null ? { lat: db.settings.homeLat, lng: db.settings.homeLng, label: db.settings.homeLabel || 'Home base' } : null;
    const points = useMemo(() => {
      const pts = ranked.slice(0, 30).map((r) => ({ c: r.c, label: (route.stops.findIndex((s) => s.c.id === r.c.id) + 1) || null }));
      if (origin) pts.push({ c: { id: '__me', name: origin.label, lat: origin.lat, lng: origin.lng }, color: '#111827', label: '★' });
      return pts;
    }, [ranked, route, origin]);
    const routeLine = useMemo(() => origin && route.stops.length ? [{ color: '#1d4ed8', pts: [[origin.lat, origin.lng], ...route.stops.map((r) => [r.c.lat, r.c.lng])] }] : [], [route]);
    const sel = (label, val, set, opts) => html`<label class="f">${label}<select value=${val} onChange=${(e) => set(Number(e.target.value))}>${opts.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select></label>`;

    return html`<div class="head"><h1 class="grow">Near me now</h1><button onClick=${locate} disabled=${locating}>${locating ? 'Locating…' : '📍 Refresh location'}</button></div>
      <p class="muted" style="margin-top:-6px">Meeting cancelled or a free afternoon? These are the best accounts to drop in on from where you are. ★ is your starting point.</p>
      <div class="card" style="margin-bottom:14px">
        <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
          ${sel('Max drive to each', maxDrive, setMaxDrive, [[15, '15 min'], [30, '30 min'], [45, '45 min'], [60, '1 hour'], [90, '1.5 hours']])}
          ${sel('Free time', free, setFree, [[60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [480, 'Rest of day']])}
          ${sel('Time per visit', meet, setMeet, [[20, '20 min (quick hello)'], [30, '30 min'], [45, '45 min'], [60, '1 hour']])}
          <label class="f" style="flex-direction:row;align-items:center;gap:6px;align-self:end"><input type="checkbox" checked=${hideRes} onChange=${(e) => setHideRes(e.target.checked)} /> Hide 🏠 appointment-only</label>
        </div>
        <div class="small" style="margin-top:10px">Starting from: <strong>${origin ? origin.label : 'not set'}</strong>
          ${home && html` · <a style="cursor:pointer" onClick=${() => { setOrigin(home); setLocErr(''); }}>use home base</a>`}</div>
        ${locErr && html`<div class="badbox small" style="margin-top:8px">${locErr}</div>`}
        <input type="search" style="margin-top:8px;width:100%" placeholder="…or start from an account or city (type to search)" value=${q} onInput=${(e) => setQ(e.target.value)} />
        ${starts.map((c) => html`<div class="list-item" style="cursor:pointer" onClick=${() => { setOrigin({ lat: c.lat, lng: c.lng, label: c.name + (c.city ? ' (' + c.city + ')' : '') }); setQ(''); setLocErr(''); }}><strong>${c.name}</strong><span class="muted">${c.city}</span></div>`)}
      </div>
      ${!origin ? html`<div class="empty">Waiting for your location…</div>` : html`
      <div class="grid g2">
        <div class="card">
          <h2 style="margin-top:0">Suggested route for your ${free >= 480 ? 'day' : free / 60 + 'h'}</h2>
          ${route.stops.length ? html`
            <div class="small muted">${route.stops.length} stop${route.stops.length > 1 ? 's' : ''} · about ${Math.round(route.used / 6) / 10}h including ${meet} min per visit. Drive times are estimates, so call ahead.</div>
            ${route.stops.map((r, i) => html`<div class="list-item"><strong>${i + 1}.</strong><div style="flex:1;min-width:0"><a style="cursor:pointer;font-weight:600" onClick=${() => UI.openCustomer(r.c.id)}>${r.c.name}</a> <${PrioTag} p=${r.c.priority} /><div class="small muted">${r.c.city || ''} · ${r.drive} min drive · ${r.reasons.slice(1).join(' · ') || 'up to date'}</div></div></div>`)}
            <div class="row" style="margin-top:10px">${routeLink && html`<a class="btn primary" href=${routeLink} target="_blank" rel="noopener">🚗 Start in Google Maps</a>`}</div>`
          : html`<div class="empty">Nothing fits in this time. Try a longer drive or more free time.</div>`}
        </div>
        <div class="card flush"><${MapView} points=${points} route=${routeLine} height="320px" onPick=${(id) => id !== '__me' && UI.openCustomer(id)} key=${origin.lat + ',' + origin.lng} /></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h2 style="margin-top:0">All accounts within ${maxDrive} min (${ranked.length})</h2>
        ${!ranked.length && html`<div class="empty">No accounts with a map pin within ${maxDrive} minutes.</div>`}
        ${ranked.slice(0, 40).map((r) => html`<div class="list-item near">
          <div style="flex:1;min-width:0">
            <a style="cursor:pointer;font-weight:600" onClick=${() => UI.openCustomer(r.c.id)}>${r.c.name}</a> <${PrioTag} p=${r.c.priority} /> <${ResTag} c=${r.c} />
            <div class="small muted">${r.c.city || ''} · <strong>${r.drive} min</strong> (${Math.round(r.km)} km) · ${ago(r.since)}${r.c.nextFollowUp && r.c.nextFollowUp <= FS.today() ? ' · follow-up due' : ''}</div>
          </div>
          <div class="row" style="flex-wrap:nowrap">
            ${r.c.contactPhone && html`<a class="btn sm" href=${'tel:' + r.c.contactPhone} title="Call ahead">📞</a>`}
            <a class="btn sm" href=${'#/prep/' + r.c.id} title="Meeting prep">📋</a>
            <a class="btn sm" href=${dirLink(origin, r.c)} target="_blank" rel="noopener" title="Directions">🚗</a>
          </div></div>`)}
      </div>`}`;
  }

  // ---------- Meeting prep ----------
  function brief(c, db) {
    const t = FS.today(), y = Number(t.slice(0, 4));
    const sc = FS.scoreCustomer(c, db.settings);
    const visits = db.visits.filter((v) => v.customerId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const projects = db.projects.filter((p) => p.customerId === c.id);
    const open = projects.filter((p) => !['Won', 'Lost'].includes(p.stage));
    const warn = [], points = [];
    if (c.bizStatus && c.bizStatus !== 'Active') warn.push(`Business status: ${c.bizStatus}${c.bizStatusNote ? ' (' + c.bizStatusNote + ')' : ''}. Confirm before you go.`);
    if (c.residential) warn.push('Residential address: home-based business. Confirm the appointment before driving there, no drop-ins.');
    if (c.nextFollowUp && c.nextFollowUp < t) warn.push(`Follow-up was due ${FS.fmtDate(c.nextFollowUp)} (${FS.daysBetween(c.nextFollowUp, t)} days ago).`);
    const lastAct = visits.find((v) => v.nextAction);
    if (lastAct) points.push(`Open action from ${FS.fmtDate(lastAct.date)}: ${lastAct.nextAction}.`);
    if (sc.since == null) points.push('No in-person visit on record. Treat this as a first meeting.');
    else points.push(`Last in-person visit ${sc.since} days ago (${FS.fmtDate(c.lastVisit)})${sc.since >= sc.target ? `, past the ${sc.target}-day target` : ''}.`);
    if (visits[0] && visits[0].outcome) points.push(`Last time (${visits[0].type || 'visit'}, ${FS.fmtDate(visits[0].date)}): ${visits[0].outcome.slice(0, 220)}${visits[0].outcome.length > 220 ? '…' : ''}`);
    if (open.length) {
      const tot = open.reduce((a, p) => a + (Number(p.amount) || 0), 0);
      points.push(`${open.length} open opportunit${open.length > 1 ? 'ies' : 'y'} worth ${FS.money(tot)}: ${open.map((p) => `${p.name} (${p.stage}${p.closeDate ? ', close ' + FS.fmtDate(p.closeDate) : ''})`).join('; ')}.`);
      open.filter((p) => p.closeDate && p.closeDate < t).forEach((p) => points.push(`Close date passed for "${p.name}". Ask where it stands and update the stage.`));
    }
    const won = projects.filter((p) => p.stage === 'Won' && p.closeDate && FS.daysBetween(p.closeDate, t) <= 180);
    if (won.length) points.push(`Recent wins: ${won.map((p) => p.name).join('; ')}. Ask how the installs went and look for a referral.`);
    const cur = FS.posOf(c, y), prev = FS.posOf(c, y - 1);
    if (cur || prev) points.push(`POS on file: ${y} ${FS.money(cur)} · ${y - 1} ${FS.money(prev)} (may be incomplete).`);
    if (c.status === 'Prospect') points.push('Prospect: learn their current brands, typical project size and who decides. Leave the line card.');
    if (c.status === 'Follow-up Needed') points.push('Marked "Follow-up Needed". Find out what is blocking orders.');
    const dealer = [c.partnerLevel && `${c.partnerLevel} partner`, c.dealerSince && `dealer since ${c.dealerSince.slice(0, 4)}`, c.distributor && `buys through ${c.distributor}`].filter(Boolean);
    if (dealer.length) points.push(dealer.join(', ').replace(/^\w/, (x) => x.toUpperCase()) + '.');
    return { warn, points, visits, open, sc };
  }

  function Prep({ id }) {
    const db = useDB();
    const c = db.customers.find((x) => x.id === id);
    const [agenda, setAgenda] = useState(c ? c.prepNotes || '' : '');
    const timer = useRef();
    useEffect(() => () => { clearTimeout(timer.current); G.Voice.stopSpeaking(); }, []);
    if (!c) return html`<div class="empty">Account not found. <a href="#/accounts">Back to accounts</a></div>`;
    const b = brief(c, db);
    const contacts = [c.contactName && { name: c.contactName, title: 'Primary', phone: c.contactPhone, email: c.contactEmail }, ...db.contacts.filter((x) => x.customerId === c.id)].filter(Boolean);
    const saveAgenda = (txt) => { setAgenda(txt); clearTimeout(timer.current); timer.current = setTimeout(() => Store.upsert('customers', { id: c.id, prepNotes: txt }), 800); };
    const readAloud = () => G.Voice.speak([`Meeting prep for ${c.name}, ${c.city || ''}.`, ...b.warn, ...b.points,
      contacts[0] ? `Main contact: ${contacts[0].name}.` : '', agenda ? 'Your agenda: ' + agenda : ''].filter(Boolean).join(' '));
    const region = db.regions.find((r) => r.id === c.regionId);
    return html`<div class="prep">
      <div class="head"><div class="grow"><a class="small" onClick=${() => history.back()} style="cursor:pointer">← Back</a><h1 style="margin:4px 0">${c.name}</h1>
        <div class="row small"><${PrioTag} p=${c.priority} /><${StatusTag} s=${c.status} /><${ResTag} c=${c} /><${GeoTag} c=${c} /><span class="muted">${region ? region.name : ''}</span></div></div></div>
      <div class="row" style="margin-bottom:14px">
        <button class="primary" onClick=${readAloud}>🔊 Read aloud</button>
        <button onClick=${() => G.Voice.stopSpeaking()}>■ Stop</button>
        <a class="btn" href=${dirLink(null, c)} target="_blank" rel="noopener">🚗 Directions</a>
        ${c.contactPhone && html`<a class="btn" href=${'tel:' + c.contactPhone}>📞 Call</a>`}
        <button onClick=${() => UI.logVisit(c.id)}>+ Log this meeting</button>
        <button class="ghost" onClick=${() => UI.openCustomer(c.id)}>Full account</button>
      </div>
      ${b.warn.map((w) => html`<div class="badbox" style="margin-bottom:8px">⚠ ${w}</div>`)}
      <div class="grid g2">
        <div class="card"><h2 style="margin-top:0">Briefing</h2><ul class="brief">${b.points.map((p) => html`<li>${p}</li>`)}</ul>
          <div class="small muted" style="margin-top:8px">${addr(c)}${c.postal ? ' ' + c.postal : ''}</div></div>
        <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">My agenda</h2><${G.Voice.MicButton} onText=${(t) => saveAgenda((agenda ? agenda.replace(/\s+$/, '') + '\n' : '') + t)} /></div>
          <textarea style="width:100%;min-height:120px;margin-top:8px" placeholder="What do I want from this meeting? Products to show, questions to ask, quote to follow up…" value=${agenda} onInput=${(e) => saveAgenda(e.target.value)}></textarea>
          <div class="small muted">Saved automatically to this account.</div></div>
        <div class="card"><h2 style="margin-top:0">People (${contacts.length})</h2>
          ${contacts.length ? contacts.map((p) => html`<div class="list-item"><div style="flex:1;min-width:0"><strong>${p.name}</strong> <span class="small muted">${p.title || ''}</span><div class="small muted">${[p.email, p.phone].filter(Boolean).join(' · ')}</div></div>
            ${p.phone && html`<a class="btn sm" href=${'tel:' + p.phone}>📞</a>`}${p.email && html`<a class="btn sm" href=${'mailto:' + p.email}>✉</a>`}</div>`) : html`<div class="empty">No contacts yet. Ask for the owner and the purchaser.</div>`}</div>
        <div class="card"><h2 style="margin-top:0">Recent history</h2>
          ${b.visits.length ? html`<div class="tl">${b.visits.slice(0, 5).map((v) => html`<div class="it"><div class="row"><strong>${FS.fmtDate(v.date)}</strong><span class="tag">${v.type || 'In-person'}</span></div>
            ${v.outcome && html`<div class="small" style="white-space:pre-wrap;margin-top:2px">${v.outcome}</div>`}${v.nextAction && html`<div class="small muted">Next: ${v.nextAction}</div>`}</div>`)}</div>` : html`<div class="empty">No activity logged yet.</div>`}</div>
      </div>
      ${c.notes && html`<div class="card" style="margin-top:14px"><h2 style="margin-top:0">Account notes</h2><div class="small" style="white-space:pre-wrap">${c.notes}</div></div>`}
    </div>`;
  }

  G.Field = { NearMe, Prep, brief };
})(window);
