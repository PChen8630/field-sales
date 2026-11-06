/* App shell + router */
(function (G) {
  'use strict';
  const { html, render, useState, useEffect } = htmPreact;
  const { useUI, UI, CustomerForm, VisitForm, ProjectForm, ContactForm, CustomerDrawer } = G.UIX;
  const { Today, Accounts, Pipeline, Activity } = G.Pages;
  const { TripList, NewTrip, TripPlanner } = G.Trips;

  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    return { parts: path.split('/').filter(Boolean), params: Object.fromEntries(new URLSearchParams(qs || '')) };
  }

  const NAV = [['', 'Today', '🏠'], ['todo', 'To do', '✅'], ['car', 'Car mode', '🚘'], ['accounts', 'Accounts', '🏢'], ['near', 'Near me', '📍'], ['email', 'Email', '✉️'], ['trips', 'Trips', '🚗'], ['pipeline', 'Pipeline', '💰'], ['activity', 'Activity', '📝'], ['data', 'Data & settings', '⚙️'], ['guide', 'Guide', '❓']];

  function App() {
    const [route, setRoute] = useState(parseHash());
    const [menu, setMenu] = useState(false);
    const ui = useUI();
    useEffect(() => { const f = () => { setRoute(parseHash()); setMenu(false); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
    const [p0, p1] = route.parts;
    let page;
    if (!p0) page = html`<${Today} />`;
    else if (p0 === 'accounts') page = html`<${Accounts} params=${route.params} key=${location.hash} />`;
    else if (p0 === 'email') page = html`<${G.Email.EmailPage} params=${route.params} key=${location.hash} />`;
    else if (p0 === 'near') page = html`<${G.Field.NearMe} />`;
    else if (p0 === 'prep' && p1) page = html`<${G.Field.Prep} id=${p1} key=${p1} />`;
    else if (p0 === 'trips' && p1 === 'new') page = html`<${NewTrip} />`;
    else if (p0 === 'trips' && p1) page = html`<${TripPlanner} id=${p1} params=${route.params} key=${p1} />`;
    else if (p0 === 'trips') page = html`<${TripList} />`;
    else if (p0 === 'pipeline') page = html`<${Pipeline} />`;
    else if (p0 === 'activity') page = html`<${Activity} />`;
    else if (p0 === 'todo') page = html`<${G.Todo.TodoPage} params=${route.params} key=${location.hash} />`;
    else if (p0 === 'guide') page = html`<${G.Guide.Guide} />`;
    else if (p0 === 'data') page = html`<${G.DataPage} params=${route.params} key=${location.hash} />`;
    else page = html`<div class="empty">Page not found. <a href="#/">Go home</a></div>`;
    const m = ui.modal;
    const modals = html`
      ${ui.customerId && html`<${CustomerDrawer} id=${ui.customerId} key=${ui.customerId} />`}
      ${m && m.kind === 'customer' && html`<${CustomerForm} id=${m.id} onClose=${UI.close} />`}
      ${m && m.kind === 'visit' && html`<${VisitForm} customerId=${m.customerId} visit=${m.visit} onClose=${UI.close} />`}
      ${m && m.kind === 'project' && html`<${ProjectForm} project=${m.project} onClose=${UI.close} />`}
      ${m && m.kind === 'contact' && html`<${ContactForm} contact=${m.contact} onClose=${UI.close} />`}
      ${m && m.kind === 'talk' && html`<${G.Talk.TalkModal} queued=${m.queued} car=${m.car} onClose=${UI.close} key=${(m.queued && m.queued.id) || 'talk'} />`}
      ${m && m.kind === 'email' && html`<${G.Email.Compose} customerId=${m.customerId} templateId=${m.templateId} onClose=${UI.close} />`}
      ${ui.toast && html`<div class="toast">${ui.toast}</div>`}`;
    // Car mode takes the whole screen: no menu or top bar.
    if (p0 === 'car') return html`<${G.Car.CarMode} params=${route.params} key=${location.hash} />${modals}`;
    return html`
      <div class="topbar"><button class="sm" onClick=${() => setMenu(!menu)}>☰</button><strong style="flex:1">Field Sales</strong><a href="#/data" style="text-decoration:none"><${G.Sync.StatusIcon} /></a><a class="btn sm" href="#/todo" title="To do">✅</a><a class="btn sm" href="#/car" title="Car mode">🚘</a><a class="btn sm" href="#/near" title="Near me">📍</a><button class="sm primary talk-top" onClick=${() => G.Talk.open()} title="Talk: update by voice">🎙</button><button class="sm" onClick=${() => UI.logVisit(null)}>+ Log</button></div>
      <div class="shell">
        <nav class=${'side' + (menu ? ' open' : '')}>
          <div class="logo">Field Sales<br/>Command Center<span>Luminys · Canada East</span></div>
          ${NAV.map(([k, label, icon]) => html`<a href=${'#/' + k} class=${(p0 || '') === k ? 'on' : ''}><span>${icon}</span>${label}</a>`)}
          <div class="foot"><${G.Sync.StatusLine} />${!G.Sync.signedIn && html`<br/>Back up weekly from Data & settings.`}</div>
        </nav>
        <main class="main">${page}</main>
      </div>
      ${modals}`;
  }

  const root = document.getElementById('app');
  root.textContent = ''; // drop the "Loading…" placeholder
  render(html`<${G.Sync.SyncGate}><${App} /><//>`, root);
  // Offline copy of the app so it still opens with no signal.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
})(window);
