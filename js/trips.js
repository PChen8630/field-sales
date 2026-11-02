/* Trips: list, settings form, planner */
(function (G) {
  'use strict';
  const { html, useState, useMemo, useEffect } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const { useDB, UI, Modal, MapView, PrioTag, GeoTag } = G.UIX;
  const go = (h) => { location.hash = h; };
  const DAY_COLORS = ['#1d4ed8', '#059669', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#65a30d', '#7c3aed'];

  function TripList() {
    const db = useDB(), t = FS.today();
    const trips = db.trips.slice().sort((a, b) => b.startDate.localeCompare(a.startDate));
    const regionName = Object.fromEntries(db.regions.map((r) => [r.id, r.name]));
    return html`<div class="head"><h1 class="grow">Trips</h1><button class="primary" onClick=${() => go('#/trips/new')}>+ Plan a trip</button></div>
      <div class="card flush">${trips.length ? html`<table><thead><tr><th>Trip</th><th>Dates</th><th class="hide-m">Region</th><th>Stops</th><th>Status</th><th></th></tr></thead><tbody>
        ${trips.map((tr) => html`<tr class="click" onClick=${() => go('#/trips/' + tr.id)}>
          <td><strong>${tr.name}</strong>${tr.endDate < t ? html` <span class="tag">past</span>` : ''}</td><td class="small">${FS.fmtDate(tr.startDate)} → ${FS.fmtDate(tr.endDate)}</td>
          <td class="hide-m">${regionName[tr.regionId] || 'All regions'}</td><td class="num">${(tr.days || []).flat().length}</td>
          <td><span class=${'tag ' + (tr.status === 'confirmed' ? 'ok' : '')}>${tr.status || 'draft'}</span></td>
          <td onClick=${(e) => e.stopPropagation()}><button class="sm danger" onClick=${() => confirm('Delete trip "' + tr.name + '"?') && Store.remove('trips', tr.id)}>Delete</button></td></tr>`)}
      </tbody></table>` : html`<div class="empty">No trips yet. The planner picks who to visit (by priority and how overdue they are), groups them by area, orders each day and checks the schedule fits your working hours and flights.</div>`}</div>`;
  }

  function TripForm({ trip, onClose, onSaved }) {
    const db = useDB(), s = db.settings;
    const t = FS.today();
    const [v, setV] = useState(trip ? { ...trip } : { name: '', startDate: FS.addDays(t, 7), endDate: FS.addDays(t, 9), maxPerDay: 4, meetingMin: 45, bufferMin: 30, dayStart: '09:00', dayEnd: '17:00', returnToStart: false, flying: false, flightBuffer: 120, status: 'draft', includeInactive: false,
      startLabel: s.homeLabel || '', startLat: s.homeLat, startLng: s.homeLng, days: [] });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const set = (k) => (e) => setV((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
    const locate = async () => {
      setBusy(true); setErr('');
      try { const r = await FS.geocodeText(v.startLabel + ', Canada'); if (r) setV((o) => ({ ...o, startLat: r.lat, startLng: r.lng })); else setErr('Start location not found. Try a city name or full address.'); }
      catch (e) { setErr(e.message); } setBusy(false);
    };
    const save = () => {
      if (!v.name.trim()) return setErr('Give the trip a name.');
      if (!v.startDate || !v.endDate || v.endDate < v.startDate) return setErr('Check the dates.');
      if (FS.daysBetween(v.startDate, v.endDate) > 30) return setErr('Trips are limited to 31 days.');
      const n = FS.tripDates(v).length;
      const rec = { ...v, name: v.name.trim(), days: (v.days || []).slice(0, n), legs: null };
      while (rec.days.length < n) rec.days.push([]);
      if (!rec.id) rec.id = FS.uid();
      Store.upsert('trips', rec); onSaved(rec.id);
    };
    const regionName = (id) => (db.regions.find((r) => r.id === id) || {}).name;
    return html`<div class="card" style="max-width:820px">
      ${err && html`<div class="badbox" style="margin-bottom:12px">${err}</div>`}
      <div class="form">
        <label class="f full">Trip name<input value=${v.name} onInput=${set('name')} placeholder=${'e.g. ' + (regionName(v.regionId) || 'Moncton & Saint John') + ' — ' + FS.fmtDate(v.startDate)} /></label>
        <label class="f">Region (blank = all accounts)<select value=${v.regionId || ''} onChange=${set('regionId')}><option value="">All regions</option>${db.regions.map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select></label>
        <label class="f">Status<select value=${v.status} onChange=${set('status')}><option value="draft">Draft</option><option value="confirmed">Confirmed</option></select></label>
        <label class="f">Start date<input type="date" value=${v.startDate} onInput=${set('startDate')} /></label>
        <label class="f">End date<input type="date" value=${v.endDate} onInput=${set('endDate')} /></label>
        <label class="f">Max visits per day<input type="number" min="1" max="12" value=${v.maxPerDay} onInput=${set('maxPerDay')} /></label>
        <label class="f">Meeting length (min)<input type="number" min="10" step="5" value=${v.meetingMin} onInput=${set('meetingMin')} /></label>
        <label class="f">Day starts<input type="time" value=${v.dayStart} onInput=${set('dayStart')} /></label>
        <label class="f">Day must end by<input type="time" value=${v.dayEnd} onInput=${set('dayEnd')} /></label>
        <label class="f">Fallback drive time between stops (min)<input type="number" min="0" step="5" value=${v.bufferMin} onInput=${set('bufferMin')} /></label>
        <div></div>
        <label class="f full">Start / hotel location<div class="row"><input style="flex:1" value=${v.startLabel || ''} onInput=${set('startLabel')} placeholder="Hotel address or city, e.g. Moncton, NB" /><button disabled=${busy || !v.startLabel} onClick=${locate}>${busy ? '…' : '📍 Locate'}</button></div>
          <span class="small">${Number.isFinite(v.startLat) ? `✓ ${v.startLat.toFixed(4)}, ${v.startLng.toFixed(4)}` : 'Not located. Routes will start from the first stop.'}</span></label>
        <label class="chk full"><input type="checkbox" checked=${v.returnToStart} onChange=${set('returnToStart')} /> Return to start location at end of each day (counts toward the end-of-day limit)</label>
        <label class="chk full"><input type="checkbox" checked=${v.includeInactive} onChange=${set('includeInactive')} /> Include Inactive accounts</label>
        <label class="chk full"><input type="checkbox" checked=${v.flying} onChange=${set('flying')} /> I'm flying in/out</label>
        ${v.flying && html`
          <label class="f">Arrival flight lands<input type="datetime-local" value=${v.arrival || ''} onInput=${set('arrival')} /></label>
          <label class="f">Departure flight leaves<input type="datetime-local" value=${v.departure || ''} onInput=${set('departure')} /></label>
          <label class="f">Be at airport before departure (min)<input type="number" min="0" step="15" value=${v.flightBuffer} onInput=${set('flightBuffer')} /></label>
          <div class="small muted" style="align-self:end">First day starts 60 min after landing. Last day ends at departure minus this buffer.</div>`}
      </div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button onClick=${onClose}>Cancel</button><button class="primary" onClick=${save}>${trip ? 'Save settings' : 'Create & plan'}</button></div></div>`;
  }

  function NewTrip() {
    return html`<div class="head"><h1 class="grow">Plan a trip</h1></div>
      <${TripForm} onClose=${() => go('#/trips')} onSaved=${(id) => go('#/trips/' + id + '?gen=1')} />`;
  }

  function TripPlanner({ id, params }) {
    const db = useDB(), s = db.settings;
    const trip = db.trips.find((x) => x.id === id);
    const [editing, setEditing] = useState(false);
    const [unsched, setUnsched] = useState(null);
    const [busy, setBusy] = useState('');
    const [addQ, setAddQ] = useState({});
    const byId = useMemo(() => Object.fromEntries(db.customers.map((c) => [c.id, c])), [db.customers]);

    const update = (patch) => Store.commit((d) => { const tr = d.trips.find((x) => x.id === id); Object.assign(tr, patch, { updatedAt: new Date().toISOString() }); });
    const mutateDays = (fn, touched) => Store.commit((d) => {
      const tr = d.trips.find((x) => x.id === id); tr.days = tr.days.map((x) => x.slice()); fn(tr.days);
      if (tr.legs) (touched || tr.days.map((_, i) => i)).forEach((i) => { tr.legs[i] = null; });
    });
    const generate = () => {
      let cart = []; try { cart = JSON.parse(sessionStorage.getItem('fscc.cart') || '[]'); sessionStorage.removeItem('fscc.cart'); } catch (e) {}
      const r = FS.generateTrip(trip, db.customers, s, cart);
      update({ days: r.days, legs: null });
      setUnsched(r.unscheduled);
      UI.toast(`Planned ${r.days.flat().length} visits across ${r.days.length} days`);
    };
    useEffect(() => { if (trip && params.gen && !(trip.days || []).flat().length) { generate(); history.replaceState(null, '', '#/trips/' + id); } }, [id]);
    if (!trip) return html`<div class="empty">Trip not found. <a href="#/trips">Back to trips</a></div>`;

    const start = FS.tripStart(trip);
    const schedule = FS.buildSchedule(trip, byId);
    const scheduled = new Set((trip.days || []).flat().map((x) => x.customerId));
    const pool = db.customers.filter((c) => (!trip.regionId || c.regionId === trip.regionId) && (trip.includeInactive || c.status !== 'Inactive'));
    const ranked = FS.rankCustomers(pool, s, { includeInactive: trip.includeInactive });
    const remaining = ranked.filter((r) => !scheduled.has(r.c.id));
    const unschedReason = Object.fromEntries((unsched || []).map((u) => [u.id, u.reason]));
    const noGeo = (trip.days || []).flat().filter((x) => !FS.hasGeo(byId[x.customerId])).length;
    const overDays = schedule.filter((d) => d.over);
    const lateFixed = schedule.flatMap((d) => d.rows.filter((r) => r.late));
    const hasRealLegs = trip.legs && trip.legs.some(Boolean);
    // conflicts with other trips on the same dates
    const otherTrips = db.trips.filter((o) => o.id !== trip.id && o.startDate <= trip.endDate && o.endDate >= trip.startDate);

    const refreshDrive = async () => {
      setBusy('Getting drive times…');
      const legs = [];
      try {
        for (const day of schedule) {
          const pts = [start, ...day.rows.map((r) => r.c), trip.returnToStart ? start : null].filter(Boolean);
          const geoOk = pts.every(FS.hasGeo);
          if (!geoOk || pts.length < 2) { legs.push(null); continue; }
          let l = await FS.osrmLegs(pts);
          if (!start) l = [{ min: 0, km: 0 }, ...l]; // first stop has no inbound leg
          legs.push(l); await FS.sleep(300);
        }
        update({ legs }); UI.toast('Drive times updated from road network');
      } catch (e) { alert('Could not reach the routing service: ' + e.message + '\nEstimates (straight-line × 1.3 at 75 km/h) are used instead.'); }
      setBusy('');
    };
    const move = (di, i, dir) => mutateDays((days) => { const d = days[di]; const j = i + dir; if (j < 0 || j >= d.length) return; [d[i], d[j]] = [d[j], d[i]]; }, [di]);
    const moveDay = (di, i, to) => mutateDays((days) => { const [x] = days[di].splice(i, 1); days[to].push(x); }, [di, to]);
    const removeStop = (di, i) => mutateDays((days) => { days[di].splice(i, 1); }, [di]);
    const patchStop = (di, i, p) => mutateDays((days) => { days[di][i] = { ...days[di][i], ...p }; }, [di]);
    const addStop = (di, cid) => mutateDays((days) => { days[di].push({ customerId: cid, locked: false }); }, [di]);
    const optimizeDay = (di) => mutateDays((days) => {
      const d = days[di]; const lk = d.filter((x) => x.locked || x.fixedTime), free = d.filter((x) => !x.locked && !x.fixedTime);
      days[di] = lk.concat(FS.orderRoute(start, free.map((x) => ({ ...byId[x.customerId], _s: x })), trip.returnToStart).map((p) => p._s));
    }, [di]);
    const exclude = (cid) => update({ excluded: [...new Set([...(trip.excluded || []), cid])] });
    const exportCSV = () => FS.download(`${trip.name.replace(/[^\w-]+/g, '_')}.csv`, FS.toCSV(['day', 'date', 'order', 'arrive', 'start', 'end', 'drive_min', 'account', 'address', 'city', 'contact', 'phone', 'priority', 'notes'],
      schedule.flatMap((d) => d.rows.map((r, i) => [d.di + 1, d.date, i + 1, FS.fromMin(r.arrive), FS.fromMin(r.start), FS.fromMin(r.end), r.drive, r.c.name, r.c.address, r.c.city, r.c.contactName, r.c.contactPhone, r.c.priority, r.s.notes]))));
    const route = schedule.map((d, i) => ({ color: DAY_COLORS[i % DAY_COLORS.length], pts: [start, ...d.rows.map((r) => r.c), trip.returnToStart ? start : null].filter(FS.hasGeo).map((p) => [p.lat, p.lng]) }));
    const points = schedule.flatMap((d, di) => d.rows.map((r, i) => ({ c: r.c, label: String(i + 1), color: DAY_COLORS[di % DAY_COLORS.length] })));

    if (editing) return html`<div class="head"><h1 class="grow">Trip settings</h1></div><${TripForm} trip=${trip} onClose=${() => setEditing(false)} onSaved=${() => { setEditing(false); UI.toast('Settings saved. Click Re-plan to apply.'); }} />`;

    return html`
      <div class="head">
        <div class="grow"><div class="small"><a href="#/trips">← Trips</a></div><h1>${trip.name}</h1>
          <div class="muted small">${FS.fmtDate(trip.startDate)} → ${FS.fmtDate(trip.endDate)} · ${(db.regions.find((r) => r.id === trip.regionId) || {}).name || 'All regions'} · ${trip.startLabel || 'no start location'} · ${(trip.days || []).flat().length} stops</div></div>
        <select value=${trip.status || 'draft'} onChange=${(e) => update({ status: e.target.value })} class="noprint"><option value="draft">Draft</option><option value="confirmed">Confirmed</option></select>
        <button onClick=${() => setEditing(true)}>Settings</button>
        <button onClick=${() => { if (!(trip.days || []).flat().length || confirm('Re-plan? Unlocked stops will be replaced. Locked stops stay where they are.')) generate(); }}>↻ Re-plan</button>
        <button disabled=${!!busy} onClick=${refreshDrive}>${busy || '🚗 Real drive times'}</button>
        <button onClick=${() => FS.download(`${trip.name.replace(/[^\w-]+/g, '_')}.ics`, FS.tripICS(trip, schedule), 'text/calendar')} title="Import into Outlook / Google Calendar">📅 Calendar</button>
        <button onClick=${exportCSV}>CSV</button><button onClick=${() => print()}>🖨 Print</button>
      </div>
      <div class="stack noprint" style="margin-bottom:14px">
        ${overDays.length > 0 && html`<div class="badbox"><strong>Schedule runs late on ${overDays.length} day${overDays.length > 1 ? 's' : ''}:</strong> ${overDays.map((d) => `${FS.fmtDay(d.date)} finishes ${FS.fromMin(d.finish)} (limit ${FS.fromMin(d.win.end)})`).join('; ')}. Move or remove a stop, or extend the day in Settings.</div>`}
        ${lateFixed.length > 0 && html`<div class="badbox">Can't make ${lateFixed.length} fixed appointment${lateFixed.length > 1 ? 's' : ''} on time: ${lateFixed.map((r) => `${r.c.name} at ${r.s.fixedTime}`).join(', ')}.</div>`}
        ${noGeo > 0 && html`<div class="warnbox">${noGeo} stop${noGeo > 1 ? 's have' : ' has'} no map pin. ${noGeo > 1 ? "They're" : "It's"} kept at the end of the day and drive time is guessed. <a href="#/data?locate=1">Locate accounts</a></div>`}
        ${otherTrips.length > 0 && html`<div class="warnbox">Overlaps with another trip: ${otherTrips.map((o) => o.name).join(', ')}.</div>`}
        ${!hasRealLegs && (trip.days || []).flat().length > 0 && html`<div class="small muted">Drive times are estimates. Click <strong>Real drive times</strong> for road-network times (OSRM, no traffic).</div>`}
      </div>
      <div class="grid g2 noprint" style="margin-bottom:14px;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
        <div class="card flush"><${MapView} points=${points} route=${route} height="340px" onPick=${(cid) => UI.openCustomer(cid)} /></div>
        <div class="card flush" style="max-height:342px;display:flex;flex-direction:column">
          <div style="padding:12px 14px" class="row between"><h3 style="margin:0">Not scheduled (${remaining.length})</h3><span class="small muted">best first</span></div>
          <div class="scroll" style="flex:1">${remaining.slice(0, 60).map((r) => html`<div class="list-item">
            <span class="num" style="width:26px;font-weight:700">${r.score}</span>
            <a style="flex:1;cursor:pointer;min-width:0" onClick=${() => UI.openCustomer(r.c.id)}>${r.c.name} <${GeoTag} c=${r.c} /><div class="small muted">${r.c.city || ''}${unschedReason[r.c.id] ? ' · ' + unschedReason[r.c.id] : ''}</div></a>
            <${PrioTag} p=${r.c.priority} />
            <select class="sm" style="padding:3px" onChange=${(e) => { if (e.target.value !== '') addStop(Number(e.target.value), r.c.id); e.target.value = ''; }}><option value="">+ Day</option>${schedule.map((d) => html`<option value=${d.di}>${FS.fmtDay(d.date)}</option>`)}</select>
            ${(trip.excluded || []).includes(r.c.id) ? html`<button class="sm ghost" title="Allow again" onClick=${() => update({ excluded: trip.excluded.filter((x) => x !== r.c.id) })}>↺</button>` : html`<button class="sm ghost" title="Don't suggest for this trip" onClick=${() => exclude(r.c.id)}>✕</button>`}
          </div>`)}</div>
        </div>
      </div>
      <div class="days">${schedule.map((d) => { const color = DAY_COLORS[d.di % DAY_COLORS.length]; const links = FS.mapsLinks(start, d.rows.map((r) => r.c), trip.returnToStart);
        const cap = FS.dayCapacity(trip, d.di, schedule.length);
        const matches = (addQ[d.di] || '').length > 1 ? pool.filter((c) => !scheduled.has(c.id) && (FS.norm(c.name).includes(FS.norm(addQ[d.di])) || FS.norm(c.city).includes(FS.norm(addQ[d.di])))).slice(0, 6) : [];
        return html`<div class=${'day' + (d.over ? ' over' : '')}>
          <div class="dh" style=${'border-top:4px solid ' + color + ';border-radius:10px 10px 0 0'}>
            <div class="row between"><strong>Day ${d.di + 1} · ${FS.fmtDay(d.date)}</strong><span class=${'tag ' + (d.over ? 'bad' : 'ok')}>${FS.fromMin(d.win.start)}–${FS.fromMin(d.finish > d.win.start ? d.finish : d.win.start)}</span></div>
            <div class="small muted">${d.rows.length}/${cap} visits · ${Math.round(d.driveTotal / 60 * 10) / 10} h driving${d.kmTotal ? ' · ~' + d.kmTotal + ' km' : ''} · must end by ${FS.fromMin(d.win.end)}</div>
          </div>
          ${d.rows.map((r, i) => html`
            ${i > 0 || start ? html`<div class="leg">↓ ${r.drive} min${r.km ? ' · ' + r.km + ' km' : ''}${r.real ? '' : ' (est.)'}</div>` : ''}
            <div class=${'stop' + (r.over ? ' over' : '')}>
              <div class="row" style="flex-wrap:nowrap;align-items:flex-start">
                <div class="time">${FS.fromMin(r.start)}–${FS.fromMin(r.end)}${r.start > r.arrive ? html`<div class="small muted" style="font-weight:400">arrive ${FS.fromMin(r.arrive)}</div>` : ''}</div>
                <div style="flex:1;min-width:0"><a style="cursor:pointer;font-weight:600" onClick=${() => UI.openCustomer(r.c.id)}>${i + 1}. ${r.c.name}</a> <${PrioTag} p=${r.c.priority} /> <${GeoTag} c=${r.c} />${r.s.locked ? ' 🔒' : ''}
                  <div class="small muted">${[r.c.address, r.c.city].filter(Boolean).join(', ')}</div>
                  ${r.c.contactName && html`<div class="small muted">${r.c.contactName}${r.c.contactPhone ? ' · ' + r.c.contactPhone : ''}</div>`}
                  ${r.late && html`<div class="small" style="color:var(--bad)">Arrives ${FS.fromMin(r.arrive)}, after the ${r.s.fixedTime} appointment</div>`}
                  <div class="row noprint" style="margin-top:6px;gap:4px">
                    <button class="sm" title="Earlier" disabled=${i === 0} onClick=${() => move(d.di, i, -1)}>↑</button><button class="sm" title="Later" disabled=${i === d.rows.length - 1} onClick=${() => move(d.di, i, 1)}>↓</button>
                    <select class="sm" style="padding:3px" value="" onChange=${(e) => e.target.value !== '' && moveDay(d.di, i, Number(e.target.value))}><option value="">Move…</option>${schedule.filter((x) => x.di !== d.di).map((x) => html`<option value=${x.di}>Day ${x.di + 1}</option>`)}</select>
                    <input type="time" class="sm" style="padding:2px 4px;width:96px" title="Fixed appointment time" value=${r.s.fixedTime || ''} onChange=${(e) => patchStop(d.di, i, { fixedTime: e.target.value || null })} />
                    <input type="number" class="sm" style="padding:2px 4px;width:58px" title="Meeting minutes" min="10" step="5" value=${r.s.duration || trip.meetingMin} onChange=${(e) => patchStop(d.di, i, { duration: Number(e.target.value) })} />
                    <button class="sm" title=${r.s.locked ? 'Unlock' : 'Lock: keep this stop when re-planning'} onClick=${() => patchStop(d.di, i, { locked: !r.s.locked })}>${r.s.locked ? '🔓' : '🔒'}</button>
                    <a class="btn sm" title="Meeting prep" href=${"#/prep/" + r.c.id}>📋</a><button class="sm" title="Log visit" onClick=${() => UI.logVisit(r.c.id, { visit: undefined })}>✓</button>
                    <button class="sm danger" title="Remove" onClick=${() => removeStop(d.di, i)}>✕</button>
                  </div></div></div></div>`)}
          ${d.back != null && html`<div class="leg">↓ ${d.back} min back to start · finish ${FS.fromMin(d.finish)}</div>`}
          ${!d.rows.length && html`<div class="empty small">No visits planned</div>`}
          <div style="padding:8px 12px" class="noprint">
            <div class="row"><input type="search" class="sm" style="flex:1;padding:4px 8px" placeholder="Add account…" value=${addQ[d.di] || ''} onInput=${(e) => setAddQ({ ...addQ, [d.di]: e.target.value })} />
              ${d.rows.length > 2 && html`<button class="sm" title="Re-order this day for shortest driving (keeps locked/fixed stops first)" onClick=${() => optimizeDay(d.di)}>Optimize order</button>`}</div>
            ${matches.map((c) => html`<div class="list-item small" style="cursor:pointer;padding:6px 4px" onClick=${() => { addStop(d.di, c.id); setAddQ({ ...addQ, [d.di]: '' }); }}>+ ${c.name} <span class="muted">${c.city}</span></div>`)}
            ${links.length > 0 && html`<div class="row small" style="margin-top:8px">${links.map((u, k) => html`<a href=${u} target="_blank" rel="noopener">🧭 Google Maps${links.length > 1 ? ' (part ' + (k + 1) + ')' : ''}</a>`)}</div>`}
          </div>
        </div>`; })}</div>`;
  }

  G.Trips = { TripList, NewTrip, TripPlanner };
})(window);
