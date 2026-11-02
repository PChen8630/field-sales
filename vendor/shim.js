/* Combine Preact + hooks + htm into the single global the app uses. */
window.htmPreact = Object.assign({ html: htm.bind(preact.h), h: preact.h, render: preact.render, Component: preact.Component }, preactHooks);
