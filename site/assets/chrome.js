/** Inject shared .shell topbar + footer. data-base on <html> prefixes Pages links. */
(function () {
  const base = document.documentElement.getAttribute("data-base") || "";
  const p = (href) => base + href;

  const nav = document.getElementById("site-nav");
  if (nav) {
    nav.innerHTML =
      '<a class="brand" href="' +
      p("index.html") +
      '">' +
      '<div class="brand-mark" aria-hidden="true"></div>' +
      '<div class="brand-name">storage<span>flow</span></div>' +
      "</a>" +
      '<div class="meta-pills">' +
      '<a class="pill" data-nav="why.html" href="' + p("why.html") + '">Why</a>' +
      '<a class="pill" data-nav="how.html" href="' + p("how.html") + '">How</a>' +
      '<a class="pill" data-nav="start.html" href="' + p("start.html") + '">Start</a>' +
      '<a class="pill accent" href="https://github.com/real-limitless/storageflow" rel="noopener">GitHub</a>' +
      "</div>";
  }

  const foot = document.getElementById("site-footer");
  if (foot) {
    foot.innerHTML =
      '<div class="wrap foot-grid">' +
      "<div>" +
      '<div class="brand" style="margin-bottom:10px">' +
      '<div class="brand-mark" aria-hidden="true"></div>' +
      '<div class="brand-name">storage<span>flow</span></div></div>' +
      '<p class="legal">Apache-2.0. One front door. Keep the bytes. Secrets stay on the plane.</p>' +
      '<p class="legal">Also <a href="https://github.com/real-limitless/mcp-flow" rel="noopener">mcp-flow</a>, <a href="https://github.com/real-limitless/OpenFlow" rel="noopener">OpenFlow</a>, <a href="https://github.com/real-limitless/Roster-Flow" rel="noopener">roster-flow</a>, and <a href="https://github.com/real-limitless/skill-flow" rel="noopener">skill-flow</a>.</p>' +
      "</div>" +
      '<div style="display:flex;flex-direction:column;gap:8px;font-family:var(--font-mono);font-size:11px;letter-spacing:0.06em;text-transform:uppercase">' +
      '<a href="' + p("why.html") + '">Why</a>' +
      '<a href="' + p("how.html") + '">How</a>' +
      '<a href="' + p("start.html") + '">Start</a>' +
      '<a href="https://github.com/real-limitless/storageflow" rel="noopener">Source</a>' +
      "</div></div>";
  }
})();
