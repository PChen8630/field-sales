/* Car mode: one dark screen with three huge buttons for driving — Talk, Navigate to the next stop,
   Call the next dealer. The next stop comes from today's trip; with no trip today it suggests the
   best drop-in near you. Keeps the screen awake while open. */
(function (G) {
  'use strict';
  const { html, useState, useEffect, useMemo } = htmPreact;
  const FS = G.FS;
  const PKEY = 'fscc.car';
  const loadPref = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; } };
  const savePref = (p) => { try { localStorage.setItem(PKEY, JSON.stringify({ ...loadPref(), ...p })); } catch (e) { /* ignore */ } };
  const fr = () => G.Voice.getLang().startsWith('fr');

  const addr = (c) => [c.address, c.city, c.province].filter(Boolean).join(', ');
  function navLink(c, app) {
    const dest = FS.hasGeo(c) ? `${c.lat},${c.lng}` : addr(c);
    if (app === 'waze') return FS.hasGeo(c) ? `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`;
    return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(dest);
  }
  const phoneOf = (c, db) => c.contactPhone || ((db.contacts.find((x) => x.customerId === c.id && !x.left && x.phone) || {}).phone) || c.phone || '';
  const contactOf = (c, db) => c.contactName || ((db.contacts.find((x) => x.customerId === c.id && !x.left) || {}).name) || '';

  // Today's planned stops (from trips), in order, with appointment times.
  function todaysStops(db) {
    const t = FS.today(), byId = Object.fromEntries(db.customers.map((c) => [c.id, c]));
    const out = [];
    db.trips.filter((tr) => tr.startDate <= t && tr.endDate >= t).forEach((tr) => {
      const day = FS.buildSchedule(tr, byId).find((d) => d.date === t);
      if (day) day.rows.forEach((r) => { if (r.c && r.c.id) out.push({ c: r.c, time: FS.fromMin(r.start), trip: tr.name }); });
    });
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  function useWakeLock() {
    useEffect(() => {
      let lock = null, gone = false;
      const get = async () => { try { if (navigator.wakeLock && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed: fine */ } };
      const vis = () => { if (!gone && document.visibilityState === 'visible') get(); };
      get(); document.addEventListener('visibilitychange', vis);
      return () => { gone = true; document.removeEventListener('visibilitychange', vis); if (lock) lock.release().catch(() => {}); };
    }, []);
  }

  function CarMode({ params }) {
    const db = G.UIX.useDB();
    const t = FS.today();
    const pref = loadPref();
    const [app, setApp] = useState(pref.nav || 'google');
    const [skip, setSkip] = useState(pref.skipDay === t ? (pref.skip || []) : []);
    const [pos, setPos] = useState(null);
    useWakeLock();

    // Opened from the "Talk" home-screen icon: start listening straight away.
    useEffect(() => {
      // (after the app shell is listening for UI changes, hence the small delay)
      if (params && params.talk) { history.replaceState(null, '', '#/car'); setTimeout(() => G.UIX.UI.modal({ kind: 'talk', car: true }), 50); }
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { maximumAge: 120000, timeout: 10000 });
    }, []);

    const visitedToday = new Set(db.visits.filter((v) => v.date === t).map((v) => v.customerId));
    const planned = todaysStops(db);
    const left = planned.filter((s) => !visitedToday.has(s.c.id) && !skip.includes(s.c.id));
    // No trip (or trip done): best drop-in near you, skipping home-based and closed dealers.
    const suggestion = useMemo(() => {
      if (left.length || !pos) return null;
      const r = FS.rankCustomers(db.customers.filter(FS.hasGeo), db.settings)
        .filter((x) => !x.c.residential && (!x.c.bizStatus || x.c.bizStatus === 'Active') && !visitedToday.has(x.c.id) && !skip.includes(x.c.id))
        .map((x) => ({ ...x, drive: FS.estDriveMin(pos, x.c) })).filter((x) => x.drive <= 45)
        .sort((a, b) => (b.score - b.drive / 2) - (a.score - a.drive / 2))[0];
      return r ? { c: r.c, drive: r.drive, suggested: true } : null;
    }, [db, pos, left.length, skip.join()]);
    const next = left[0] || suggestion;
    const c = next && next.c;
    const drive = c && pos ? FS.estDriveMin(pos, c) : null;
    const phone = c ? phoneOf(c, db) : '';
    const who = c ? contactOf(c, db) : '';
    const done = planned.length - left.length;
    const todos = c ? G.Todo.openOf(db, c.id) : [];

    const doSkip = () => { if (!c) return; const s = [...skip, c.id]; setSkip(s); savePref({ skip: s, skipDay: t }); };
    const resetSkip = () => { setSkip([]); savePref({ skip: [], skipDay: t }); };
    const pickApp = (a) => { setApp(a); savePref({ nav: a }); };
    const readPrep = () => {
      if (!c) return;
      const b = G.Field.brief(c, db);
      G.Voice.speak([(fr() ? 'Préparation pour ' : 'Prep for ') + c.name + '.', ...b.warn, ...b.points, who ? (fr() ? 'Contact : ' : 'Contact: ') + who + '.' : ''].filter(Boolean).join(' '));
    };

    return html`<div class="car">
      <div class="car-top">
        <a class="car-exit" href="#/">✕ Exit</a>
        <span class="car-title">🚗 Car mode</span>
        <span class="car-sync"><${G.Sync.StatusIcon} /></span>
      </div>

      <div class="car-next">
        ${c ? html`
          <div class="car-label">${next.suggested ? 'Suggested drop-in nearby' : `Next stop${next.time ? ' · ' + next.time : ''}${planned.length ? ` · ${done + 1} of ${planned.length}` : ''}`}</div>
          <div class="car-name">${c.name}</div>
          <div class="car-sub">${[c.city, drive != null ? `~${drive} min` : null, who].filter(Boolean).join(' · ')}</div>
          ${c.residential && html`<div class="car-warn">🏠 Appointment only — call first</div>`}
          ${todos.length > 0 && html`<div class="car-todo">✅ ${todos.length} to-do${todos.length > 1 ? 's' : ''}: ${todos[0].text}${todos.length > 1 ? ' …' : ''}</div>`}`
        : html`<div class="car-label">${planned.length ? 'All of today’s stops are done 🎉' : 'No trip planned today'}</div>
          <div class="car-sub">${pos ? 'No suggestion nearby.' : 'Allow location to get a drop-in suggestion.'}</div>`}
      </div>

      <button class="car-btn car-talk" onClick=${() => G.UIX.UI.modal({ kind: 'talk', car: true })}><span>🎙</span>Talk</button>
      <div class="car-row">
        <a class=${'car-btn car-nav' + (c ? '' : ' off')} href=${c ? navLink(c, app) : undefined} target="_blank" rel="noopener"><span>🧭</span>Navigate</a>
        <a class=${'car-btn car-call' + (phone ? '' : ' off')} href=${phone ? 'tel:' + phone.replace(/[^\d+]/g, '') : undefined}><span>📞</span>${phone ? 'Call' : 'No phone'}</a>
      </div>

      <div class="car-small">
        <button onClick=${readPrep} disabled=${!c}>🔊 Read prep</button>
        <button onClick=${doSkip} disabled=${!c}>⏭ Skip</button>
        ${skip.length > 0 && html`<button onClick=${resetSkip}>↺ Undo skips</button>`}
        <span class="car-seg"><button class=${app === 'google' ? 'on' : ''} onClick=${() => pickApp('google')}>Google Maps</button><button class=${app === 'waze' ? 'on' : ''} onClick=${() => pickApp('waze')}>Waze</button></span>
      </div>
      ${left.length > 1 && html`<div class="car-later">Then: ${left.slice(1, 4).map((s) => s.c.name + (s.time ? ' (' + s.time + ')' : '')).join(' · ')}</div>`}
      <a class="car-later" href="talk.html" style="margin-top:auto">📲 Put a one-tap Talk icon on your home screen</a>
    </div>`;
  }

  G.Car = { CarMode, todaysStops, navLink };
})(window);
