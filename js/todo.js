/* To do: quick tasks linked to a dealer. Add them by voice (Talk) or by hand, review them in the
   evening, and see what is still open on Today every morning. */
(function (G) {
  'use strict';
  const { html, useState, useRef, useEffect } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const PKEY = 'fscc.todo';
  const loadPref = () => { try { return JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; } };
  const savePref = (p) => { try { localStorage.setItem(PKEY, JSON.stringify({ ...loadPref(), ...p })); } catch (e) { /* ignore */ } };
  const EVENING = 17; // evening review is offered from 5 pm

  // ---------- Data helpers ----------
  const all = (db) => db.todos || [];
  const openOf = (db, cid) => all(db).filter((t) => !t.done && (cid === undefined || t.customerId === cid));
  const nextMonday = (t) => { const d = FS.parseISO(t).getDay(); return FS.addDays(t, ((8 - d) % 7) || 7); };
  const createdDay = (t) => (t.createdAt || '').slice(0, 10);
  function bucket(t, today) {
    if (!t.due) return 'none';
    if (t.due < today) return 'late';
    if (t.due === today) return 'today';
    if (t.due === FS.addDays(today, 1)) return 'tomorrow';
    if (t.due <= FS.addDays(today, 7)) return 'week';
    return 'later';
  }
  const GROUPS = [['late', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'Next 7 days'], ['later', 'Later'], ['none', 'No date']];
  const dueText = (d, today) => {
    if (!d) return '';
    if (d === today) return 'Today';
    if (d === FS.addDays(today, 1)) return 'Tomorrow';
    if (d < today) { const n = FS.daysBetween(d, today); return n + ' day' + (n > 1 ? 's' : '') + ' late'; }
    return FS.fmtDay(d);
  };
  const sortTodos = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.createdAt || '').localeCompare(b.createdAt || '');

  function add(rec) {
    const text = String(rec.text || '').trim();
    if (!text) return null;
    const now = new Date().toISOString(), id = FS.uid();
    Store.commit((d) => { (d.todos = d.todos || []).push({ id, text, customerId: rec.customerId || null, due: rec.due || null, done: false, source: rec.source || 'manual', createdAt: now, updatedAt: now }); });
    return id;
  }
  function patch(id, p) {
    const now = new Date().toISOString();
    Store.commit((d) => { const t = (d.todos || []).find((x) => x.id === id); if (t) Object.assign(t, p, { updatedAt: now }); });
  }
  const setDone = (id, done) => patch(id, { done, doneAt: done ? new Date().toISOString() : null });
  const remove = (id) => Store.commit((d) => { d.todos = (d.todos || []).filter((x) => x.id !== id); });

  // ---------- Small pieces ----------
  function DealerPick({ value, onChange }) {
    const db = G.UIX.useDB();
    const [q, setQ] = useState('');
    const c = value && db.customers.find((x) => x.id === value);
    if (c) return html`<div class="todo-dealer-on"><span>🏢 <strong>${c.name}</strong>${c.city ? html` <span class="muted small">${c.city}</span>` : ''}</span><button class="sm ghost" onClick=${() => onChange('')} title="Remove dealer">✕</button></div>`;
    const n = FS.norm(q);
    const matches = n.length > 1 ? db.customers.filter((x) => FS.norm(x.name).includes(n) || FS.norm(x.city).includes(n)).slice(0, 6) : [];
    return html`<div class="todo-dealer"><input type="search" placeholder="Dealer (optional): type a name or city" value=${q} onInput=${(e) => setQ(e.target.value)} />
      ${matches.length > 0 && html`<div class="todo-matches">${matches.map((m) => html`<button onClick=${() => { onChange(m.id); setQ(''); }}><strong>${m.name}</strong> <span class="muted small">${m.city || ''}</span></button>`)}</div>`}</div>`;
  }

  function DateChips({ value, onChange }) {
    const t = FS.today();
    const opts = [['Today', t], ['Tomorrow', FS.addDays(t, 1)], ['Next Mon', nextMonday(t)], ['+1 week', FS.addDays(t, 7)], ['No date', '']];
    return html`<div class="todo-chips">${opts.map(([l, v]) => html`<button class=${'sm' + ((value || '') === v ? ' on' : '')} onClick=${() => onChange(v)}>${l}</button>`)}
      <input type="date" value=${value || ''} onInput=${(e) => onChange(e.target.value)} aria-label="Pick a date" /></div>`;
  }

  // Quick add box. With `customerId` the dealer is fixed (dealer page).
  function QuickAdd({ customerId, autofocus }) {
    const [text, setText] = useState('');
    const [cid, setCid] = useState(customerId || '');
    const [due, setDue] = useState(FS.addDays(FS.today(), 1));
    const ref = useRef(null);
    useEffect(() => { if (autofocus && ref.current) ref.current.focus(); }, []);
    const go = () => {
      if (!text.trim()) { if (ref.current) ref.current.focus(); return; }
      add({ text, customerId: customerId || cid, due });
      setText(''); if (!customerId) setCid('');
      G.UIX.UI.toast('Added to To do');
      if (ref.current) ref.current.focus();
    };
    return html`<div class="card todo-add">
      <div class="row"><input ref=${ref} class="grow" placeholder="What do you need to do? e.g. Send pricing for 4K cameras" value=${text}
        onInput=${(e) => setText(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') go(); }} />
        <${G.Voice.MicButton} onText=${(t) => setText((o) => (o ? o + ' ' : '') + t)} /></div>
      ${!customerId && html`<${DealerPick} value=${cid} onChange=${setCid} />`}
      <div class="row" style="align-items:center"><span class="small muted">Due</span><${DateChips} value=${due} onChange=${setDue} /><span class="spacer"></span><button class="primary" onClick=${go}>+ Add</button></div>
    </div>`;
  }

  function Row({ t, showDealer = true, review }) {
    const db = G.UIX.useDB();
    const today = FS.today();
    const [edit, setEdit] = useState(false);
    const c = t.customerId && db.customers.find((x) => x.id === t.customerId);
    const b = bucket(t, today);
    const move = (d, label) => { patch(t.id, { due: d }); G.UIX.UI.toast('Moved to ' + label); };
    if (edit) return html`<${EditRow} t=${t} onDone=${() => setEdit(false)} />`;
    return html`<div class=${'todo-row' + (t.done ? ' done' : '')}>
      <input type="checkbox" class="todo-chk" checked=${!!t.done} onChange=${(e) => { setDone(t.id, e.target.checked); if (e.target.checked) G.UIX.UI.toast('Done ✓'); }} aria-label="Done" />
      <div class="grow" style="min-width:0">
        <div class="todo-text" onClick=${() => !t.done && setEdit(true)}>${t.text}</div>
        <div class="small muted todo-meta">
          ${showDealer && (c ? html`<a href="javascript:void 0" onClick=${() => G.UIX.UI.openCustomer(c.id)}>🏢 ${c.name}</a>` : html`<span>No dealer</span>`)}
          ${t.due && !t.done && html`<span class=${'tag ' + (b === 'late' ? 'bad' : b === 'today' ? 'warn' : '')}>${dueText(t.due, today)}</span>`}
          ${t.source === 'voice' && html`<span title="Added by voice">🎙</span>`}
          ${t.done && t.doneAt && html`<span>Done ${FS.fmtDay(t.doneAt.slice(0, 10))}</span>`}
        </div>
      </div>
      ${!t.done && html`<div class=${'todo-acts' + (review ? ' big' : '')}>
        ${review && html`<button class="sm primary" onClick=${() => { setDone(t.id, true); G.UIX.UI.toast('Done ✓'); }}>✓ Done</button>`}
        ${t.due !== FS.addDays(today, 1) && html`<button class="sm" onClick=${() => move(FS.addDays(today, 1), 'tomorrow')} title="Move to tomorrow">→ Tmrw</button>`}
        ${review && html`<button class="sm" onClick=${() => move(nextMonday(today), 'next Monday')}>→ Mon</button>`}
        <button class="sm ghost" onClick=${() => setEdit(true)} title="Edit">✎</button>
      </div>`}
      ${t.done && html`<button class="sm ghost" onClick=${() => { if (confirm('Delete this to-do?')) remove(t.id); }} title="Delete">✕</button>`}
    </div>`;
  }

  function EditRow({ t, onDone }) {
    const [v, setV] = useState({ text: t.text, customerId: t.customerId || '', due: t.due || '' });
    const save = () => { if (!v.text.trim()) return; patch(t.id, { text: v.text.trim(), customerId: v.customerId || null, due: v.due || null }); onDone(); };
    return html`<div class="todo-row editing"><div class="grow stack" style="gap:8px">
      <input value=${v.text} onInput=${(e) => setV({ ...v, text: e.target.value })} onKeyDown=${(e) => { if (e.key === 'Enter') save(); }} />
      <${DealerPick} value=${v.customerId} onChange=${(x) => setV({ ...v, customerId: x })} />
      <${DateChips} value=${v.due} onChange=${(x) => setV({ ...v, due: x })} />
      <div class="row"><button class="sm danger" onClick=${() => { if (confirm('Delete this to-do?')) remove(t.id); }}>Delete</button><span class="spacer"></span><button class="sm" onClick=${onDone}>Cancel</button><button class="sm primary" onClick=${save}>Save</button></div>
    </div></div>`;
  }

  // ---------- Evening review ----------
  // What to look at tonight: everything due today or earlier, plus what was added today.
  const reviewList = (db, today) => openOf(db).filter((t) => (t.due && t.due <= today) || createdDay(t) === today || !t.due).sort(sortTodos);
  const reviewedToday = () => loadPref().reviewed === FS.today();

  function Review({ onExit }) {
    const db = G.UIX.useDB();
    const t = FS.today();
    const [ids] = useState(() => reviewList(db, t).map((x) => x.id)); // keep the list steady while you work through it
    const items = ids.map((id) => all(db).find((x) => x.id === id)).filter(Boolean);
    const left = items.filter((x) => !x.done && (!x.due || x.due <= t));
    const doneToday = all(db).filter((x) => x.done && (x.doneAt || '').slice(0, 10) === t);
    const finish = () => { savePref({ reviewed: t }); G.UIX.UI.toast('Review done. See you tomorrow 👋'); onExit(); };
    return html`<div>
      <div class="card todo-review-head"><h3 style="margin:0">🌙 Evening review</h3>
        <div class="small muted">For each one: tick it if it's done, or move it to another day. Items added today are here so you can check the dealer and date.</div>
        <div class="small" style="margin-top:6px">✅ Done today: <strong>${doneToday.length}</strong> · Still to sort: <strong>${left.length}</strong></div></div>
      ${items.length ? html`<div class="card todo-list">${items.map((x) => html`<${Row} t=${x} review=${true} key=${x.id} />`)}</div>`
        : html`<div class="card empty">Nothing to review. 🎉</div>`}
      <div class="row" style="margin-top:12px"><button onClick=${onExit}>Back</button><span class="spacer"></span><button class="primary" onClick=${finish}>Finish review</button></div>
    </div>`;
  }

  // ---------- Page ----------
  function TodoPage({ params }) {
    const db = G.UIX.useDB();
    const t = FS.today();
    const [review, setReview] = useState(!!(params && params.review));
    const [show, setShow] = useState('open');
    const [q, setQ] = useState('');
    const exitReview = () => { setReview(false); if (location.hash.includes('review')) history.replaceState(null, '', '#/todo'); };
    if (review) return html`<div><${Review} onExit=${exitReview} /></div>`;

    const byId = Object.fromEntries(db.customers.map((c) => [c.id, c]));
    const n = FS.norm(q);
    const match = (x) => !n || FS.norm(x.text).includes(n) || (x.customerId && byId[x.customerId] && FS.norm(byId[x.customerId].name).includes(n));
    const open = openOf(db).filter(match).sort(sortTodos);
    const done = all(db).filter((x) => x.done).filter(match).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 100);
    const late = open.filter((x) => bucket(x, t) === 'late').length, tod = open.filter((x) => bucket(x, t) === 'today').length;
    const evening = new Date().getHours() >= EVENING;

    return html`<div>
      <div class="head"><div class="grow"><h1>✅ To do</h1></div>
        <button class=${evening && !reviewedToday() ? 'primary' : ''} onClick=${() => setReview(true)}>🌙 Evening review</button>
        <button onClick=${() => G.Talk.open()}>🎙 Talk</button></div>
      <div class="small muted" style="margin:-4px 0 12px">${open.length} open${late ? ` · ${late} overdue` : ''}${tod ? ` · ${tod} due today` : ''}. Say it in 🎙 Talk while driving (“…and I need to send them pricing by Friday”) or type it below.</div>
      <${QuickAdd} />
      <div class="row" style="margin:14px 0 8px">
        <div class="seg"><button class=${show === 'open' ? 'on' : ''} onClick=${() => setShow('open')}>Open (${openOf(db).length})</button><button class=${show === 'done' ? 'on' : ''} onClick=${() => setShow('done')}>Done</button></div>
        <input type="search" class="grow" placeholder="Search to-dos or dealer…" value=${q} onInput=${(e) => setQ(e.target.value)} style="min-width:140px" /></div>
      ${show === 'open' && (open.length ? GROUPS.map(([k, label]) => {
        const g = open.filter((x) => bucket(x, t) === k);
        return g.length > 0 && html`<div class="todo-group"><h3 class=${'todo-gh ' + k}>${label} <span class="muted">(${g.length})</span></h3>
          <div class="card todo-list">${g.map((x) => html`<${Row} t=${x} key=${x.id} />`)}</div></div>`;
      }) : html`<div class="card empty">${q ? 'No match.' : 'Nothing to do. Add one above, or say it in Talk.'}</div>`)}
      ${show === 'done' && (done.length ? html`<div class="card todo-list">${done.map((x) => html`<${Row} t=${x} key=${x.id} />`)}</div>` : html`<div class="card empty">Nothing done yet.</div>`)}
    </div>`;
  }

  // ---------- Today screen card (morning reminder / evening nudge) ----------
  function TodayCard() {
    const db = G.UIX.useDB();
    const t = FS.today();
    const open = openOf(db);
    if (!open.length) return null;
    const due = open.filter((x) => x.due && x.due <= t).sort(sortTodos);
    const late = due.filter((x) => x.due < t).length;
    const evening = new Date().getHours() >= EVENING;
    const toReview = reviewList(db, t).length;
    if (evening && !reviewedToday() && toReview) {
      return html`<div class="card todo-today evening"><div class="row"><div class="grow"><h3 style="margin:0">🌙 Evening review</h3>
        <div class="small muted">${toReview} to-do${toReview > 1 ? 's' : ''} to check before tomorrow.</div></div>
        <a class="btn primary" href="#/todo?review=1">Review now</a></div></div>`;
    }
    return html`<div class="card todo-today">
      <div class="row"><h3 style="margin:0;flex:1">✅ To do ${due.length ? html`<span class="small muted">· ${late ? html`<span class="bad-t">${late} overdue</span> · ` : ''}${due.length - late} today</span>` : ''}</h3><a class="small" href="#/todo">All (${open.length}) →</a></div>
      ${due.length ? html`<div class="todo-list" style="margin-top:6px">${due.slice(0, 6).map((x) => html`<${Row} t=${x} key=${x.id} />`)}</div>
        ${due.length > 6 && html`<div class="small muted" style="margin-top:6px"><a href="#/todo">+ ${due.length - 6} more</a></div>`}`
        : html`<div class="small muted" style="margin-top:4px">Nothing due today. Next: ${open.sort(sortTodos)[0].text}${open[0].due ? ' (' + dueText(open[0].due, t) + ')' : ''}</div>`}
    </div>`;
  }

  // ---------- Dealer page tab ----------
  function DealerTodos({ customerId }) {
    const db = G.UIX.useDB();
    const open = openOf(db, customerId).sort(sortTodos);
    const done = all(db).filter((x) => x.done && x.customerId === customerId).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')).slice(0, 10);
    return html`<div>
      <${QuickAdd} customerId=${customerId} />
      ${open.length ? html`<div class="todo-list">${open.map((x) => html`<${Row} t=${x} showDealer=${false} key=${x.id} />`)}</div>` : html`<div class="empty">No open to-dos for this dealer.</div>`}
      ${done.length > 0 && html`<details style="margin-top:8px"><summary class="small muted">Done (${done.length})</summary><div class="todo-list">${done.map((x) => html`<${Row} t=${x} showDealer=${false} key=${x.id} />`)}</div></details>`}
    </div>`;
  }

  G.Todo = { TodoPage, TodayCard, DealerTodos, QuickAdd, add, setDone, openOf, dueText, nextMonday };
})(window);
