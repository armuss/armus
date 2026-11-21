// "Sınavlar" menu. The header's exam link (a.nav-exam, on the pages with
// the full menu) becomes "Sınavlar ▾": pointing at it, focusing it with
// the keyboard or a first tap on a touch screen opens a panel with the four
// exams. A click on "Sınavlar" itself still goes to the exam hub
// (sinav-hazirlik). Phones don't see this row at all - nav-sheet.js has
// the same four exams in its menu sheet.
(function () {
  const link = document.querySelector(".nav nav a.nav-exam");
  if (!link || link.closest(".nav-exam-wrap")) return;

  const CHEV = '<svg class="nav-exam-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  // the label in its own span, so a language switch (i18n.js rewrites a
  // [data-i18n] element's contents) keeps the arrow
  link.removeAttribute("data-i18n");
  link.innerHTML = `<span data-i18n="nav.exams">Sınavlar</span>${CHEV}`;
  link.setAttribute("aria-haspopup", "true");
  link.setAttribute("aria-expanded", "false");
  link.setAttribute("aria-controls", "navExamPanel");

  const wrap = document.createElement("div");
  wrap.className = "nav-exam-wrap";
  link.parentNode.insertBefore(wrap, link);
  wrap.appendChild(link);

  // two groups: the ÖSYM exams taken in Turkey, and the ones for abroad
  const groups = [
    ["nav.examGroupTr", "Türkiye · ÖSYM", [
      ["sinav-hazirlik#yds", "YDS", "yds", "nav.examYdsSub", "Kamu ve akademik kariyer", false],
      ["yokdil", "YÖKDİL", "yokdil", "nav.examYokdilSub", "Lisansüstü · Fen, Sağlık, Sosyal", true],
      ["ydt", "YDT", "ydt", "nav.examYdtSub", "YKS dil sınavı · liseliler", true],
    ]],
    ["nav.examGroupAbroad", "Yurt dışı", [
      ["sinav-hazirlik#ielts", "IELTS", "ielts", "nav.examIeltsSub", "Yurt dışında eğitim ve iş", false],
      ["toefl", "TOEFL", "toefl", "nav.examToeflSub", "ABD’de üniversite başvurusu", true],
    ]],
  ];

  const panel = document.createElement("div");
  panel.className = "nav-exam-panel";
  panel.id = "navExamPanel";
  panel.innerHTML = `
    <div class="nav-exam-box">
      <div class="nav-exam-grid">
        ${groups.map(([headKey, head, exams]) => `
          <div class="nav-exam-group">
            <div class="nav-exam-group-head" data-i18n="${headKey}">${head}</div>
            ${exams.map(([href, name, cls, key, sub, isNew]) => `
              <a class="nav-exam-tile" href="${href}">
                <span class="nav-exam-badge ${cls}">${name}</span>
                <span class="nav-exam-text">
                  <b>${name} <span data-i18n="nav.examPrepWord">hazırlık</span>${isNew ? ' <em data-i18n="nav.examNew">Yeni</em>' : ""}</b>
                  <small data-i18n="${key}">${sub}</small>
                </span>
              </a>`).join("")}
          </div>`).join("")}
      </div>
      <a class="nav-exam-all" href="sinav-hazirlik">
        <span data-i18n="nav.examCompare">Hangisi senin için? Sınavları yan yana karşılaştır</span>
        <b><span data-i18n="nav.examAll">Tüm sınavlar</span> <span aria-hidden="true">→</span></b>
      </a>
    </div>`;
  wrap.appendChild(panel);

  // the exam page this is (/ydt, /yokdil) gets its tile marked
  const here = location.pathname.replace(/^\/+|\.html$/g, "");
  panel.querySelectorAll(".nav-exam-tile").forEach((a) => {
    if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
  });

  // the panel is centred under "Sınavlar"; on a narrow laptop that can
  // put an edge outside the window, so it's nudged back in
  const fitPanel = () => {
    panel.style.removeProperty("--nav-exam-shift");
    const box = panel.querySelector(".nav-exam-box").getBoundingClientRect();
    const room = document.documentElement.clientWidth;
    let shift = 0;
    if (box.left < 12) shift = 12 - box.left;
    else if (box.right > room - 12) shift = room - 12 - box.right;
    if (shift) panel.style.setProperty("--nav-exam-shift", `${Math.round(shift)}px`);
  };

  const setOpen = (open) => {
    wrap.classList.toggle("open", open);
    link.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) fitPanel();
  };

  let closeTimer = null;
  wrap.addEventListener("mouseenter", () => { clearTimeout(closeTimer); setOpen(true); });
  // a short grace period, so moving the pointer down onto the panel
  // doesn't close it on the way
  wrap.addEventListener("mouseleave", () => { closeTimer = setTimeout(() => setOpen(false), 160); });
  // Escape closes it and leaves the focus on "Sınavlar" (which must not
  // reopen it straight away)
  let held = false;
  wrap.addEventListener("focusin", () => { if (!held) setOpen(true); });
  wrap.addEventListener("focusout", (e) => { if (!wrap.contains(e.relatedTarget)) setOpen(false); });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && wrap.classList.contains("open")) {
      held = true;
      setOpen(false);
      link.focus();
      held = false;
    }
  });

  // a touch screen has no hover: the first tap opens the panel, a second
  // tap on "Sınavlar" goes to the hub
  let touched = false;
  link.addEventListener("pointerdown", (e) => { touched = e.pointerType === "touch"; });
  link.addEventListener("click", (e) => {
    if (touched && !wrap.classList.contains("tapped")) {
      e.preventDefault();
      wrap.classList.add("tapped");
      setOpen(true);
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove("tapped");
      setOpen(false);
    }
  });
})();
