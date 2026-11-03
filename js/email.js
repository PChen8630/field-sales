/* Email: templates with merge fields, a daily "emails to send" list, compose window,
   and holiday / bulk emails (one by one, or exported for Outlook mail merge).
   Emails open in the device's own mail app (mailto:), so you always review and press Send yourself. */
(function (G) {
  'use strict';
  const { html, useState, useMemo } = htmPreact;
  const FS = G.FS, Store = FS.Store;
  const { useDB, UI, Modal, PrioTag, StatusTag, ResTag } = G.UIX;

  // ---------- Templates ----------
  const DEFAULT_TEMPLATES = [
    { id: 'followup', name: 'Follow-up after a visit', kind: 'followup',
      en: { subject: 'Following up – {company}', body: 'Hi {first_name},\n\nThanks again for your time on {last_contact_date}.\n{next_action_sentence}\nLet me know if you have any questions, or if there is anything else I can help with.\n\nBest regards,\n{signature}' },
      fr: { subject: 'Suivi – {company}', body: 'Bonjour {first_name},\n\nMerci encore pour votre temps le {last_contact_date}.\n{next_action_sentence}\nN\'hésitez pas à me contacter si vous avez des questions ou si je peux vous aider avec autre chose.\n\nCordialement,\n{signature}' } },
    { id: 'checkin', name: 'Keep in touch', kind: 'checkin',
      en: { subject: 'Checking in – Luminys', body: 'Hi {first_name},\n\nIt has been a little while since we last connected, so I wanted to check in and see how things are going at {company}.\n\nAre there any upcoming projects I can help with? I am happy to drop by, send pricing, or set up a demo of our latest cameras and recorders.\n\nBest regards,\n{signature}' },
      fr: { subject: 'Des nouvelles – Luminys', body: 'Bonjour {first_name},\n\nCela fait un moment que nous nous sommes parlé, alors je voulais prendre de vos nouvelles et voir comment ça va chez {company}.\n\nAvez-vous des projets à venir pour lesquels je pourrais vous aider? Je peux passer vous voir, vous envoyer des prix ou organiser une démo de nos nouvelles caméras et enregistreurs.\n\nCordialement,\n{signature}' } },
    { id: 'holiday', name: 'Holiday greetings', kind: 'bulk',
      en: { subject: 'Happy Holidays from Luminys', body: 'Hi {first_name},\n\nAs {year} comes to a close, I want to thank you and the team at {company} for your business and partnership this year.\n\nWishing you a safe and happy holiday season, and all the best for {next_year}!\n\nWarm regards,\n{signature}' },
      fr: { subject: 'Joyeuses Fêtes de la part de Luminys', body: 'Bonjour {first_name},\n\nAlors que {year} tire à sa fin, je tiens à vous remercier, vous et l\'équipe de {company}, pour votre confiance et notre partenariat cette année.\n\nJe vous souhaite de très joyeuses Fêtes et une excellente année {next_year}!\n\nAu plaisir,\n{signature}' } },
    { id: 'newyear', name: 'New year / kick-off', kind: 'bulk',
      en: { subject: 'Happy New Year – let\'s make {year} a great one', body: 'Hi {first_name},\n\nHappy New Year! I hope you had a good break.\n\nI would love to hear what projects {company} has lined up for {year}, and how Luminys can help. Let me know a good time for a quick call or visit.\n\nBest regards,\n{signature}' },
      fr: { subject: 'Bonne année – faisons de {year} une belle année', body: 'Bonjour {first_name},\n\nBonne année! J\'espère que vous avez passé de belles Fêtes.\n\nJ\'aimerais savoir quels projets {company} prévoit pour {year}, et comment Luminys peut vous aider. Dites-moi quand serait un bon moment pour un appel ou une visite.\n\nCordialement,\n{signature}' } },
  ];
  const templates = (db) => (db.settings.templates && db.settings.templates.length ? db.settings.templates : DEFAULT_TEMPLATES);
  const saveTemplates = (list) => Store.commit((d) => { d.settings.templates = list; });
  const defaultSignature = (db) => [db.settings.ownerName || 'Your name', 'Regional Sales Manager – Canada East', 'Luminys'].join('\n');
  const signature = (db) => db.settings.signature || defaultSignature(db);

  const langOf = (c) => c.lang || (c.province === 'QC' ? 'fr' : 'en');
  const firstName = (c) => { const n = String(c.contactName || '').trim().split(/\s+/)[0]; return n && !/^(info|admin|sales|ventes|office|bureau)$/i.test(n) ? n.replace(/^\w/, (x) => x.toUpperCase()) : ''; };
  function fields(c, db, lang) {
    const t = FS.today(), y = Number(t.slice(0, 4));
    const visits = db.visits.filter((v) => v.customerId === c.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const last = visits[0];
    const act = visits.find((v) => v.nextAction);
    const date = (s) => s ? FS.parseISO(s).toLocaleDateString(lang === 'fr' ? 'fr-CA' : 'en-CA', { month: 'long', day: 'numeric' }) : '';
    const fn = firstName(c);
    return {
      first_name: fn || (lang === 'fr' ? '' : 'there'),
      contact_name: c.contactName || '',
      company: c.name, city: c.city || '',
      last_contact_date: date(last && last.date),
      last_notes: last && last.outcome ? last.outcome.slice(0, 300) : '',
      next_action: act ? act.nextAction : '',
      next_action_sentence: act ? (lang === 'fr' ? `Comme convenu, voici le suivi concernant : ${act.nextAction.replace(/^\w/, (x) => x.toLowerCase())}.\n` : `As promised, here is my follow-up on: ${act.nextAction.replace(/^\w/, (x) => x.toLowerCase())}.\n`) : '',
      my_name: db.settings.ownerName || '', signature: signature(db), year: String(y), next_year: String(y + 1),
    };
  }
  // Fill {fields}. A line whose only content was an empty field is dropped; "Bonjour ," is tidied.
  function fill(text, f) {
    return String(text || '').split('\n').map((line) => {
      const had = /\{\w+\}/.test(line);
      const out = line.replace(/\{(\w+)\}/g, (m, k) => (k in f ? f[k] : m));
      return had && !out.trim() ? null : out;
    }).filter((l) => l !== null).join('\n').replace(/^(Bonjour|Hi) ,/m, (m, w) => w + ',').replace(/\n{3,}/g, '\n\n').trim();
  }
  function draft(c, db, tpl, lang) {
    const l = lang || langOf(c), v = tpl[l] || tpl.en, f = fields(c, db, l);
    return { to: c.contactEmail || '', subject: fill(v.subject, f), body: fill(v.body, f), lang: l };
  }
  const mailto = (d) => `mailto:${encodeURIComponent(d.to).replace(/%40/g, '@')}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body.replace(/\n/g, '\r\n'))}`;
  function logSent(c, subject, followDays) {
    Store.logVisit({ customerId: c.id, customerName: c.name, date: FS.today(), type: 'Email', outcome: 'Email sent: ' + subject, nextFollowUp: followDays ? FS.addDays(FS.today(), followDays) : '' });
  }

  // ---------- Compose (one dealer) ----------
  function Compose({ customerId, templateId, onClose }) {
    const db = useDB();
    const c = db.customers.find((x) => x.id === customerId);
    const list = templates(db);
    const [tid, setTid] = useState(templateId || list[0].id);
    const [lang, setLang] = useState(langOf(c || {}));
    const tpl = list.find((t) => t.id === tid) || list[0];
    const [d, setD] = useState(() => draft(c, db, tpl, lang));
    const [opened, setOpened] = useState(false);
    const [follow, setFollow] = useState(14);
    if (!c) return null;
    const re = (t, l) => setD(draft(c, db, list.find((x) => x.id === t) || list[0], l));
    const emails = [c.contactEmail, ...db.contacts.filter((x) => x.customerId === c.id).map((x) => x.email)].filter(Boolean);
    return html`<${Modal} title=${'Email ' + c.name} onClose=${onClose} footer=${opened
      ? html`<span class="small" style="margin-right:auto">Did you send it?</span><button onClick=${onClose}>No</button><button class="primary" onClick=${() => { logSent(c, d.subject, follow); UI.toast('Logged: email to ' + c.name); onClose(); }}>Yes, log it</button>`
      : html`<span class="spacer"></span><button onClick=${onClose}>Cancel</button><a class=${'btn primary' + (d.to ? '' : ' disabled')} href=${d.to ? mailto(d) : undefined} onClick=${() => d.to && setOpened(true)}>✉ Open in email app</a>`}>
      <div class="form">
        <label class="f">Template<select value=${tid} onChange=${(e) => { setTid(e.target.value); re(e.target.value, lang); }}>${list.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
        <label class="f">Language<select value=${lang} onChange=${(e) => { setLang(e.target.value); re(tid, e.target.value); }}><option value="en">English</option><option value="fr">Français</option></select></label>
        <label class="f full">To<input list="em-to" value=${d.to} onInput=${(e) => setD({ ...d, to: e.target.value })} placeholder="No email on file, so type one" /><datalist id="em-to">${emails.map((e) => html`<option value=${e} />`)}</datalist></label>
        <label class="f full">Subject<input value=${d.subject} onInput=${(e) => setD({ ...d, subject: e.target.value })} /></label>
        <label class="f full">Message<textarea style="min-height:220px" value=${d.body} onInput=${(e) => setD({ ...d, body: e.target.value })}></textarea></label>
        <label class="f">After sending, follow up in<select value=${follow} onChange=${(e) => setFollow(Number(e.target.value))}><option value="0">No follow-up</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option><option value="90">3 months</option></select></label>
        <div class="small muted" style="align-self:end">Opens in Outlook or your phone's mail app. Check it, then press Send there.</div>
      </div><//>`;
  }

  // ---------- Who to email ----------
  function queue(db) {
    const t = FS.today(), soon = FS.addDays(t, 1);
    const keep = { A: db.settings.keepA || 45, B: db.settings.keepB || 90, C: db.settings.keepC || 180 };
    const live = db.customers.filter((c) => c.status !== 'Inactive' && (!c.bizStatus || c.bizStatus === 'Active') && !(c.emailSnooze && c.emailSnooze > t));
    const follow = live.filter((c) => c.nextFollowUp && c.nextFollowUp <= soon)
      .sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp)).map((c) => ({ c, why: c.nextFollowUp < t ? `Follow-up overdue since ${FS.fmtDate(c.nextFollowUp)}` : 'Follow-up due', tpl: 'followup' }));
    const fIds = new Set(follow.map((r) => r.c.id));
    const checkin = live.filter((c) => !fIds.has(c.id)).map((c) => {
      const last = c.lastContact || c.lastVisit; const days = last ? FS.daysBetween(last, t) : null; const lim = keep[c.priority || 'C'];
      return { c, days, lim };
    }).filter((r) => r.days === null ? r.c.priority === 'A' || r.c.priority === 'B' : r.days >= r.lim)
      .sort((a, b) => (a.c.priority || 'C').localeCompare(b.c.priority || 'C') || (b.days ?? 1e9) - (a.days ?? 1e9))
      .slice(0, 25).map((r) => ({ c: r.c, why: r.days === null ? 'No contact on record' : `No contact in ${r.days} days`, tpl: 'checkin' }));
    return { follow, checkin };
  }
  const snooze = (c, days) => Store.upsert('customers', { id: c.id, emailSnooze: FS.addDays(FS.today(), days) });

  function QueueList({ rows, title, empty }) {
    return html`<div class="card"><h2 style="margin-top:0">${title} (${rows.length})</h2>
      ${!rows.length && html`<div class="empty">${empty}</div>`}
      ${rows.map((r) => html`<div class="list-item" style="flex-wrap:wrap">
        <div style="flex:1;min-width:180px"><a style="cursor:pointer;font-weight:600" onClick=${() => UI.openCustomer(r.c.id)}>${r.c.name}</a> <${PrioTag} p=${r.c.priority} />
          <div class="small muted">${r.why} · ${r.c.contactName || 'no contact name'}${r.c.contactEmail ? '' : ' · ⚠ no email on file'}</div></div>
        <div class="row" style="flex-wrap:nowrap">
          <button class="sm" title="Hide for a week" onClick=${() => snooze(r.c, 7)}>Later</button>
          <button class="sm primary" onClick=${() => UI.modal({ kind: 'email', customerId: r.c.id, templateId: r.tpl })}>✉ Write</button>
        </div></div>`)}</div>`;
  }

  // ---------- Holiday / bulk ----------
  function Bulk() {
    const db = useDB();
    const list = templates(db);
    const [tid, setTid] = useState((list.find((t) => t.kind === 'bulk') || list[0]).id);
    const [f, setF] = useState({ region: '', prio: '', status: 'buyers', prov: '' });
    const [skip, setSkip] = useState({});
    const [sent, setSent] = useState({});
    const tpl = list.find((t) => t.id === tid) || list[0];
    const y = Number(FS.today().slice(0, 4));
    const rows = useMemo(() => db.customers.filter((c) => c.contactEmail && /@/.test(c.contactEmail) && c.status !== 'Inactive' && (!c.bizStatus || c.bizStatus === 'Active')
      && (!f.region || c.regionId === f.region) && (!f.prio || c.priority === f.prio) && (!f.prov || c.province === f.prov)
      && (f.status === 'all' || (f.status === 'buyers' ? (FS.posOf(c, y) > 0 || FS.posOf(c, y - 1) > 0 || c.status === 'Active Customer') : c.status === f.status)))
      .sort((a, b) => a.name.localeCompare(b.name)), [db, f]);
    const chosen = rows.filter((c) => !skip[c.id]);
    const noEmail = db.customers.filter((c) => !c.contactEmail).length;
    const exportCsv = () => {
      const out = chosen.map((c) => { const d = draft(c, db, tpl); return [d.to, firstName(c), c.name, c.province || '', d.lang, d.subject, d.body.replace(/\n/g, '\r\n')]; });
      FS.download(`${tpl.id}-emails-${FS.today()}.csv`, FS.toCSV(['Email', 'FirstName', 'Company', 'Province', 'Language', 'Subject', 'Body'], out), 'text/csv');
    };
    const logAll = () => {
      if (!confirm(`Log "${tpl.name}" as sent to ${chosen.length} dealers?`)) return;
      chosen.forEach((c) => Store.logVisit({ customerId: c.id, customerName: c.name, date: FS.today(), type: 'Email', outcome: 'Email sent: ' + draft(c, db, tpl).subject }));
      UI.toast(`Logged ${chosen.length} emails`);
    };
    const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
    return html`<div class="card"><h2 style="margin-top:0">Holiday & group emails</h2>
      <p class="small muted" style="margin-top:0">Each dealer gets their own personal email in their language. Send them one by one (tap ✉), or export the list for Outlook mail merge to send them all at once.</p>
      <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        <label class="f">Template<select value=${tid} onChange=${(e) => setTid(e.target.value)}>${list.map((t) => html`<option value=${t.id}>${t.name}</option>`)}</select></label>
        <label class="f">Who<select value=${f.status} onChange=${set('status')}><option value="buyers">Buying dealers (POS ${y - 1}/${y} or Active)</option><option value="all">Everyone with an email</option>${FS.STATUSES.map((s) => html`<option>${s}</option>`)}</select></label>
        <label class="f">Region<select value=${f.region} onChange=${set('region')}><option value="">All regions</option>${db.regions.map((r) => html`<option value=${r.id}>${r.name}</option>`)}</select></label>
        <label class="f">Priority<select value=${f.prio} onChange=${set('prio')}><option value="">All</option>${FS.PRIORITIES.map((p) => html`<option>${p}</option>`)}</select></label>
        <label class="f">Province<select value=${f.prov} onChange=${set('prov')}><option value="">All</option>${FS.PROVINCES.map((p) => html`<option>${p}</option>`)}</select></label>
      </div>
      <div class="row" style="margin:12px 0">
        <strong>${chosen.length} dealers</strong><span class="small muted">(${chosen.filter((c) => langOf(c) === 'fr').length} in French · ${noEmail} account${noEmail === 1 ? '' : 's'} with no email on file)</span><span class="spacer"></span>
        <button onClick=${exportCsv} disabled=${!chosen.length}>⬇ Export for mail merge</button>
        <button onClick=${logAll} disabled=${!chosen.length}>✓ Log all as sent</button>
      </div>
      <details class="small" style="margin-bottom:10px"><summary style="cursor:pointer">How to send them all with Outlook mail merge</summary>
        <ol style="margin:6px 0;padding-left:18px;line-height:1.6"><li>Click <strong>Export for mail merge</strong> (saves a CSV file).</li>
        <li>Open <strong>Word</strong> → <strong>Mailings → Start Mail Merge → E-mail Messages</strong>.</li>
        <li><strong>Select Recipients → Use an Existing List</strong> → choose the CSV.</li>
        <li><strong>Insert Merge Field → Body</strong> (it already contains the greeting, message and signature).</li>
        <li><strong>Finish & Merge → Send E-mail Messages</strong>: To = <em>Email</em>, Subject = your subject line, Format = Plain text.<br/>Tip: do French and English separately (filter Province = QC), so each group gets the right subject line.</li>
        <li>Come back here and click <strong>Log all as sent</strong>.</li></ol></details>
      <div style="max-height:420px;overflow:auto;border:1px solid var(--line);border-radius:8px">
        ${rows.map((c) => { const d = draft(c, db, tpl); return html`<div class="list-item" style=${skip[c.id] ? 'opacity:.45' : ''}>
          <input type="checkbox" checked=${!skip[c.id]} onChange=${(e) => setSkip({ ...skip, [c.id]: !e.target.checked })} />
          <div style="flex:1;min-width:0"><strong>${c.name}</strong> <span class="tag">${d.lang.toUpperCase()}</span>${sent[c.id] ? html` <span class="tag ok">opened</span>` : ''}<div class="small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.to} · ${d.subject}</div></div>
          <a class="btn sm" href=${mailto(d)} onClick=${() => setSent({ ...sent, [c.id]: true })}>✉</a></div>`; })}
        ${!rows.length && html`<div class="empty">No dealers match.</div>`}
      </div></div>`;
  }

  // ---------- Templates editor ----------
  function Templates() {
    const db = useDB();
    const list = templates(db);
    const [i, setI] = useState(0);
    const [lang, setLang] = useState('en');
    const [sig, setSig] = useState(signature(db));
    const t = list[i] || list[0];
    const edit = (k, val) => saveTemplates(list.map((x, j) => (j === i ? { ...x, [lang]: { ...x[lang], [k]: val } } : x)));
    const add = () => { const n = { id: FS.uid(), name: 'New template', kind: 'bulk', en: { subject: '', body: 'Hi {first_name},\n\n\n\nBest regards,\n{signature}' }, fr: { subject: '', body: 'Bonjour {first_name},\n\n\n\nCordialement,\n{signature}' } }; saveTemplates([...list, n]); setI(list.length); };
    const sample = db.customers.find((c) => c.contactEmail && langOf(c) === lang) || db.customers[0];
    const prev = sample && draft(sample, db, t, lang);
    return html`<div class="grid g2">
      <div class="card"><h2 style="margin-top:0">Templates</h2>
        <div class="row" style="margin-bottom:10px">${list.map((x, j) => html`<button class=${'sm' + (j === i ? ' primary' : '')} onClick=${() => setI(j)}>${x.name}</button>`)}<button class="sm ghost" onClick=${add}>+ New</button></div>
        <div class="form">
          <label class="f">Name<input value=${t.name} onChange=${(e) => saveTemplates(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
          <label class="f">Language<select value=${lang} onChange=${(e) => setLang(e.target.value)}><option value="en">English</option><option value="fr">Français</option></select></label>
          <label class="f full">Subject<input value=${(t[lang] || {}).subject || ''} onChange=${(e) => edit('subject', e.target.value)} /></label>
          <label class="f full">Message<textarea style="min-height:220px" value=${(t[lang] || {}).body || ''} onChange=${(e) => edit('body', e.target.value)}></textarea></label>
        </div>
        <div class="small muted" style="margin-top:6px">Fields: {first_name} {contact_name} {company} {city} {last_contact_date} {last_notes} {next_action} {next_action_sentence} {my_name} {signature} {year} {next_year}. A line is left out when its field is empty.</div>
        <div class="row" style="margin-top:10px">${list.length > 1 && !DEFAULT_TEMPLATES.some((d) => d.id === t.id) && html`<button class="sm danger" onClick=${() => { if (confirm('Delete this template?')) { saveTemplates(list.filter((_, j) => j !== i)); setI(0); } }}>Delete</button>`}
          <button class="sm ghost" onClick=${() => { if (confirm('Reset all templates to the originals?')) saveTemplates([]); }}>Reset to originals</button></div>
      </div>
      <div class="card"><h2 style="margin-top:0">Signature</h2>
        <textarea style="width:100%;min-height:90px" value=${sig} onInput=${(e) => setSig(e.target.value)} onChange=${(e) => Store.commit((d) => { d.settings.signature = e.target.value; })}></textarea>
        <div class="small muted">Add your phone number and email here.</div>
        ${prev && html`<h2>Preview (${sample.name})</h2><div class="small"><strong>${prev.subject}</strong></div><pre class="small" style="white-space:pre-wrap;font-family:inherit;background:var(--soft);padding:10px;border-radius:8px">${prev.body}</pre>`}
      </div></div>`;
  }

  function EmailPage({ params }) {
    const db = useDB();
    const [tab, setTab] = useState(params.tab || 'todo');
    const q = useMemo(() => queue(db), [db]);
    return html`<div class="head"><h1 class="grow">Email</h1></div>
      ${!db.settings.signature && html`<div class="badbox" style="margin-bottom:12px">Set your name, phone and email in your signature first: <a style="cursor:pointer;text-decoration:underline" onClick=${() => setTab('tpl')}>Templates & signature</a>.</div>`}
      <div class="tabs" style="margin-bottom:14px">
        <button class=${tab === 'todo' ? 'on' : ''} onClick=${() => setTab('todo')}>To send (${q.follow.length + q.checkin.length})</button>
        <button class=${tab === 'bulk' ? 'on' : ''} onClick=${() => setTab('bulk')}>Holiday & group</button>
        <button class=${tab === 'tpl' ? 'on' : ''} onClick=${() => setTab('tpl')}>Templates & signature</button>
      </div>
      ${tab === 'todo' && html`<div class="grid g2">
        <${QueueList} rows=${q.follow} title="Follow-ups due" empty="No follow-ups due. Nice." />
        <${QueueList} rows=${q.checkin} title="Keep in touch" empty="Everyone has heard from you recently." /></div>
        <p class="small muted">"Keep in touch" lists dealers with no contact in ${db.settings.keepA || 45} days (A), ${db.settings.keepB || 90} days (B) or ${db.settings.keepC || 180} days (C). Any logged visit, call or email resets the clock.</p>`}
      ${tab === 'bulk' && html`<${Bulk} />`}
      ${tab === 'tpl' && html`<${Templates} />`}`;
  }

  G.Email = { EmailPage, Compose, queue, draft, fill, langOf, DEFAULT_TEMPLATES };
})(window);
