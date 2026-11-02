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

  const NAV = [['', 'Today', '🏠'], ['accounts', 'Accounts', '🏢'], ['trips', 'Trips', '🚗'], ['pipeline', 'Pipeline', '💰'], ['activity', 'Activity', '📝'], ['data', 'Data & settings', '⚙️']];

  function App() {
    const [route, setRoute] = useState(parseHash());
    const [menu, setMenu] = useState(false);
    const ui = useUI();
    useEffect(() => { const f = () => { setRoute(parseHash()); setMenu(false); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
    const [p0, p1] = route.parts;
    let page;
    if (!p0) page = html`<${Today} />`;
    else if (p0 === 'accounts') page = html`<${Accounts} params=${route.params} key=${location.hash} />`;
    else if (p0 === 'trips' && p1 === 'new') page = html`<${NewTrip} />`;
    else if (p0 === 'trips' && p1) page = html`<${TripPlanner} id=${p1} params=${route.params} key=${p1} />`;
    else if (p0 === 'trips') page = html`<${TripList} />`;
    else if (p0 === 'pipeline') page = html`<${Pipeline} />`;
    else if (p0 === 'activity') page = html`<${Activity} />`;
    else if (p0 === 'data') page = html`<${G.DataPage} params=${route.params} key=${location.hash} />`;
    else page = html`<div class="empty">Page not found. <a href="#/">Go home</a></div>`;
    const m = ui.modal;
    return html`
      <div class="topbar"><button class="sm" onClick=${() => setMenu(!menu)}>☰</button><strong style="flex:1">Field Sales Command Center</strong><a href="#/data" style="text-decoration:none"><${G.Sync.StatusIcon} /></a><button class="sm" onClick=${() => UI.logVisit(null)}>+ Log</button></div>
      <div class="shell">
        <nav class=${'side' + (menu ? ' open' : '')}>
          <div class="logo">Field Sales<br/>Command Center<span>Luminys · Canada East</span></div>
          ${NAV.map(([k, label, icon]) => html`<a href=${'#/' + k} class=${(p0 || '') === k ? 'on' : ''}><span>${icon}</span>${label}</a>`)}
          <div class="foot"><${G.Sync.StatusLine} />${!G.Sync.signedIn && html`<br/>Back up weekly from Data & settings.`}</div>
        </nav>
        <main class="main">${page}</main>
      </div>
      ${ui.customerId && html`<${CustomerDrawer} id=${ui.customerId} key=${ui.customerId} />`}
      ${m && m.kind === 'customer' && html`<${CustomerForm} id=${m.id} onClose=${UI.close} />`}
      ${m && m.kind === 'visit' && html`<${VisitForm} customerId=${m.customerId} visit=${m.visit} onClose=${UI.close} />`}
      ${m && m.kind === 'project' && html`<${ProjectForm} project=${m.project} onClose=${UI.close} />`}
      ${m && m.kind === 'contact' && html`<${ContactForm} contact=${m.contact} onClose=${UI.close} />`}
      ${ui.toast && html`<div class="toast">${ui.toast}</div>`}`;
  }

  const root = document.getElementById('app');
  root.textContent = ''; // drop the "Loading…" placeholder
  render(html`<${G.Sync.SyncGate}><${App} /><//>`, root);
})(window);
