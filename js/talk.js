/* Talk: one button to speak a note while driving. The AI (Supabase function "voice-update",
   Claude Haiku) works out the dealer, a visit summary, projects, follow-ups and contact moves.
   Nothing is saved until you say "yes" or tap Save, and every save can be undone. */
(function (G) {
  'use strict';
  const { html, useState, useEffect, useRef } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const SR = G.SpeechRecognition || G.webkitSpeechRecognition;
  const QKEY = 'fscc.voiceQueue';

  // ---------- Offline queue ----------
  const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } };
  const writeQ = (q) => { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { /* ignore */ } qsubs.forEach((f) => f()); };
  const qsubs = new Set();
  function useQueue() { const [, f] = useState(0); useEffect(() => { const g = () => f((n) => n + 1); qsubs.add(g); return () => qsubs.delete(g); }, []); return readQ(); }

  // ---------- Location (best effort, never blocks for long) ----------
  function getPosition() {
    return new Promise((res) => {
      if (!navigator.geolocation) return res(null);
      const t = setTimeout(() => res(null), 4000);
      navigator.geolocation.getCurrentPosition((p) => { clearTimeout(t); res({ lat: p.coords.latitude, lng: p.coords.longitude }); },
        () => { clearTimeout(t); res(null); }, { maximumAge: 120000, timeout: 4000, enableHighAccuracy: false });
    });
  }

  // ---------- Sound-alike matching ----------
  // Speech recognition in one language mangles names from the other ("Sécuritech" -> "security tech",
  // "Carillon" -> "carry on"). We compare how words *sound* to find likely dealers and contacts.
  const GENERIC = new Set('inc ltee ltd limited limitee enr senc corp corporation cie co the le la les de du des d l et and groupe group alarme alarmes alarm alarms securite security systemes systeme systems system solutions solution services service technologies technology technologie communications communication electronique electronic electronics entreprises entreprise enterprises enterprise quebec qc canada'.split(' '));
  const deacc = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function phon(word) {
    let w = deacc(word).replace(/[^a-z0-9]/g, '');
    if (!w || /^\d+$/.test(w)) return w;
    w = w.replace(/eau/g, 'o').replace(/au/g, 'o').replace(/ou/g, 'u').replace(/oi/g, 'wa').replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/ck/g, 'k')
      .replace(/ch/g, 'sh').replace(/th/g, 't').replace(/gn/g, 'ny').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's')
      .replace(/y/g, 'i').replace(/(^|[^s])h/g, '$1').replace(/ai|ei/g, 'e').replace(/ique$/, 'ik').replace(/(er|et|ez)$/, 'e').replace(/(.)\1+/g, '$1');
    if (w.length > 3 && !/sh$/.test(w)) w = w.replace(/[estdx]$/, '');
    return w;
  }
  const words = (x) => deacc(x).split(/[^a-z0-9]+/).filter(Boolean);
  const core = (name) => { const ws = words(name).filter((w) => !GENERIC.has(w)); return (ws.length ? ws : words(name)).map(phon).join(''); };
  function dice(a, b) {
    if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
    const bg = (x) => { const m = new Map(); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
    const A = bg(a), B = bg(b); let n = 0;
    A.forEach((v, k) => { n += Math.min(v, B.get(k) || 0); });
    return 2 * n / (a.length + b.length - 2);
  }
  // Returns [{item, score, heard}] best first.
  // Consonant outline ("mirorbel" -> "mrrbl" -> "mrbl"): survives vowel mix-ups between languages.
  const skeleton = (p) => (p[0] || '') + p.slice(1).replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
  function soundsLike(text, items, nameOf, limit = 6) {
    const ws = words(text); const ph = ws.map(phon);
    const out = [];
    items.forEach((it) => {
      const target = core(nameOf(it)); if (target.length < 3 || /^\d+$/.test(target)) return;
      const short = target.length < 4; // e.g. "LBI", "Plus": only an exact match counts
      const tSkel = skeleton(target);
      let best = 0, heard = '';
      for (let i = 0; i < ph.length; i++) {
        let cat = '';
        for (let j = i; j < Math.min(ph.length, i + 4); j++) {
          cat += ph[j]; if (cat.length > target.length * 1.8) break;
          if (short) { if (j === i && cat === target) { best = 1; heard = ws[i]; } continue; }
          if (cat.length < Math.max(3, target.length * 0.6)) continue; // too short a piece to judge
          const cSkel = skeleton(cat);
          let sc = Math.max(dice(cat, target), tSkel.length >= 3 && cSkel.length >= 3 ? 0.92 * dice(cSkel, tSkel) : 0);
          // Words like "security" or "alarms" alone say little about which dealer it is.
          if (ws.slice(i, j + 1).every((w) => GENERIC.has(w))) sc *= 0.7;
          if (sc > best) { best = sc; heard = ws.slice(i, j + 1).join(' '); }
        }
      }
      if (best >= 0.62) out.push({ item: it, score: best, heard, len: target.length });
    });
    return out.sort((a, b) => b.score - a.score || b.len - a.len).slice(0, limit);
  }

  // ---------- What we send the AI ----------
  const clean = (s) => String(s || '').replace(/[|\n\r]+/g, ' ').trim();
  function buildContext(pos, transcript, alternatives) {
    const db = Store.db;
    const byId = Object.fromEntries(db.customers.map((c) => [c.id, c]));
    const heardAll = [transcript || '', ...(alternatives || [])].join(' ');
    const likelyD = soundsLike(heardAll, db.customers, (c) => c.name);
    const likelyC = soundsLike(heardAll, [...db.customers.filter((c) => c.contactName).map((c) => ({ id: 'p:' + c.id, name: c.contactName, cid: c.id })),
      ...db.contacts.filter((x) => !x.left).map((x) => ({ id: x.id, name: x.name, cid: x.customerId }))], (x) => x.name);
    const hints = [];
    if (alternatives && alternatives.length) hints.push('OTHER WAYS THE PHONE HEARD THE NOTE (speech recognition guesses; use them to recognise names):\n' + alternatives.map((a) => '- ' + clean(a)).join('\n'));
    if (likelyD.length) hints.push('LIKELY DEALERS BY SOUND (the phone may have spelled French or English names wrongly; best match first):\n' + likelyD.map((m) => `${m.item.id} | ${clean(m.item.name)} | ${clean(m.item.city)} | heard as "${clean(m.heard)}"`).join('\n'));
    if (likelyC.length) hints.push('LIKELY CONTACTS BY SOUND:\n' + likelyC.map((m) => `${m.item.id} | ${clean(m.item.name)} | dealer ${m.item.cid} (${clean((byId[m.item.cid] || {}).name)}) | heard as "${clean(m.heard)}"`).join('\n'));
    const dealers = (hints.length ? hints.join('\n\n') + '\n\nALL DEALERS:\n' : '') + db.customers.map((c) => `${c.id} | ${clean(c.name)} | ${clean(c.city)}`).join('\n');
    const contacts = [
      ...db.customers.filter((c) => c.contactName).map((c) => `p:${c.id} | ${clean(c.contactName)} | main contact | ${c.id}`),
      ...db.contacts.filter((x) => !x.left).map((x) => `${x.id} | ${clean(x.name)} | ${clean(x.title)} | ${x.customerId}`),
    ].join('\n');
    let nearby = '';
    if (pos) {
      nearby = db.customers.filter(FS.hasGeo).map((c) => ({ c, km: FS.haversineKm(pos, c) })).sort((a, b) => a.km - b.km).slice(0, 6)
        .map((r) => `${r.c.id} | ${clean(r.c.name)} | ${clean(r.c.city)} | ${r.km < 1 ? Math.round(r.km * 1000) + ' m' : r.km.toFixed(1) + ' km'}`).join('\n');
    }
    const projects = db.projects.filter((p) => !['Won', 'Lost'].includes(p.stage)).slice(-300)
      .map((p) => `${p.id} | dealer ${p.customerId} (${clean((byId[p.customerId] || {}).name)}) | ${clean(p.name)} | ${p.stage}${p.amount ? ' | $' + p.amount : ''}`).join('\n');
    const d = new Date();
    return { today: FS.today(), weekday: d.toLocaleDateString('en-CA', { weekday: 'long' }), lang: G.Voice.getLang(), dealers, contacts, nearby, projects };
  }

  async function askAI(transcript, alternatives) {
    const pos = await getPosition();
    const body = { transcript, ...buildContext(pos, transcript, alternatives) };
    return G.Sync.callFunction('voice-update', body);
  }

  // ---------- Turn the AI answer into an editable plan ----------
  function toPlan(r, transcript) {
    const db = Store.db;
    const has = (id) => id && db.customers.some((c) => c.id === id);
    const dealerId = has(r.dealer && r.dealer.dealer_id) ? r.dealer.dealer_id : '';
    const v = r.visit || {};
    return {
      transcript, dealerId, heardAs: (r.dealer && r.dealer.heard_as) || '', confidence: (r.dealer && r.dealer.confidence) || 'low',
      visit: { on: !!v.log, type: v.type || 'In-person', date: v.date || FS.today(), outcome: v.summary || transcript, nextAction: v.next_action || '', nextFollowUp: v.follow_up_date || '' },
      projects: (r.projects || []).map((p) => {
        const ex = p.existing_project_id && db.projects.find((x) => x.id === p.existing_project_id);
        return { on: true, id: ex ? ex.id : null, exName: ex ? ex.name : '', customerId: has(p.dealer_id) ? p.dealer_id : '', name: p.name || '', product: p.products || '', amount: p.amount ?? null,
          stage: p.stage || 'Lead', closeDate: p.close_date || '', site: p.site || '', notes: p.notes || '', followUp: p.follow_up_date || '' };
      }),
      // To-dos: from the AI's list; an older AI function only gives "next step", so use that.
      todos: (Array.isArray(r.todos) ? r.todos : (v.next_action ? [{ text: v.next_action, dealer_id: null, due_date: v.follow_up_date }] : []))
        .filter((x) => x && String(x.text || '').trim()).map((x) => ({ on: true, text: x.text, customerId: has(x.dealer_id) ? x.dealer_id : '', due: x.due_date || '' })),
      contacts: (r.contact_changes || []).map((c) => ({ on: true, kind: c.kind, contactId: c.contact_id || '', name: c.name || '', title: c.title || '', phone: c.phone || '', email: c.email || '',
        from: has(c.from_dealer_id) ? c.from_dealer_id : '', to: has(c.to_dealer_id) ? c.to_dealer_id : '', toName: c.to_company_name || '', note: c.note || '', createAccount: !has(c.to_dealer_id) && !!c.to_company_name })),
      status: r.dealer_status && r.dealer_status !== 'unchanged' ? r.dealer_status : '', statusOn: !!(r.dealer_status && r.dealer_status !== 'unchanged'),
      questions: r.questions || [], readback: r.readback || '',
    };
  }

  // ---------- Save the plan ----------
  function apply(plan) {
    const db = Store.db;
    const snapshot = JSON.parse(JSON.stringify(db));
    const nameOf = (id) => ((db.customers.find((c) => c.id === id) || {}).name || '');
    const t = FS.today(), now = new Date().toISOString();
    const dealerId = plan.dealerId;
    const followUps = [];
    let count = 0;

    // Visit (also moves the dealer's last contact / follow-up / status)
    if (plan.visit.on && dealerId) {
      if (plan.visit.nextFollowUp) followUps.push(plan.visit.nextFollowUp);
      Store.logVisit({ customerId: dealerId, customerName: nameOf(dealerId), date: plan.visit.date || t, type: plan.visit.type, outcome: plan.visit.outcome,
        nextAction: plan.visit.nextAction, nextFollowUp: plan.visit.nextFollowUp || null, source: 'voice', setStatus: plan.statusOn && plan.status ? plan.status : undefined });
      count++;
    } else if (plan.statusOn && plan.status && dealerId) { Store.upsert('customers', { id: dealerId, status: plan.status }); count++; }

    // Projects
    plan.projects.filter((p) => p.on && String(p.name).trim()).forEach((p) => {
      const cid = p.customerId || dealerId; if (!cid) return;
      const rec = { customerId: cid, name: p.name, product: p.product, amount: p.amount === '' ? null : p.amount, stage: p.stage, closeDate: p.closeDate || null, site: p.site, followUp: p.followUp || null };
      if (p.id) { rec.id = p.id; const old = db.projects.find((x) => x.id === p.id); if (p.notes) rec.notes = [old && old.notes, `${t}: ${p.notes}`].filter(Boolean).join('\n'); }
      else rec.notes = p.notes;
      Store.upsert('projects', rec); count++;
      if (p.followUp) Store.commit((d) => { const c = d.customers.find((x) => x.id === cid); if (c && (!c.nextFollowUp || c.nextFollowUp < t || p.followUp < c.nextFollowUp)) { c.nextFollowUp = p.followUp; c.updatedAt = now; } });
    });

    // To-dos
    (plan.todos || []).filter((x) => x.on && String(x.text).trim()).forEach((x) => {
      G.Todo.add({ text: x.text, customerId: x.customerId || dealerId || null, due: x.due || null, source: 'voice' }); count++;
    });

    // Contacts
    const leave = (d, cid, contactId, name, when) => {
      const c = d.customers.find((x) => x.id === cid);
      if (contactId && contactId.startsWith('p:') && c) {
        d.contacts.push({ id: FS.uid(), customerId: c.id, name: c.contactName, email: c.contactEmail, phone: c.contactPhone, left: true, leftDate: when, notes: `Left the company (${when}).`, createdAt: now, updatedAt: now });
        c.contactName = ''; c.contactEmail = ''; c.contactPhone = ''; c.updatedAt = now;
        return { email: undefined, phone: undefined };
      }
      const x = d.contacts.find((k) => k.id === contactId) || d.contacts.find((k) => k.customerId === cid && FS.norm(k.name) === FS.norm(name));
      if (x) { x.left = true; x.leftDate = when; x.notes = [x.notes, `Left the company (${when}).`].filter(Boolean).join('\n'); x.updatedAt = now; return x; }
      if (c) { c.notes = [c.notes, `${when}: ${name} left the company.`].filter(Boolean).join('\n'); c.updatedAt = now; }
      return null;
    };
    plan.contacts.filter((k) => k.on && String(k.name).trim()).forEach((k) => {
      Store.commit((d) => {
        if (k.kind === 'new_contact') {
          const cid = k.to || k.from || dealerId; if (!cid) return;
          d.contacts.push({ id: FS.uid(), customerId: cid, name: k.name, title: k.title, phone: k.phone, email: k.email, notes: k.note, createdAt: now, updatedAt: now });
        } else if (k.kind === 'update_contact') {
          if (k.contactId.startsWith('p:')) { const c = d.customers.find((x) => 'p:' + x.id === k.contactId); if (c) { if (k.phone) c.contactPhone = k.phone; if (k.email) c.contactEmail = k.email; c.updatedAt = now; } }
          else { const x = d.contacts.find((y) => y.id === k.contactId); if (x) { if (k.title) x.title = k.title; if (k.phone) x.phone = k.phone; if (k.email) x.email = k.email; if (k.note) x.notes = [x.notes, k.note].filter(Boolean).join('\n'); x.updatedAt = now; } }
        } else if (k.kind === 'left_company' || k.kind === 'moved_company') {
          const fromId = k.from || (k.kind === 'left_company' ? dealerId : '');
          const old = fromId ? leave(d, fromId, k.contactId, k.name, t) : null;
          if (k.kind === 'moved_company') {
            let toId = k.to;
            if (!toId && k.createAccount && k.toName) {
              toId = FS.uid();
              d.customers.push({ id: toId, name: k.toName, status: 'Prospect', priority: 'C', notes: `Added from a voice note (${t}): ${k.name} works here now.`, createdAt: now, updatedAt: now });
            }
            if (toId) d.contacts.push({ id: FS.uid(), customerId: toId, name: k.name, title: k.title, phone: k.phone || (old && old.phone) || '', email: k.email || '',
              notes: [`Previously at ${fromId ? (d.customers.find((x) => x.id === fromId) || {}).name : 'another company'} (moved ${t}).`, k.note].filter(Boolean).join(' '), createdAt: now, updatedAt: now });
          }
        }
      });
      count++;
    });
    return { snapshot, count, followUps };
  }

  // ---------- Hands-free "yes / no" ----------
  function listenYesNo(onAnswer) {
    if (!SR) return () => {};
    const r = new SR(); r.lang = G.Voice.getLang(); r.continuous = false; r.interimResults = false;
    let done = false;
    r.onresult = (e) => {
      const s = ' ' + Array.from(e.results).map((x) => x[0].transcript).join(' ').toLowerCase() + ' ';
      if (/\b(yes|yeah|yep|save|ok|okay|oui|ouais|correct|parfait|enregistre)\b/.test(s)) { done = true; onAnswer('yes'); }
      else if (/\b(no|nope|cancel|non|annule)\b/.test(s)) { done = true; onAnswer('no'); }
    };
    r.onend = () => { if (!done) onAnswer(null); };
    try { r.start(); } catch (e) { /* ignore */ }
    return () => { done = true; try { r.abort(); } catch (e) { /* ignore */ } };
  }
  function speakThen(text, then) {
    if (!G.speechSynthesis) return then && then();
    G.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = G.Voice.getLang();
    u.onend = () => then && then(); u.onerror = () => then && then();
    G.speechSynthesis.speak(u);
  }

  // ---------- The Talk screen ----------
  function TalkModal({ onClose, queued, car }) {
    const db = G.UIX.useDB();
    const [step, setStep] = useState(queued ? 'thinking' : 'listen'); // listen | thinking | review | saved | queued | error
    const [text, setText] = useState(queued ? queued.text : '');
    const [interim, setInterim] = useState('');
    const [on, setOn] = useState(false);
    const [plan, setPlan] = useState(null);
    const [err, setErr] = useState('');
    const [saved, setSaved] = useState(null);
    const [lang, setLangS] = useState(G.Voice.getLang());
    const alts = useRef([]);
    const qid = useRef(queued ? queued.id : null), rec = useRef(null), textRef = useRef(text), stopYN = useRef(() => {}), cancelled = useRef(false);
    textRef.current = text;

    const close = () => { cancelled.current = true; stopYN.current(); if (rec.current) { rec.current.onend = null; try { rec.current.abort(); } catch (e) { /* */ } } G.Voice.stopSpeaking(); onClose(); };
    useEffect(() => { if (queued) process(queued.text, queued.id); else if (SR) start(); return () => { cancelled.current = true; stopYN.current(); if (rec.current) { rec.current.onend = null; try { rec.current.abort(); } catch (e) { /* */ } } }; }, []);

    function start() {
      if (!SR) return;
      const r = new SR(); r.lang = G.Voice.getLang(); r.continuous = true; r.interimResults = true; r.maxAlternatives = 3;
      r.onresult = (e) => {
        let fin = '', mid = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i], s = res[0].transcript;
          if (res.isFinal) {
            fin += s;
            // Keep the phone's other guesses: they often spell names better.
            for (let k = 1; k < res.length; k++) if (res[k] && res[k].transcript && res[k].transcript.trim() !== s.trim()) alts.current.push(res[k].transcript.trim());
          } else mid += s;
        }
        setInterim(mid);
        if (fin.trim()) setText((o) => (o ? o.trim() + ' ' : '') + fin.trim());
      };
      r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErr('Microphone is blocked. Allow microphone access for this site in your browser settings.'); };
      // When the browser stops listening (pause or Stop), send what was said.
      r.onend = () => { setOn(false); setInterim(''); rec.current = null; if (!cancelled.current && textRef.current.trim()) process(textRef.current.trim()); };
      rec.current = r;
      try { r.start(); setOn(true); setErr(''); } catch (e) { setOn(false); }
    }
    const stop = () => { if (rec.current) rec.current.stop(); else if (text.trim()) process(text.trim()); };
    // Switching language while listening restarts the microphone in the new language and keeps what was said.
    function switchLang(l) {
      if (l === lang) return;
      try { localStorage.setItem('fscc.voiceLang', l); } catch (e) { /* ignore */ }
      setLangS(l);
      if (rec.current) { rec.current.onend = null; try { rec.current.abort(); } catch (e) { /* */ } rec.current = null; setOn(false); setInterim(''); setTimeout(start, 250); }
    }

    async function process(t, queueId) {
      setStep('thinking'); setErr('');
      if (!G.Sync.signedIn) { setErr('Voice updates need cloud sign-in. Sign in under Data & settings.'); setStep('error'); return; }
      try {
        const res = await askAI(t, alts.current.slice(-12));
        if (cancelled.current) return;
        const p = toPlan(res.result, t);
        setPlan(p); setStep('review');
        const conf = p.dealerId ? '' : (G.Voice.getLang().startsWith('fr') ? 'Je n’ai pas trouvé le client. ' : 'I could not tell which dealer. ');
        const ask = G.Voice.getLang().startsWith('fr') ? ' Dites oui pour enregistrer, ou non pour annuler.' : ' Say yes to save, or no to cancel.';
        if (p.dealerId) speakThen(p.readback + ask, () => { if (cancelled.current) return; stopYN.current = listenYesNo((a) => { if (a === 'yes') save(p); else if (a === 'no') close(); }); });
        else speakThen(conf + (p.questions[0] || ''));
      } catch (e) {
        if (cancelled.current) return;
        if (e && e.offline) {
          if (!queueId && !qid.current) { const id = FS.uid(); writeQ([...readQ(), { id, text: t, at: new Date().toISOString() }]); }
          setStep('queued'); speakThen(G.Voice.getLang().startsWith('fr') ? 'Pas de réseau. Note gardée pour plus tard.' : 'No signal. Your note is saved for later.');
        } else { setErr((e && e.message) || 'Something went wrong.'); setStep('error'); }
      }
    }

    function save(p) {
      stopYN.current(); G.Voice.stopSpeaking();
      const cur = p || plan;
      if (!cur.dealerId && (cur.visit.on || cur.statusOn || cur.projects.some((x) => x.on && !x.customerId))) { setErr('Choose the dealer first.'); return; }
      const r = apply(cur);
      if (qid.current) { writeQ(readQ().filter((q) => q.id !== qid.current)); qid.current = null; }
      setSaved(r); setStep('saved');
      if (car) setTimeout(() => { if (!cancelled.current) onClose(); }, 6000); // back to the big buttons
      speakThen(G.Voice.getLang().startsWith('fr') ? 'Enregistré.' : 'Saved.');
    }
    const undo = () => { if (saved) { Store.replaceAll(saved.snapshot); G.UIX.UI.toast('Voice update undone'); } onClose(); };
    const upd = (patch) => setPlan((o) => ({ ...o, ...patch }));
    const updV = (patch) => setPlan((o) => ({ ...o, visit: { ...o.visit, ...patch } }));
    const updArr = (key, i, patch) => setPlan((o) => ({ ...o, [key]: o[key].map((x, j) => j === i ? { ...x, ...patch } : x) }));
    const inp = (val, f, type) => ({ value: val ?? '', onInput: (e) => f(type === 'num' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) });
    const dealers = db.customers.slice().sort((a, b) => a.name.localeCompare(b.name));
    const dealerSelect = (val, f, blankLabel) => html`<select value=${val} onChange=${(e) => f(e.target.value)}><option value="">${blankLabel || '— Choose dealer —'}</option>${dealers.map((c) => html`<option value=${c.id}>${c.name}${c.city ? ' — ' + c.city : ''}</option>`)}</select>`;
    const nameOf = (id) => ((db.customers.find((c) => c.id === id) || {}).name || '?');

    let body, footer;
    if (step === 'listen') {
      body = html`<div class="talk">
        ${SR ? html`<button class=${'talkbtn' + (on ? ' on' : '')} onClick=${on ? stop : start}>${on ? '■' : '🎙'}</button>
          <div class="muted center-t">${on ? 'Listening… talk naturally, then pause or tap ■' : 'Tap to talk'}</div>
          <div class="seg" role="group" aria-label="Speech language">
            <button class=${lang === 'en-CA' ? 'on' : ''} onClick=${() => switchLang('en-CA')}>English</button>
            <button class=${lang === 'fr-CA' ? 'on' : ''} onClick=${() => switchLang('fr-CA')}>Français</button></div>
          <div class="small muted center-t">Tip: pick the language you'll mostly speak. Names in the other language are matched by sound.</div>`
          : html`<p class="muted">This browser can't listen directly. Tap in the box and use the 🎤 on your keyboard to dictate.</p>`}
        <textarea rows="4" placeholder="e.g. Just left Alarme Mirabel, met Jean. They're quoting 40 cameras for a school in Saint-Jérôme, about 30K, closing in March. Follow up in two weeks." value=${text + (interim ? ' ' + interim : '')} onInput=${(e) => setText(e.target.value)}></textarea>
        ${err && html`<div class="err">${err}</div>`}</div>`;
      footer = html`<span class="spacer"></span><button onClick=${close}>Cancel</button><button class="primary" disabled=${!text.trim()} onClick=${() => { cancelled.current = false; if (rec.current) { rec.current.onend = null; rec.current.abort(); rec.current = null; setOn(false); } process(text.trim()); }}>Update</button>`;
    } else if (step === 'thinking') {
      body = html`<div class="talk"><div class="spinner"></div><div class="muted center-t">Working out what to update…</div><blockquote class="small">${text}</blockquote></div>`;
      footer = html`<span class="spacer"></span><button onClick=${close}>Cancel</button>`;
    } else if (step === 'queued') {
      body = html`<div class="talk"><div style="font-size:42px">📶</div><p><strong>No signal.</strong> Your note is saved on this phone. When you're back online, open Today and tap <em>Process</em> on the waiting note.</p></div>`;
      footer = html`<span class="spacer"></span><button class="primary" onClick=${close}>OK</button>`;
    } else if (step === 'error') {
      body = html`<div class="talk"><div class="err">${err}</div><blockquote class="small">${text}</blockquote></div>`;
      footer = html`<span class="spacer"></span><button onClick=${close}>Close</button><button class="primary" onClick=${() => process(text)}>Try again</button>`;
    } else if (step === 'saved') {
      body = html`<div class="talk"><div style="font-size:42px">✅</div><p><strong>Saved.</strong> ${saved.count} update${saved.count === 1 ? '' : 's'} made${plan.dealerId ? ' for ' + nameOf(plan.dealerId).replace(/\.$/, '') : ''}.</p></div>`;
      footer = html`<button class="danger" onClick=${undo}>Undo</button><span class="spacer"></span>${plan.dealerId && html`<button onClick=${() => { onClose(); G.UIX.UI.openCustomer(plan.dealerId); }}>Open account</button>`}<button class="primary" onClick=${onClose}>Done</button>`;
    } else if (step === 'review' && plan) {
      const p = plan;
      body = html`<div class="stack talk-review">
        <div class="card soft"><label class="f">Dealer ${p.heardAs && html`<span class="small muted">(heard “${p.heardAs}”)</span>`}${dealerSelect(p.dealerId, (v) => upd({ dealerId: v }))}</label>
          ${(!p.dealerId || p.confidence === 'low') && html`<div class="warn-t small">⚠ Please check the dealer.</div>`}</div>
        ${p.questions.length > 0 && html`<div class="card soft warnbox"><strong>Not sure about:</strong><ul>${p.questions.map((q) => html`<li>${q}</li>`)}</ul></div>`}
        <div class="card soft"><label class="chk"><input type="checkbox" checked=${p.visit.on} onChange=${(e) => updV({ on: e.target.checked })} /> <strong>Log activity</strong></label>
          ${p.visit.on && html`<div class="form">
            <label class="f">Type<select value=${p.visit.type} onChange=${(e) => updV({ type: e.target.value })}>${FS.VISIT_TYPES.map((t) => html`<option>${t}</option>`)}</select></label>
            <label class="f">Date<input type="date" ...${inp(p.visit.date, (v) => updV({ date: v }))} /></label>
            <label class="f full">What happened<textarea rows="3" ...${inp(p.visit.outcome, (v) => updV({ outcome: v }))}></textarea></label>
            <label class="f">Next step<input ...${inp(p.visit.nextAction, (v) => updV({ nextAction: v }))} /></label>
            <label class="f">Follow-up<input type="date" ...${inp(p.visit.nextFollowUp, (v) => updV({ nextFollowUp: v }))} /></label></div>`}</div>
        ${p.statusOn !== undefined && p.status && html`<div class="card soft"><label class="chk"><input type="checkbox" checked=${p.statusOn} onChange=${(e) => upd({ statusOn: e.target.checked })} /> Set status to <strong>${p.status}</strong></label></div>`}
        ${p.projects.map((pr, i) => html`<div class="card soft"><label class="chk"><input type="checkbox" checked=${pr.on} onChange=${(e) => updArr('projects', i, { on: e.target.checked })} /> <strong>${pr.id ? 'Update project: ' + pr.exName : 'New project'}</strong></label>
          ${pr.on && html`<div class="form">
            <label class="f full">Name<input ...${inp(pr.name, (v) => updArr('projects', i, { name: v }))} /></label>
            ${pr.customerId && pr.customerId !== p.dealerId && html`<label class="f full">With dealer${dealerSelect(pr.customerId, (v) => updArr('projects', i, { customerId: v }))}</label>`}
            <label class="f">Products<input ...${inp(pr.product, (v) => updArr('projects', i, { product: v }))} /></label>
            <label class="f">Amount (CAD)<input type="number" ...${inp(pr.amount, (v) => updArr('projects', i, { amount: v }), 'num')} /></label>
            <label class="f">Stage<select value=${pr.stage} onChange=${(e) => updArr('projects', i, { stage: e.target.value })}>${FS.STAGES.map((s) => html`<option>${s}</option>`)}</select></label>
            <label class="f">Expected close<input type="date" ...${inp(pr.closeDate, (v) => updArr('projects', i, { closeDate: v }))} /></label>
            <label class="f">Follow-up reminder<input type="date" ...${inp(pr.followUp, (v) => updArr('projects', i, { followUp: v }))} /></label>
            <label class="f">Site / end user<input ...${inp(pr.site, (v) => updArr('projects', i, { site: v }))} /></label>
            ${pr.notes && html`<label class="f full">Notes<input ...${inp(pr.notes, (v) => updArr('projects', i, { notes: v }))} /></label>`}</div>`}</div>`)}
        ${(p.todos.length > 0 || p.dealerId) && html`<div class="card soft"><div class="row"><strong class="grow">✅ To do</strong><button class="sm" onClick=${() => upd({ todos: [...p.todos, { on: true, text: '', customerId: '', due: '' }] })}>+ Add</button></div>
          ${p.todos.map((x, i) => html`<div class="talk-todo"><label class="chk"><input type="checkbox" checked=${x.on} onChange=${(e) => updArr('todos', i, { on: e.target.checked })} /></label>
            <div class="grow form" style="gap:6px">
              <input class="full" placeholder="What to do" ...${inp(x.text, (v) => updArr('todos', i, { text: v }))} />
              <label class="f">For dealer${dealerSelect(x.customerId || p.dealerId, (v) => updArr('todos', i, { customerId: v }))}</label>
              <label class="f">Due${html`<input type="date" ...${inp(x.due, (v) => updArr('todos', i, { due: v }))} />`}</label></div></div>`)}
          ${!p.todos.length && html`<div class="small muted">No to-dos heard. Tap + Add to add one.</div>`}</div>`}
        ${p.contacts.map((k, i) => html`<div class="card soft"><label class="chk"><input type="checkbox" checked=${k.on} onChange=${(e) => updArr('contacts', i, { on: e.target.checked })} />
          <strong>${{ new_contact: 'New contact', update_contact: 'Update contact', left_company: 'Contact left', moved_company: 'Contact moved' }[k.kind]}: ${k.name}</strong></label>
          ${k.on && html`<div class="form">
            ${(k.kind === 'left_company' || k.kind === 'moved_company') && html`<label class="f full">Left${dealerSelect(k.from, (v) => updArr('contacts', i, { from: v }), '— Unknown —')}</label>`}
            ${k.kind === 'moved_company' && html`<label class="f full">Now at${dealerSelect(k.to, (v) => updArr('contacts', i, { to: v, createAccount: !v && !!k.toName }), k.toName ? `— New account: ${k.toName} —` : '— Choose —')}</label>
              ${!k.to && k.toName && html`<label class="chk full small"><input type="checkbox" checked=${k.createAccount} onChange=${(e) => updArr('contacts', i, { createAccount: e.target.checked })} /> Add “${k.toName}” as a new prospect account</label>`}`}
            ${k.kind === 'new_contact' && html`<label class="f full">At${dealerSelect(k.to || k.from || p.dealerId, (v) => updArr('contacts', i, { to: v }))}</label>`}
            ${k.kind !== 'left_company' && html`<label class="f">Title<input ...${inp(k.title, (v) => updArr('contacts', i, { title: v }))} /></label>
              <label class="f">Phone<input ...${inp(k.phone, (v) => updArr('contacts', i, { phone: v }))} /></label>
              <label class="f">Email<input ...${inp(k.email, (v) => updArr('contacts', i, { email: v }))} /></label>`}</div>`}</div>`)}
        ${!p.visit.on && !p.projects.length && !p.contacts.length && !p.todos.length && !p.status && html`<div class="muted">The AI didn't find anything to update. Edit the note below and try again, or log it by hand.</div>`}
        <details><summary class="small muted">What you said</summary><blockquote class="small">${p.transcript}</blockquote></details>
        ${err && html`<div class="err">${err}</div>`}</div>`;
      footer = html`<button onClick=${() => { stopYN.current(); G.Voice.stopSpeaking(); setStep('listen'); setPlan(null); alts.current = []; cancelled.current = false; }}>Redo</button><span class="spacer"></span><button onClick=${close}>Cancel</button><button class="primary" onClick=${() => save()}>Save</button>`;
    }
    return html`<${G.UIX.Modal} title="🎙 Talk" wide=${step === 'review'} onClose=${close} footer=${footer}>${body}<//>`;
  }

  // Banner on Today for notes recorded without signal.
  function QueueBanner() {
    const q = useQueue();
    if (!q.length) return null;
    return html`<div class="card warnbox" style="margin-bottom:14px"><h3>🎙 ${q.length} voice note${q.length === 1 ? '' : 's'} waiting</h3>
      ${q.map((n) => html`<div class="row" style="margin-top:6px"><span class="small grow">${FS.fmtDay(n.at.slice(0, 10))}: “${n.text.slice(0, 120)}${n.text.length > 120 ? '…' : ''}”</span>
        <button class="sm primary" onClick=${() => G.UIX.UI.modal({ kind: 'talk', queued: n })}>Process</button>
        <button class="sm ghost" onClick=${() => { if (confirm('Delete this voice note?')) writeQ(readQ().filter((x) => x.id !== n.id)); }}>✕</button></div>`)}</div>`;
  }

  G.Talk = { TalkModal, QueueBanner, toPlan, apply, buildContext, soundsLike, phon, open: () => G.UIX.UI.modal({ kind: 'talk' }) };
})(window);
