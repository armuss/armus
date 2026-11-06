// Phone menu. Below 901px the header's link row (.nav nav) is hidden, so
// this adds a menu button to the header that opens a full-screen sheet:
// the free level test and the YDS / IELTS page first, as two big cards,
// then the rest of the site's links.
//
// Runs while the page is still parsing (it's a plain script at the end of
// <body>), so the sheet already exists when i18n.js applies translations
// and wires up [data-lang-toggle] on DOMContentLoaded.
(function () {
  const header = document.querySelector("header.nav");
  if (!header || document.getElementById("navSheet")) return;

  const ARROW = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nav-menu-btn";
  btn.id = "navMenuBtn";
  btn.setAttribute("aria-controls", "navSheet");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>'
    + '<span class="sr-only" data-i18n="nav.menu">Menü</span>';
  header.appendChild(btn);

  const sheet = document.createElement("div");
  sheet.className = "nav-sheet";
  sheet.id = "navSheet";
  sheet.hidden = true;
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-labelledby", "navSheetTitle");
  sheet.innerHTML = `
    <div class="nav-sheet-top">
      <a href="/" class="nav-sheet-logo"><img src="logo-black.png" alt="ARMUS"></a>
      <h2 class="sr-only" id="navSheetTitle" data-i18n="nav.menu">Menü</h2>
      <button type="button" class="nav-sheet-close" data-nav-sheet-close>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        <span class="sr-only" data-i18n="nav.close">Kapat</span>
      </button>
    </div>
    <a class="nav-sheet-card nav-sheet-test" href="seviye-testi">
      <span>
        <b><span data-i18n="nav.sheetTest">Seviye Testi</span> <span class="nav-sheet-free" data-i18n="nav.free">Ücretsiz</span></b>
        <small data-i18n="nav.sheetTestSub">10 dakikada seviyeni öğren</small>
      </span>
      ${ARROW}
    </a>
    <a class="nav-sheet-card nav-sheet-exam" href="sinav-hazirlik">
      <span>
        <b>YDS / IELTS</b>
        <small data-i18n="nav.sheetExamSub">Sınavına birebir hazırlan</small>
      </span>
      ${ARROW}
    </a>
    <ul class="nav-sheet-links">
      <li><a href="teachers" data-i18n="nav.teachers">Öğretmenler</a></li>
      <li><a href="how-it-works" data-i18n="nav.how">Nasıl Çalışır?</a></li>
      <li><a href="blog" data-i18n="nav.blog">Blog</a></li>
      <li><a href="hakkimizda" data-i18n="nav.about">Hakkımızda</a></li>
      <li><a href="sss" data-i18n="index.footer.help">Yardım Merkezi</a></li>
    </ul>
    <div class="nav-sheet-foot">
      <button type="button" class="lang-toggle" data-lang-toggle>EN</button>
    </div>`;
  header.after(sheet);

  // mark the page we're on ("/seviye-testi", or "seviye-testi.html" locally)
  const here = location.pathname.replace(/^\/+|\.html$/g, "");
  sheet.querySelectorAll("a[href]").forEach((a) => {
    if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
  });

  let lastFocus = null;

  function focusables() {
    return [...sheet.querySelectorAll("a[href], button")].filter((el) => el.offsetParent !== null);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open() {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("nav-sheet-open");
    document.addEventListener("keydown", onKey);
    const first = sheet.querySelector(".nav-sheet-card");
    if (first) first.focus();
  }

  function close() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("nav-sheet-open");
    document.removeEventListener("keydown", onKey);
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  btn.addEventListener("click", open);
  sheet.querySelector("[data-nav-sheet-close]").addEventListener("click", close);

  // close on any link too: a link to this same page wouldn't navigate,
  // and closing first means "back" (bfcache) doesn't return to an open sheet
  sheet.querySelectorAll("a[href]").forEach((a) => a.addEventListener("click", close));

  // turning a tablet sideways past the breakpoint brings the header's own
  // link row back, so the sheet has no reason to stay open
  const wide = window.matchMedia("(min-width: 901px)");
  const onWide = (e) => { if (e.matches) close(); };
  if (wide.addEventListener) wide.addEventListener("change", onWide);
  else if (wide.addListener) wide.addListener(onWide);
})();
