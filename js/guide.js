/* Guide: "how do I…" topics in plain words, with "Show me" buttons that open the right screen
   and highlight exactly where to tap. */
(function (G) {
  'use strict';
  const { html, useState, useEffect } = htmPreact;

  // ---------- Spotlight ----------
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden'; };
  function findTarget(s) {
    if (s.sel) { const all = [...document.querySelectorAll(s.sel)].filter(visible); if (all.length) return all[0]; }
    if (s.text) {
      const want = s.text.toLowerCase();
      const els = [...document.querySelectorAll('button, a, input, select, label, h1, h2, h3, summary, .tabs button')].filter(visible)
        .filter((el) => (el.textContent || el.placeholder || '').toLowerCase().includes(want) || (el.placeholder || '').toLowerCase().includes(want) || (el.title || '').toLowerCase() === want);
      els.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      if (els.length) return els[0];
    }
    return null;
  }
  let current = null;
  function clearSpot() { if (current) { current.cleanup(); current = null; } }
  function spot(el, tip) {
    clearSpot();
    const box = document.createElement('div'); box.className = 'guide-spot';
    const bubble = document.createElement('div'); bubble.className = 'guide-tip';
    bubble.innerHTML = '<div></div><button class="primary sm">Got it</button>';
    bubble.firstChild.textContent = tip;
    document.body.append(box, bubble);
    const place = () => {
      const r = el.getBoundingClientRect(), pad = 6;
      Object.assign(box.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      const bw = Math.min(300, innerWidth - 24); bubble.style.width = bw + 'px';
      bubble.style.left = Math.max(12, Math.min(innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)) + 'px';
      const below = r.bottom + 14, bh = bubble.offsetHeight || 90;
      bubble.style.top = (below + bh < innerHeight ? below : Math.max(12, r.top - bh - 14)) + 'px';
    };
    place();
    const onMove = () => place();
    const done = () => clearSpot();
    // Any tap closes the highlight; taps still reach the real button underneath.
    addEventListener('scroll', onMove, true); addEventListener('resize', onMove);
    const arm = setTimeout(() => document.addEventListener('pointerdown', done, true), 300);
    const t = setTimeout(done, 15000);
    current = { cleanup: () => { clearTimeout(t); clearTimeout(arm); document.removeEventListener('pointerdown', done, true); removeEventListener('scroll', onMove, true); removeEventListener('resize', onMove); box.remove(); bubble.remove(); } };
  }
  // s = { route, text | sel, tip, menu }  (menu: name of the menu item, for phones where the menu is folded away)
  function show(s) {
    clearSpot();
    if (s.route != null && location.hash.replace(/\?.*$/, '') !== s.route.replace(/\?.*$/, '')) location.hash = s.route;
    const t0 = Date.now();
    const tick = () => {
      let el = findTarget(s), tip = s.tip;
      if (!el && s.menu) { const burger = findTarget({ sel: '.topbar button' }); if (burger) { el = burger; tip = `Tap ☰, then “${s.menu}”.`; } }
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => spot(el, tip), 350); return; }
      if (Date.now() - t0 < 3000) setTimeout(tick, 120);
      else G.UIX.UI.toast('Could not find it on this screen — check the steps above.');
    };
    setTimeout(tick, 200);
  }

  // ---------- Topics ----------
  // step: text, or [text, showSpec]
  const S = (route, text, tip, extra) => ({ route, text, tip, ...extra });
  const TOPICS = [
    { group: 'Start here', items: [
      { t: 'Put the app on your phone', d: 'One tap from your home screen, works with no signal.', steps: [
        'On your phone, open pchen8630.github.io/field-sales and sign in.',
        'Android (Chrome): tap the ⋮ menu → “Add to Home screen” (or “Install app”).',
        'iPhone (Safari): tap Share (square with an arrow) → “Add to Home Screen”.',
        'A blue 📍 “Command Center” icon appears. Open the app from it from now on.'] },
      { t: 'Add the red 🎙 Talk icon', d: 'Opens Car mode already listening.', steps: [
        ['Open the Talk icon page and follow the steps there.', S(null, null, null, { href: 'talk.html' })],
        'On Android you can also long-press the blue app icon → “Talk”.',
        'The first time, allow the microphone and location.'] },
      { t: 'Sign in so your phone and computer match', d: 'Everything syncs through your cloud account.', steps: [
        ['Go to Data & settings → Cloud sync and sign in.', S('#/data', 'Cloud sync', 'Cloud sync: sign in here, see when it last synced, or tap “Sync now”.', { menu: 'Data & settings' })],
        'The ☁ icon at the bottom of the menu (or top bar on the phone) shows the sync status.',
        'If it ever asks “Which copy should I keep?”, keep the copy with your latest work (usually the one on the device you just used).'] },
    ]},
    { group: 'Every day', items: [
      { t: 'Read the Today screen', d: 'Your starting point each morning.', steps: [
        ['“Follow-ups due” = promises you made that are due this week.', S('#/', 'Follow-ups due', 'Follow-ups due this week. Tap “Log” after you call or visit.')],
        ['“Who to see next” = dealers ranked by priority and how long since your last visit.', S('#/', 'Who to see next', 'The higher the number, the more they need a visit.')],
        ['“Needs attention” = things to fix (missing map pins, no backup…).', S('#/', 'Needs attention', 'Fix these when you have a minute.')]] },
      { t: 'Update by voice (Talk)', d: 'Visit summary, projects, follow-ups and contact moves in one go.', steps: [
        ['Tap 🎙 Talk.', S('#/', '🎙 Talk', 'Tap here (or 🎙 in the top bar on your phone) and just talk.')],
        'Speak naturally: “Just left Alarme Mirabel, met Jean, they’re quoting 40 cameras for a school, about 30K, follow up in two weeks.”',
        'Pick English or Français for the language you’ll mostly speak. Names in the other language are matched by sound.',
        'Pause or tap ■. The app reads back what it understood. Say “yes” (or tap Save). Nothing is saved before that.',
        'Made a mistake? Tap Undo on the “Saved” screen.',
        'No signal? The note waits on your phone. On Today, tap “Process” when you’re back online.'] },
      { t: 'To do: add, review at night, see in the morning', d: 'Things you promised a dealer, linked to that dealer.', steps: [
        'While driving: say it in 🎙 Talk, e.g. “…and I need to send them pricing by Friday.” It shows under ✅ To do on the review screen, already linked to the dealer.',
        ['Or type it: open ✅ To do, write the task, pick the dealer and a day, tap + Add.', S('#/todo', '+ Add', 'Type the task above, pick a dealer and a day, then tap here.', { menu: 'To do' })],
        'Logging a visit by hand? The “Next action” is added to To do too (untick the box if you don’t want it).',
        ['Each morning, Today shows what’s overdue and due today. Tick the box when it’s done.', S('#/', null, 'Your to-dos for today. Tick when done.', { sel: '.todo-today' })],
        ['Each evening (after 5 pm), tap 🌙 Evening review: tick what’s done, move the rest to tomorrow or Monday.', S('#/todo', '🌙 Evening review', 'Go through today’s to-dos here.', { menu: 'To do' })],
        'A dealer’s page has a “To do” tab with everything for that dealer. Prep and Car mode remind you of open to-dos before you arrive.'] },
      { t: 'Log a visit or call by hand', d: 'When typing is easier.', steps: [
        ['Tap “+ Log activity”.', S('#/', '+ Log activity', 'Log a visit, call, video call or email.')],
        'Pick the dealer, the type (In-person, Phone…), and what happened.',
        'Set the next follow-up with the +1 wk / +2 wk / +1 mo buttons, then Save.'] },
      { t: 'Drive with Car mode', d: 'Three huge buttons: Talk, Navigate, Call.', steps: [
        ['Open Car mode with 🚘 (top bar on the phone, or the menu).', S('#/', null, 'Car mode: big buttons for the road.', { sel: 'a[href="#/car"]', menu: 'Car mode' })],
        'It shows your next stop from today’s trip, with the time. No trip? It suggests the best drop-in nearby.',
        '🧭 Navigate opens Google Maps or Waze (choose at the bottom). 📞 Call rings the contact.',
        '⏭ Skip moves to the next stop. 🔊 Read prep reads you the briefing before you go in.',
        'The screen stays on while Car mode is open. Tap ✕ Exit to leave.'] },
    ]},
    { group: 'Dealers & contacts', items: [
      { t: 'Find a dealer', d: 'Search by name, city, contact or postal code.', steps: [
        ['Go to Accounts and type in the search box.', S('#/accounts', null, 'Type a name, city, contact or postal code.', { sel: 'input[type="search"]', menu: 'Accounts' })],
        'Tap a dealer’s name to open its page.'] },
      { t: 'What’s on a dealer’s page', d: 'History, projects, contacts and quick buttons.', steps: [
        'Buttons at the top: + Log activity, 📋 Prep, Edit, Directions, Call.',
        'Tabs: Activity (visits and calls), Opportunities (projects), Contacts (people).',
        'Tags: A/B/C priority, status, 🏠 Appointment only for home-based dealers.'] },
      { t: 'Add or change a dealer', d: 'New dealer, new address, home-based…', steps: [
        ['New dealer: Accounts → “+ New account”.', S('#/accounts', '+ New account', 'Add a dealer here.', { menu: 'Accounts' })],
        'Change one: open its page → Edit.',
        'Home-based? In Edit, tick “🏠 Residential address: appointment only”. It will never be suggested as a drop-in.',
        'French or English emails? In Edit, set “Email language”.'] },
      { t: 'Add a contact, or someone changed companies', d: 'By voice is easiest.', steps: [
        'By voice: “Marc Tremblay left Sécuritech and is now at Alarme 2200.” Talk marks him as gone and adds him at the new dealer (or creates it as a prospect).',
        'By hand: open the dealer’s page → Contacts tab → add or edit the person.'] },
    ]},
    { group: 'Meetings & sales', items: [
      { t: 'Prepare for a meeting', d: 'A one-page briefing, read aloud if you want.', steps: [
        'Open the dealer’s page → 📋 Prep (also on each trip stop).',
        'You get warnings, talking points, contacts, recent history and open projects.',
        'Type or dictate your agenda in “My agenda”. 🔊 Read aloud reads it all to you in the car.'] },
      { t: 'Track a project or quote', d: 'Your pipeline with amounts and stages.', steps: [
        ['Go to Pipeline → “+ Opportunity”.', S('#/pipeline', '+ Opportunity', 'Add a project or quote here.', { menu: 'Pipeline' })],
        'Set the dealer, name, products, amount, stage (Lead → Quoted → In Progress → Won/Lost) and close date.',
        'Or just say it in Talk: “new project, school in Saint-Jérôme, 40 cameras, 30K, closing in March.”'] },
      { t: 'Free time or a cancellation', d: 'Who to drop in on near you right now.', steps: [
        ['Open 📍 Near me.', S('#/', null, 'Near me: best dealers to visit from where you are.', { sel: 'a[href="#/near"]', menu: 'Near me' })],
        'Set how far you’ll drive and how much free time you have.',
        'Tap “🚗 Start in Google Maps” to drive the suggested route. Home-based dealers are left out.'] },
      { t: 'Plan a trip', d: 'Multi-day routes with times, ready for your calendar.', steps: [
        ['Trips → “+ Plan a trip”.', S('#/trips', '+ Plan a trip', 'Start a new trip here.', { menu: 'Trips' })],
        'Choose dates, region, start/hotel location and day hours, then “Create & plan”. The best dealers are scheduled for you.',
        'Move stops with ↑ ↓, 🔒 lock the ones that must stay, ✕ remove, then “↻ Re-plan”.',
        '“🚗 Real drive times” uses real roads. “📅 Calendar” adds the stops to Outlook or Google Calendar.',
        'On the day, Car mode follows this trip stop by stop.'] },
      { t: 'Weekly report', d: 'A summary of your week to send or paste.', steps: [
        ['Activity → “📝 Weekly report”.', S('#/activity', '📝 Weekly report', 'Builds a summary of your visits, calls and projects.', { menu: 'Activity' })]] },
    ]},
    { group: 'Email', items: [
      { t: 'Set your signature (do this once)', d: 'Your name, title, phone and email.', steps: [
        ['Email → “Templates & signature”.', S('#/email', 'Templates & signature', 'Set your signature here first.', { menu: 'Email' })],
        'Fill in the Signature box. Templates can be edited here too, in English and French.'] },
      { t: 'Send follow-ups and keep-in-touch emails', d: 'Pre-written from your last visit.', steps: [
        ['Email → “To send”.', S('#/email', 'To send', 'Follow-ups due and dealers you haven’t contacted in a while.', { menu: 'Email' })],
        'Tap ✉ Write, check the text, then “Open in email app”. Your mail app opens with everything filled in. Press Send there.',
        'Back in the app, tap “Yes, log it” so it’s recorded with the next follow-up. “Later” hides a dealer for a week.'] },
      { t: 'Holiday or group emails', d: 'One by one, or all at once with Outlook mail merge.', steps: [
        ['Email → “Holiday & group”.', S('#/email', 'Holiday & group', 'Pick a template and who gets it.', { menu: 'Email' })],
        'Choose the template and filter (buying dealers, region, province…). Untick anyone to skip.',
        'Send one by one with ✉, or “⬇ Export for mail merge” and follow the Word/Outlook steps on the page.',
        'Then “✓ Log all as sent”.'] },
    ]},
    { group: 'Your data', items: [
      { t: 'Back up', d: 'A file copy on your computer, just in case.', steps: [
        ['Data & settings → “⬇ Download backup”.', S('#/data', '⬇ Download backup', 'Download a backup file. Do it once a week.', { menu: 'Data & settings' })],
        'The cloud also keeps daily copies: Data & settings → Cloud sync → “Daily cloud copies…” → Restore.'] },
      { t: 'Import dealers from a spreadsheet', d: 'CSV from your CRM or Excel.', steps: [
        ['Data & settings → “⬆ Import CSV”.', S('#/data', '⬆ Import CSV', 'Import a CSV. Columns are matched for you and duplicates are flagged.', { menu: 'Data & settings' })],
        'After importing, tap “Locate all” so every dealer gets a map pin.'] },
      { t: 'Undo a mistake', d: 'Most things can be reversed.', steps: [
        'Right after a voice update: Undo on the “Saved” screen.',
        'Bigger problem: Data & settings → Cloud sync → “Daily cloud copies…” → Restore the copy from before it happened.'] },
    ]},
    { group: 'If something isn’t working', items: [
      { t: 'The microphone doesn’t work', d: '', steps: [
        'Allow the microphone for this site: Android Chrome → ⋮ → Settings → Site settings → Microphone. iPhone → Settings → Safari → Microphone.',
        'Or tap in the text box and use the 🎤 on your keyboard to dictate instead.'] },
      { t: 'I don’t see the latest changes', d: '', steps: [
        'Phone: close the app fully and open it again.',
        'Computer: press Ctrl+F5.'] },
      { t: 'No signal', d: '', steps: [
        'The app still opens and you can work as usual. Changes sync when you’re back online.',
        'Voice notes wait on your phone. On Today, tap “Process” on each waiting note.'] },
      { t: 'The voice update picked the wrong dealer', d: '', steps: [
        'Change it in the “Dealer” box at the top of the review screen before saving.',
        'Saying the city helps: “Alarme Plus in Saint-Colomban”.'] },
    ]},
  ];

  function Guide() {
    const [q, setQ] = useState('');
    useEffect(() => () => clearSpot(), []);
    const norm = (s) => G.FS.norm(s);
    const match = (it) => !q || norm(it.t + ' ' + it.d + ' ' + it.steps.map((s) => Array.isArray(s) ? s[0] : s).join(' ')).includes(norm(q));
    const groups = TOPICS.map((g) => ({ ...g, items: g.items.filter(match) })).filter((g) => g.items.length);
    return html`<div class="guide">
      <div class="head"><div class="grow"><h1>Guide</h1><div class="muted">How to do things, and where to tap. “👆 Show me” takes you there and points to the button.</div></div></div>
      <input type="search" class="guide-search" placeholder="Search: email, trip, voice, backup…" value=${q} onInput=${(e) => setQ(e.target.value)} />
      ${!q && html`<div class="guide-quick">
        <button onClick=${() => show(S('#/', '🎙 Talk', 'Tap here and just talk. Say “yes” to save.'))}><span>🎙</span>Update by voice</button>
        <a class="btn" href="#/todo"><span>✅</span>To do</a>
        <a class="btn" href="#/car"><span>🚘</span>Car mode</a>
        <button onClick=${() => show(S('#/', '+ Log activity', 'Log a visit or call by hand.'))}><span>📝</span>Log a visit</button>
        <button onClick=${() => show(S('#/trips', '+ Plan a trip', 'Start a new trip here.', { menu: 'Trips' }))}><span>🗺</span>Plan a trip</button>
      </div>`}
      ${groups.map((g) => html`<h2 class="guide-group">${g.group}</h2>
        <div class="stack">${g.items.map((it) => html`<details class="card guide-topic" open=${!!q}>
          <summary><strong>${it.t}</strong>${it.d && html`<span class="muted small"> — ${it.d}</span>`}</summary>
          <ol>${it.steps.map((s) => Array.isArray(s)
            ? html`<li>${s[0]} ${s[1].href ? html`<a class="btn sm" href=${s[1].href}>Open</a>` : html`<button class="sm primary" onClick=${() => show(s[1])}>👆 Show me</button>`}</li>`
            : html`<li>${s}</li>`)}</ol></details>`)}</div>`)}
      ${!groups.length && html`<div class="empty">Nothing matches “${q}”. Try another word.</div>`}
      <p class="muted small" style="margin-top:18px">Still stuck? Ask in your Claude chat and describe what you see on the screen.</p>
    </div>`;
  }

  G.Guide = { Guide, show, TOPICS };
})(window);
