/* Field Sales Command Center — core: utilities, data store, scoring, geo, planner, CSV.
   Data is kept in this browser (localStorage) and, when signed in, synced to Supabase by js/sync.js. */
(function (G) {
  'use strict';

  // ---------- Dates (always local calendar days as YYYY-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => toISO(new Date());
  const parseISO = (s) => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
  const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
  const startOfWeek = (s) => { const d = parseISO(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return toISO(d); };
  const fmtDate = (s) => s ? parseISO(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const fmtDay = (s) => s ? parseISO(s).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
  const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.round(m % 60))}`;
  const money = (n) => (Number(n) || 0).toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

  // ---------- Constants ----------
  const STATUSES = ['Prospect', 'Active Customer', 'Follow-up Needed', 'Meeting Scheduled', 'Inactive'];
  const PRIORITIES = ['A', 'B', 'C'];
  const STAGES = ['Lead', 'Quoted', 'In Progress', 'Won', 'Lost'];
  const VISIT_TYPES = ['In-person', 'Phone', 'Video', 'Email'];
  const PROVINCES = ['NS', 'NB', 'PE', 'NL', 'QC', 'ON', 'MB', 'SK', 'AB', 'BC', 'YT', 'NT', 'NU'];
  const TZ_BY_PROV = { NS: 'America/Halifax', NB: 'America/Moncton', PE: 'America/Halifax', NL: 'America/St_Johns', QC: 'America/Toronto', ON: 'America/Toronto' };

  // ---------- Store ----------
  const KEY = 'fscc.v1';
  const blank = () => ({
    customers: [], regions: [], visits: [], contacts: [], projects: [], trips: [], todos: [],
    settings: { intervalA: 30, intervalB: 60, intervalC: 90, ownerName: '', annualTarget: 0,
      homeLabel: '', homeLat: null, homeLng: null, lastBackup: null },
  });
  let db = blank();
  try { const raw = localStorage.getItem(KEY); if (raw) db = Object.assign(blank(), JSON.parse(raw)); db.settings = Object.assign(blank().settings, db.settings); } catch (e) { console.warn('Load failed', e); }
  const subs = new Set();
  let saveTimer = null;
  let saveError = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(db)); saveError = null; } catch (e) { saveError = e.message; }
      subs.forEach((f) => f());
    }, 150);
  }
  const changeHooks = new Set(); // told about edits made on this device (used by cloud sync)
  const Store = {
    get db() { return db; },
    get saveError() { return saveError; },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    onLocalChange(f) { changeHooks.add(f); return () => changeHooks.delete(f); },
    commit(mutator) { mutator(db); persist(); subs.forEach((f) => f()); changeHooks.forEach((f) => f()); },
    // fromCloud: data came from the cloud copy, so it is not a local edit to upload again
    replaceAll(next, opts) {
      db = Object.assign(blank(), next); db.settings = Object.assign(blank().settings, db.settings);
      persist(); subs.forEach((f) => f());
      if (!(opts && opts.fromCloud)) changeHooks.forEach((f) => f());
    },
    counts() { return { customers: db.customers.length, visits: db.visits.length, trips: db.trips.length }; },
    // generic CRUD
    upsert(table, rec) {
      const now = new Date().toISOString();
      Store.commit((d) => {
        const i = d[table].findIndex((r) => r.id === rec.id);
        if (i >= 0) d[table][i] = { ...d[table][i], ...rec, updatedAt: now };
        else d[table].push({ id: uid(), createdAt: now, updatedAt: now, ...rec });
      });
    },
    remove(table, id) {
      Store.commit((d) => {
        d[table] = d[table].filter((r) => r.id !== id);
        if (table === 'customers') {
          ['visits', 'contacts', 'projects', 'todos'].forEach((t) => { d[t] = d[t].filter((r) => r.customerId !== id); });
          d.trips.forEach((t) => { t.days = (t.days || []).map((day) => day.filter((s) => s.customerId !== id)); });
        }
        if (table === 'regions') d.customers.forEach((c) => { if (c.regionId === id) c.regionId = null; });
      });
    },
    // Logging a visit updates the customer's last visit / follow-up / status.
    logVisit(v) {
      const now = new Date().toISOString();
      Store.commit((d) => {
        const rec = { id: v.id || uid(), createdAt: now, ...v, updatedAt: now };
        const i = d.visits.findIndex((x) => x.id === rec.id);
        if (i >= 0) d.visits[i] = rec; else d.visits.push(rec);
        const c = d.customers.find((x) => x.id === v.customerId);
        if (c) {
          const mine = d.visits.filter((x) => x.customerId === c.id);
          const inPerson = mine.filter((x) => x.type === 'In-person').map((x) => x.date).sort();
          const any = mine.map((x) => x.date).sort();
          c.lastVisit = inPerson[inPerson.length - 1] || c.lastVisit || null;
          c.lastContact = any[any.length - 1] || null;
          if (v.nextFollowUp) c.nextFollowUp = v.nextFollowUp;
          else if (c.nextFollowUp && c.nextFollowUp <= v.date) c.nextFollowUp = null;
          if (v.setStatus) c.status = v.setStatus;
          c.updatedAt = now;
        }
        delete rec.setStatus;
      });
    },
  };

  // ---------- Scoring (same formula as the Base44 beta, max 100) ----------
  function targetInterval(c, s) {
    if (c.intervalDays) return Number(c.intervalDays);
    return { A: s.intervalA, B: s.intervalB, C: s.intervalC }[c.priority || 'C'] || 90;
  }
  function scoreCustomer(c, s, t = today()) {
    const priorityScore = { A: 40, B: 25, C: 10 }[c.priority || 'C'] || 10;
    const target = targetInterval(c, s);
    const since = c.lastVisit ? daysBetween(c.lastVisit, t) : null;
    const visitScore = since === null ? 40 : Math.max(0, Math.min(40, Math.round(20 * since / target)));
    let followScore = 0;
    if (c.nextFollowUp) { const d = daysBetween(t, c.nextFollowUp); followScore = d < 0 ? 20 : d <= 7 ? 10 : 0; }
    const reasons = [];
    reasons.push(`Priority ${c.priority || 'C'}`);
    if (since === null) reasons.push('Never visited');
    else if (since >= target) reasons.push(`${since}d since visit (target ${target})`);
    if (followScore === 20) reasons.push('Follow-up overdue');
    else if (followScore === 10) reasons.push('Follow-up this week');
    return { score: priorityScore + visitScore + followScore, since, target, overdueVisit: since === null || since >= target, reasons };
  }
  function rankCustomers(list, s, opts = {}) {
    return list
      .filter((c) => opts.includeInactive || c.status !== 'Inactive')
      .map((c) => ({ c, ...scoreCustomer(c, s) }))
      .sort((a, b) => b.score - a.score || (b.since ?? 1e9) - (a.since ?? 1e9) || a.c.name.localeCompare(b.c.name));
  }

  // ---------- Geo ----------
  const hasGeo = (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng);
  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  // Offline estimate: road distance ≈ 1.3× straight line, average 68 km/h (slightly conservative).
  const estDriveMin = (a, b) => (hasGeo(a) && hasGeo(b)) ? Math.round(haversineKm(a, b) * 1.3 / 68 * 60) : null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function nominatim(params) {
    const q = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'ca', ...params });
    const res = await fetch('https://nominatim.openstreetmap.org/search?' + q.toString(), { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) throw new Error('Geocoder HTTP ' + res.status);
    const j = await res.json();
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  }
  // Strip suite/unit numbers and expand common French/English street abbreviations.
  function cleanStreet(s) {
    s = String(s || '').split(/\n/)[0];
    s = s.replace(/[,\s]*(#|suite|unit|bureau|bur\.|local|app\.|apt\.?)\s*[\w-]+\s*$/i, '');
    s = s.replace(/^\s*[\w]+-(\d+)\s/, '$1 ');               // "75-9300 rang…" -> "9300 rang…"
    const ab = [[/\bbl\.?(?=\s)/i, 'boulevard'], [/\bboul\.?(?=\s)/i, 'boulevard'], [/\bblvd\.?(?=\s|$)/i, 'boulevard'], [/\bch\.?(?=\s)/i, 'chemin'], [/\bav\.?(?=\s)/i, 'avenue'],[/\best\.?\s*$/i, 'est'], [/\bouest\.?\s*$/i, 'ouest']];
    ab.forEach(([re, v]) => { s = s.replace(re, v); });
    return s.replace(/\s+/g, ' ').replace(/[.,\s]+$/, '').trim();
  }
  // Try the street address (structured, then free text), then postal code, then city. Marks precision.
  async function geocodeCustomer(c) {
    const street = cleanStreet(c.address);
    const prov = c.province || '';
    if (street && c.city) {
      let r = await nominatim({ street, city: c.city, state: prov });
      if (r) return { ...r, geo: 'exact' };
      await sleep(1100);
      r = await nominatim({ q: [street, c.city, prov, c.postal].filter(Boolean).join(', ') });
      if (r) return { ...r, geo: 'exact' };
      await sleep(1100);
    }
    if (c.postal) {
      const r = await nominatim({ postalcode: c.postal, country: 'Canada' });
      if (r) return { ...r, geo: 'postal' };
      await sleep(1100);
    }
    if (c.city) {
      const r = await nominatim({ city: c.city, state: c.province || '' });
      if (r) return { ...r, geo: 'city' };
    }
    return null;
  }
  async function geocodeText(text) { return nominatim({ q: text }); }

  // OSRM public server: real driving durations for an ordered list of points.
  async function osrmLegs(points) {
    if (points.length < 2) return [];
    const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`);
    if (!res.ok) throw new Error('Routing HTTP ' + res.status);
    const j = await res.json();
    if (j.code !== 'Ok') throw new Error('Routing: ' + j.code);
    return j.routes[0].legs.map((l) => ({ min: Math.round(l.duration / 60), km: Math.round(l.distance / 1000) }));
  }

  // ---------- Route ordering: nearest neighbour + 2-opt ----------
  function orderRoute(start, stops, returnToStart) {
    const geo = stops.filter(hasGeo), noGeo = stops.filter((s) => !hasGeo(s));
    if (!geo.length) return stops;
    let route = [], left = geo.slice(), cur = hasGeo(start) ? start : geo[0];
    while (left.length) {
      let bi = 0, bd = Infinity;
      left.forEach((p, i) => { const d = haversineKm(cur, p); if (d < bd) { bd = d; bi = i; } });
      cur = left.splice(bi, 1)[0]; route.push(cur);
    }
    const pts = (r) => [hasGeo(start) ? start : null, ...r, (returnToStart && hasGeo(start)) ? start : null].filter(Boolean);
    const len = (r) => { const p = pts(r); let t = 0; for (let i = 1; i < p.length; i++) t += haversineKm(p[i - 1], p[i]); return t; };
    let improved = true, best = len(route), guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < route.length - 1; i++) for (let k = i + 1; k < route.length; k++) {
        const cand = route.slice(0, i).concat(route.slice(i, k + 1).reverse(), route.slice(k + 1));
        const l = len(cand); if (l + 1e-9 < best) { best = l; route = cand; improved = true; }
      }
    }
    return route.concat(noGeo);
  }

  // ---------- Trip planner ----------
  function tripDates(t) { const out = []; if (!t.startDate || !t.endDate) return out; for (let d = t.startDate; d <= t.endDate && out.length < 31; d = addDays(d, 1)) out.push(d); return out; }
  function tripStart(t) { return (Number.isFinite(t.startLat) && Number.isFinite(t.startLng)) ? { lat: t.startLat, lng: t.startLng } : null; }

  // Available working window per day, honouring flights.
  function dayWindow(t, dayIdx, nDays) {
    let start = toMin(t.dayStart || '09:00'), end = toMin(t.dayEnd || '17:00');
    const dates = tripDates(t);
    if (t.flying && t.arrival && dayIdx === 0 && t.arrival.slice(0, 10) === dates[0]) start = Math.max(start, toMin(t.arrival.slice(11, 16)) + 60);
    if (t.flying && t.departure && dayIdx === nDays - 1 && t.departure.slice(0, 10) === dates[nDays - 1]) end = Math.min(end, toMin(t.departure.slice(11, 16)) - (Number(t.flightBuffer) || 120));
    return { start, end };
  }
  function dayCapacity(t, dayIdx, nDays) {
    const { start, end } = dayWindow(t, dayIdx, nDays);
    const per = (Number(t.meetingMin) || 45) + (Number(t.bufferMin) || 30);
    return Math.max(0, Math.min(Number(t.maxPerDay) || 4, Math.floor((end - start + (Number(t.bufferMin) || 30)) / per)));
  }

  // Greedy, time-aware day builder. Each day starts at the start point and repeatedly adds the
  // account with the best (visit score − driving penalty) that still lets the day finish on time
  // (including the drive back if "return to start" is on). Then the day is re-ordered (2-opt).
  function generateTrip(t, customers, settings, mustInclude = []) {
    const dates = tripDates(t), n = dates.length;
    const byId = Object.fromEntries(customers.map((c) => [c.id, c]));
    const excluded = new Set(t.excluded || []);
    const days = dates.map(() => []);
    const used = new Set();
    (t.days || []).forEach((day, di) => day.forEach((s) => { if (s.locked && di < n && byId[s.customerId]) { days[di].push(s); used.add(s.customerId); } }));
    const caps = dates.map((_, i) => dayCapacity(t, i, n));
    const pool = customers.filter((c) => !t.regionId || c.regionId === t.regionId || mustInclude.includes(c.id));
    const ranked = rankCustomers(pool, settings, { includeInactive: t.includeInactive });
    const scoreOf = Object.fromEntries(ranked.map((r) => [r.c.id, r.score]));
    const must = new Set(mustInclude);
    let start = tripStart(t);
    if (!start) { const first = ranked.find((r) => hasGeo(r.c)); start = first ? { lat: first.c.lat, lng: first.c.lng } : null; }
    const meeting = Number(t.meetingMin) || 45, buffer = Number(t.bufferMin) || 30;
    const drive = (a, b) => { const m = estDriveMin(a, b); return m == null ? buffer : m; };
    const unscheduledWhy = {};

    dates.forEach((_, di) => {
      const win = dayWindow(t, di, n);
      let clock = win.start, cur = start;
      days[di].forEach((s) => { const c = byId[s.customerId]; clock += (cur ? drive(cur, c) : 0) + (Number(s.duration) || meeting); if (hasGeo(c)) cur = c; });
      while (days[di].length < caps[di]) {
        let best = null, bestVal = -Infinity;
        for (const r of ranked) {
          const c = r.c;
          if (used.has(c.id) || excluded.has(c.id)) continue;
          const d = cur ? drive(cur, c) : 0;
          const back = t.returnToStart && start ? drive(c, start) : 0;
          if (clock + d + meeting + back > win.end) continue;
          const val = r.score + (must.has(c.id) ? 200 : 0) - d / 3; // 1 point per 3 min of driving
          if (val > bestVal) { bestVal = val; best = c; }
        }
        if (!best) break;
        clock += (cur ? drive(cur, best) : 0) + meeting;
        if (hasGeo(best)) cur = best;
        used.add(best.id); delete unscheduledWhy[best.id];
        days[di].push({ customerId: best.id, locked: false });
      }
    });
    const ordered = days.map((day) => {
      const lk = day.filter((s) => s.locked || s.fixedTime), free = day.filter((s) => !s.locked && !s.fixedTime);
      return lk.concat(orderRoute(start, free.map((s) => ({ ...byId[s.customerId], _s: s })), t.returnToStart).map((p) => p._s));
    });
    const fullDay = Math.max(0, ...dates.map((_, i) => { const w = dayWindow(t, i, n); return w.end - w.start; }));
    const tooFar = (c) => start && hasGeo(c) && drive(start, c) * (t.returnToStart ? 2 : 1) + meeting > fullDay;
    const unscheduled = ranked.filter((r) => !used.has(r.c.id)).map((r) => ({ id: r.c.id, reason: excluded.has(r.c.id) ? 'Excluded' : tooFar(r.c) ? 'Too far from start for one day' : 'Trip is full' }));
    return { days: ordered, unscheduled, caps };
  }

  // Build the timeline for each day: arrival/start/end, drive legs, overtime + flight flags.
  function buildSchedule(t, byId) {
    const dates = tripDates(t), n = dates.length, start = tripStart(t);
    return dates.map((date, di) => {
      const stops = (t.days && t.days[di]) || [];
      const win = dayWindow(t, di, n);
      const legsCache = (t.legs && t.legs[di]) || null;
      let clock = win.start, prev = start, rows = [], driveTotal = 0, kmTotal = 0;
      stops.forEach((s, i) => {
        const c = byId[s.customerId] || { name: '(deleted)' };
        let drive = null, km = null, real = false;
        if (legsCache && legsCache[i]) { drive = legsCache[i].min; km = legsCache[i].km; real = true; }
        else if (prev) { drive = estDriveMin(prev, c); km = drive != null ? Math.round(haversineKm(prev, c) * 1.3) : null; }
        if (i === 0 && !prev) drive = 0;
        if (drive == null) drive = Number(t.bufferMin) || 30;
        const arrive = clock + drive;
        const fixed = toMin(s.fixedTime);
        const st = fixed != null ? Math.max(arrive, fixed) : arrive;
        const dur = Number(s.duration || t.meetingMin) || 45;
        const end = st + dur;
        rows.push({ s, c, drive, km, real, arrive, start: st, end, late: fixed != null && arrive > fixed, over: end > win.end });
        driveTotal += drive; kmTotal += km || 0; clock = end; if (hasGeo(c)) prev = c;
      });
      let back = null;
      if (t.returnToStart && start && stops.length) {
        const lc = legsCache && legsCache[stops.length];
        back = lc ? lc.min : estDriveMin(prev, start) || 0;
        driveTotal += back; clock += back;
      }
      return { date, di, win, rows, back, finish: clock, driveTotal, kmTotal, over: clock > win.end };
    });
  }

  function mapsLinks(start, stops, returnToStart) {
    const fmt = (p) => hasGeo(p) ? `${p.lat},${p.lng}` : [p.address, p.city, p.province, 'Canada'].filter(Boolean).join(', ');
    const pts = [start, ...stops, returnToStart ? start : null].filter(Boolean);
    if (pts.length < 2) return [];
    const links = [], MAX = 9; // origin + up to 8 waypoints + destination
    for (let i = 0; i < pts.length - 1; i += MAX) {
      const seg = pts.slice(i, i + MAX + 1);
      if (seg.length < 2) break;
      const u = new URLSearchParams({ api: '1', origin: fmt(seg[0]), destination: fmt(seg[seg.length - 1]), travelmode: 'driving' });
      if (seg.length > 2) u.set('waypoints', seg.slice(1, -1).map(fmt).join('|'));
      links.push('https://www.google.com/maps/dir/?' + u.toString());
    }
    return links;
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }
  const csvCell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // block spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCSV = (header, rows) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  function download(name, content, type = 'text/csv') {
    const blob = new Blob([type.startsWith('text/csv') ? '﻿' + content : content], { type });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // Header synonyms for auto-mapping (also matches the Base44 export field names).
  const FIELD_MAP = {
    name: ['customer_name', 'customer', 'company', 'company name', 'account', 'account name', 'name', 'dealer', 'business name'],
    address: ['address', 'street', 'street address', 'address 1', 'address1'],
    city: ['city', 'town', 'municipality'],
    province: ['province', 'state', 'prov', 'province state'],
    postal: ['postal_code', 'postal code', 'postal', 'zip', 'zip code', 'postcode'],
    country: ['country'],
    region: ['region', 'region_name', 'region name', 'territory'],
    priority: ['account_priority', 'priority', 'tier', 'grade', 'class'],
    partnerLevel: ['partner_level', 'partner level', 'level', 'partner tier', 'program level'],
    status: ['relationship_status', 'status', 'relationship status', 'stage'],
    lastVisit: ['last_visit_date', 'last visit', 'last visit date'],
    lastContact: ['last_contact_date', 'last contact', 'last contact date'],
    nextFollowUp: ['next_follow_up_date', 'next follow up', 'follow up', 'follow up date', 'next follow up date'],
    intervalDays: ['visit_interval_days', 'visit interval', 'interval'],
    oppValue: ['estimated_opportunity_value', 'opportunity value', 'opportunity', 'value', 'potential'],
    contactName: ['contact_name', 'contact', 'contact name', 'primary contact'],
    contactEmail: ['contact_email', 'email', 'e mail', 'contact email'],
    contactPhone: ['contact_phone', 'phone', 'telephone', 'tel', 'contact phone', 'phone number'],
    lat: ['latitude', 'lat'],
    lng: ['longitude', 'lng', 'lon', 'long'],
    dealerId: ['dealer_id', 'dealer id', 'dealer registration number', 'registration number'],
    dealerSince: ['dealer_since', 'dealer since'],
    distributor: ['distributor', 'distributors', 'distributor s'],
    notes: ['notes', 'note', 'comments', 'other contacts'],
  };
  const FIELD_LABELS = { name: 'Company name *', address: 'Address', city: 'City', province: 'Province', postal: 'Postal code', country: 'Country', region: 'Region (name)', priority: 'Priority A/B/C', partnerLevel: 'Partner level', status: 'Relationship status', lastVisit: 'Last visit date', lastContact: 'Last contact date', nextFollowUp: 'Next follow-up', intervalDays: 'Visit interval (days)', oppValue: 'Opportunity value', contactName: 'Contact name', contactEmail: 'Contact email', contactPhone: 'Contact phone', lat: 'Latitude', lng: 'Longitude', dealerId: 'Dealer registration #', dealerSince: 'Dealer since', distributor: 'Distributor(s)', notes: 'Notes' };
  // Columns like "pos_2025", "2026 POS total", "POS 2026" become yearly POS sales.
  const posYear = (h) => { const m = norm(h).match(/^(?:pos (\d{4})|(\d{4}) pos(?: total)?|pos total (\d{4}))$/); return m ? m[1] || m[2] || m[3] : null; };

  const PROV_NAMES = { NS: ['nova scotia', 'nouvelle ecosse'], NB: ['new brunswick', 'nouveau brunswick'], PE: ['prince edward island', 'pei', 'ile du prince edouard', 'pe i'], NL: ['newfoundland and labrador', 'newfoundland', 'labrador', 'terre neuve et labrador', 'nfld'], QC: ['quebec', 'pq', 'que'], ON: ['ontario'], MB: ['manitoba'], SK: ['saskatchewan'], AB: ['alberta'], BC: ['british columbia', 'colombie britannique'], YT: ['yukon'], NT: ['northwest territories'], NU: ['nunavut'] };
  const deaccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  function normProvince(v) {
    const n = norm(deaccent(v)); if (!n) return null;
    const up = n.toUpperCase().replace(/ /g, '');
    if (PROVINCES.includes(up)) return up;
    for (const [code, names] of Object.entries(PROV_NAMES)) if (names.includes(n)) return code;
    return null;
  }
  // "SAINT-JEAN-SUR-RICHELIEU" -> "Saint-Jean-sur-Richelieu"; leaves mixed-case text alone.
  function niceCity(v) {
    const s = String(v || '').trim(); if (!s || s !== s.toUpperCase()) return s;
    const small = new Set(['sur', 'de', 'du', 'des', 'la', 'le', 'les', 'en', 'and', 'of']);
    return s.toLowerCase().replace(/[^\s\-]+/g, (w, i) => (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).replace(/\bSt\b\.?/g, 'St.').replace(/\bSte\b\.?/g, 'Ste.');
  }
  const money2 = (v) => { const n = Number(String(v || '').replace(/[^\d.\-]/g, '')); return Number.isFinite(n) ? n : null; };
  // Base44 packs dealer data into notes: "Dealer registration number: X | Dealer since: Y | Distributor(s): Z |
  // 2025 POS total: 1,234.56 | Additional contacts: Name (email; phone); Name2 (...)". Pull it into real fields.
  function parseNotes(notes) {
    const out = { fields: {}, pos: {}, contacts: [], rest: [] };
    String(notes || '').split('|').map((x) => x.trim()).filter(Boolean).forEach((seg) => {
      const i = seg.indexOf(':'); const key = i > 0 ? norm(seg.slice(0, i)) : ''; const val = i > 0 ? seg.slice(i + 1).trim() : seg;
      const y = key && posYear(key);
      if (y) out.pos[y] = money2(val);
      else if (key === 'dealer registration number') out.fields.dealerId = val;
      else if (key === 'dealer since') out.fields.dealerSince = normDate(val);
      else if (key === 'distributor s' || key === 'distributors' || key === 'distributor') out.fields.distributor = val;
      else if (key === 'additional contacts') {
        val.split(/;\s*(?![^()]*\))/).forEach((c) => {
          const m = c.trim().match(/^(.*?)\s*\(([^)]*)\)\s*$/);
          const name = (m ? m[1] : c).trim(); const parts = m ? m[2].split(';').map((x) => x.trim()) : [];
          const email = parts.find((x) => x.includes('@')) || ''; const phone = parts.find((x) => /\d{7,}/.test(x.replace(/\D/g, ''))) || '';
          if (name || email) out.contacts.push({ name: name || email, email, phone });
        });
      } else out.rest.push(seg);
    });
    return out;
  }
  // Turn one CSV row into an account record (+ extra contacts). Used by the import wizard.
  function importRecord(row, map, headers) {
    const g = (k) => map[k] != null && map[k] !== '' ? String(row[map[k]] ?? '').trim() : '';
    const rec = { name: g('name').replace(/^S\/curit\/ /, 'Sécurité '), address: g('address'), city: niceCity(g('city')), province: normProvince(g('province')), postal: g('postal').toUpperCase().replace(/^([A-Z]\d[A-Z])\s*(\d[A-Z]\d)$/, '$1 $2'), country: g('country') || 'Canada',
      _region: g('region'), priority: normPriority(g('priority')) || 'C', partnerLevel: g('partnerLevel'), status: normStatus(g('status')),
      lastVisit: normDate(g('lastVisit')), lastContact: normDate(g('lastContact')), nextFollowUp: normDate(g('nextFollowUp')),
      intervalDays: Number(g('intervalDays')) || null, oppValue: money2(g('oppValue')) || null,
      contactName: g('contactName'), contactEmail: g('contactEmail'), contactPhone: g('contactPhone'),
      dealerId: g('dealerId'), dealerSince: normDate(g('dealerSince')), distributor: g('distributor') };
    const lat = Number(g('lat')), lng = Number(g('lng'));
    if (g('lat') && g('lng') && Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) { rec.lat = lat; rec.lng = lng; rec.geo = 'imported'; }
    const pn = parseNotes(g('notes'));
    Object.entries(pn.fields).forEach(([k, v]) => { if (!rec[k] && v) rec[k] = v; });
    const pos = { ...pn.pos };
    (headers || []).forEach((h, i) => { const y = posYear(h); if (y && String(row[i] || '').trim() !== '') pos[y] = money2(row[i]); });
    if (Object.keys(pos).length) rec.pos = pos;
    rec.notes = pn.rest.join('\n');
    rec._contacts = pn.contacts;
    Object.keys(rec).forEach((k) => { if (rec[k] === '' || rec[k] === null) delete rec[k]; });
    return rec;
  }
  // Latest-year POS figure for an account (e.g. for sorting).
  const posOf = (c, year) => (c && c.pos && Number(c.pos[year])) || 0;
  function autoMap(headers) {
    const map = {}; const used = new Set();
    Object.entries(FIELD_MAP).forEach(([field, syns]) => {
      const ns = syns.map(norm);
      const i = headers.findIndex((h, idx) => !used.has(idx) && ns.includes(norm(h)));
      if (i >= 0) { map[field] = i; used.add(i); }
    });
    return map;
  }
  function normDate(v) {
    if (!v) return null; v = String(v).trim();
    let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/); if (m) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
    const d = new Date(v); return isNaN(d) ? null : toISO(d);
  }
  function normStatus(v) { const n = norm(v); if (!n) return null; return STATUSES.find((s) => norm(s) === n) || (n.includes('active') && !n.includes('in') ? 'Active Customer' : n.includes('inactive') ? 'Inactive' : n.includes('prospect') ? 'Prospect' : n.includes('follow') ? 'Follow-up Needed' : n.includes('meeting') ? 'Meeting Scheduled' : null); }
  function normPriority(v) { const s = String(v || '').trim().toUpperCase()[0]; return PRIORITIES.includes(s) ? s : null; }

  // Duplicate check: weighted match on name / phone / email / address.
  function findDuplicate(rec, list) {
    let best = null, bestScore = 0;
    const n = norm(rec.name), ph = digits(rec.contactPhone), em = String(rec.contactEmail || '').toLowerCase().trim(), ad = norm(rec.address);
    for (const c of list) {
      let s = 0;
      if (n && norm(c.name) === n) s += 60; else if (n && norm(c.name).length > 4 && (norm(c.name).includes(n) || n.includes(norm(c.name)))) s += 35;
      if (ph.length >= 7 && digits(c.contactPhone) === ph) s += 25;
      if (em && String(c.contactEmail || '').toLowerCase().trim() === em) s += 25;
      if (ad && norm(c.address) === ad) s += 20;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return bestScore >= 50 ? { match: best, score: Math.min(100, bestScore) } : null;
  }

  // ---------- Calendar (.ics) ----------
  function tripICS(t, schedule) {
    const esc = (s) => String(s || '').replace(/[\\,;]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Field Sales Command Center//EN', 'CALSCALE:GREGORIAN'];
    schedule.forEach((day) => day.rows.forEach((r) => {
      const d = day.date.replace(/-/g, '');
      const tm = (m) => fromMin(m).replace(':', '') + '00';
      lines.push('BEGIN:VEVENT', `UID:${t.id}-${r.s.customerId}-${d}@fscc`, `DTSTAMP:${stamp}`, `DTSTART:${d}T${tm(r.start)}`, `DTEND:${d}T${tm(r.end)}`,
        `SUMMARY:${esc('Visit: ' + r.c.name)}`, `LOCATION:${esc([r.c.address, r.c.city, r.c.province].filter(Boolean).join(', '))}`,
        `DESCRIPTION:${esc([r.c.contactName && 'Contact: ' + r.c.contactName, r.c.contactPhone, r.s.notes].filter(Boolean).join('\n'))}`, 'END:VEVENT');
    }));
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  G.FS = { pad, toISO, today, parseISO, addDays, daysBetween, startOfWeek, fmtDate, fmtDay, toMin, fromMin, money, uid, norm, digits,
    STATUSES, PRIORITIES, STAGES, VISIT_TYPES, PROVINCES, TZ_BY_PROV, Store, targetInterval, scoreCustomer, rankCustomers,
    hasGeo, haversineKm, estDriveMin, sleep, geocodeCustomer, geocodeText, osrmLegs, orderRoute, tripDates, tripStart, dayWindow, dayCapacity,
    generateTrip, buildSchedule, mapsLinks, parseCSV, toCSV, download, FIELD_MAP, FIELD_LABELS, autoMap, normDate, normStatus, normPriority,
    findDuplicate, tripICS, cleanStreet, normProvince, niceCity, parseNotes, importRecord, posOf, posYear };

  // Stand-in used until js/sync.js loads (or if a cached page skips it): app works locally.
  G.Sync = { enabled: false, signedIn: false, state: { status: 'off' }, syncNow() {},
    SyncGate: ({ children }) => children, StatusLine: () => 'Data saved in this browser.', StatusIcon: () => null, CloudCard: () => null };
})(window);
