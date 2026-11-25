/*
 * ARMUS - the last step of signup (register.html): the Kullanım Şartları
 * and the KVKK Aydınlatma Metni, each in its own scroll box. A box's
 * checkbox only becomes clickable once the person has scrolled to the
 * end of that text. Then the age statement, and the ticari ileti onayı
 * as a separate, optional box (KVKK Kurulu 2026/347: aydınlatma and açık
 * rıza are separate texts with separate statements, and an optional
 * consent is never a condition of the service).
 *
 * The texts are read from the published pages themselves
 * (<article class="legal-doc" data-version="...">), so what is shown here
 * is always the live text and the version recorded is the version shown.
 *
 *   const consents = await armusLegalConsent.open();
 *   // null when the person closes the step, otherwise
 *   // { channel: "web", versions: {...}, terms: true, kvkk_notice: true,
 *   //   age_statement: true, marketing: true|false }
 *
 * The result goes into the signup's auth metadata; migration_130.sql's
 * handle_new_user turns it into rows in user_consents.
 */
(function () {
  const AGE_STATEMENT_VERSION = "2026-11-25";

  const DOCS = [
    {
      key: "terms",
      url: "kullanim-sartlari",
      title: ["consent.termsTitle", "Kullanım Şartları"],
      label: ["consent.termsLabel", "Kullanım Şartları'nı okudum ve kabul ediyorum."],
    },
    {
      key: "kvkk_notice",
      url: "kvkk-aydinlatma-metni",
      title: ["consent.kvkkTitle", "KVKK Aydınlatma Metni"],
      label: ["consent.kvkkLabel", "Aydınlatma Metni'ni okudum; kişisel verilerimin nasıl işleneceği konusunda bilgilendirildim."],
    },
  ];
  const MARKETING_URL = "ticari-ileti-onayi";

  const t = (pair) => (typeof armusT === "function" ? armusT(pair[0], pair[1]) : pair[1]);
  const tx = (key, tr) => t([key, tr]);

  function injectStyles() {
    if (document.getElementById("armusConsentStyles")) return;
    const style = document.createElement("style");
    style.id = "armusConsentStyles";
    style.textContent = `
      .ac-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(20, 10, 10, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; }
      .ac-panel { background: #fff; color: var(--armus-ink, #111); width: min(680px, 100%); max-height: min(92vh, 900px); border-radius: 22px; display: flex; flex-direction: column; box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35); overflow: hidden; font-family: Inter, sans-serif; }
      .ac-head { padding: 20px 22px 12px; border-bottom: 1px solid var(--armus-border-soft, #eee); }
      .ac-eyebrow { font: 700 11px Inter, sans-serif; letter-spacing: 1.6px; color: var(--armus-gold-text, #8c1c24); text-transform: uppercase; }
      .ac-head h2 { font: 800 21px/1.25 Inter, sans-serif; margin: 6px 0 4px; letter-spacing: -0.4px; }
      .ac-head p { font-size: 13.5px; color: var(--armus-muted, #666); margin: 0; }
      .ac-head .ac-en-note { margin-top: 8px; font-size: 12.5px; background: #faf7f1; border-radius: 10px; padding: 8px 10px; }
      .ac-body { overflow-y: auto; padding: 14px 22px; display: flex; flex-direction: column; gap: 12px; }
      .ac-body > * { flex-shrink: 0; }
      .ac-doc { border: 1px solid var(--armus-border-soft, #eee); border-radius: 16px; overflow: hidden; }
      .ac-doc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; padding: 13px 15px; background: #faf7f1; border: 0; font: 700 14.5px Inter, sans-serif; color: inherit; cursor: pointer; text-align: left; }
      .ac-doc-head .ac-state { font: 600 12px Inter, sans-serif; color: var(--armus-muted, #666); white-space: nowrap; }
      .ac-doc.done .ac-doc-head .ac-state { color: #1c7c3c; }
      .ac-doc-inner { display: none; }
      .ac-doc.open .ac-doc-inner { display: block; }
      .ac-scroll { height: min(46vh, 420px); overflow-y: auto; padding: 4px 16px 16px; border-top: 1px solid var(--armus-border-soft, #eee); background: #fff; }
      .ac-scroll:focus-visible { outline: 2px solid var(--armus-gold-2, #8c1c24); outline-offset: -2px; }
      .ac-scroll .legal-doc h1 { font-size: 19px; margin: 12px 0 4px; letter-spacing: -0.3px; }
      .ac-scroll .legal-doc h2 { font-size: 15.5px; margin: 20px 0 8px; }
      .ac-scroll .legal-doc h3 { font-size: 14px; margin: 14px 0 6px; }
      .ac-scroll .legal-doc p, .ac-scroll .legal-doc li { font-size: 13.5px; line-height: 1.6; margin: 0 0 8px; }
      .ac-scroll .legal-doc ul, .ac-scroll .legal-doc ol { padding-left: 20px; margin: 0 0 10px; }
      .ac-scroll .legal-doc .eyebrow { font-size: 11px; letter-spacing: 1.2px; color: var(--armus-muted, #666); font-weight: 700; margin-top: 10px; }
      .ac-scroll .legal-doc .updated { font-size: 12px; color: var(--armus-muted, #666); margin-bottom: 12px; }
      .ac-scroll .legal-doc .summary, .ac-scroll .legal-doc .note { background: #faf7f1; border-radius: 12px; padding: 10px 12px; margin: 8px 0 12px; }
      .ac-scroll .legal-doc .table-wrap { overflow-x: auto; margin: 6px 0 12px; border: 1px solid var(--armus-border-soft, #eee); border-radius: 10px; }
      .ac-scroll .legal-doc table { border-collapse: collapse; width: 100%; min-width: 520px; font-size: 12.5px; }
      .ac-scroll .legal-doc th, .ac-scroll .legal-doc td { text-align: left; vertical-align: top; padding: 7px 9px; border-bottom: 1px solid var(--armus-border-soft, #eee); }
      .ac-scroll .legal-doc th { background: #faf7f1; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
      .ac-progress { height: 4px; background: #f0e8dc; }
      .ac-progress i { display: block; height: 100%; width: 0; background: var(--armus-gold-2, #8c1c24); transition: width 0.12s; }
      .ac-hint { font-size: 12.5px; color: var(--armus-muted, #666); padding: 8px 15px 0; }
      .ac-check { display: flex; gap: 10px; align-items: flex-start; padding: 10px 15px 14px; font-size: 14px; line-height: 1.45; cursor: pointer; }
      .ac-check input { width: 19px; height: 19px; margin-top: 1px; flex: none; accent-color: var(--armus-gold-2, #8c1c24); cursor: pointer; }
      .ac-check.disabled { color: #a49b93; cursor: not-allowed; }
      .ac-check.disabled input { cursor: not-allowed; }
      .ac-extra { border: 1px solid var(--armus-border-soft, #eee); border-radius: 16px; padding: 4px 0; }
      .ac-extra .ac-check { padding: 10px 15px; }
      .ac-optional { font: 700 11px Inter, sans-serif; letter-spacing: 1.2px; color: var(--armus-muted, #666); text-transform: uppercase; margin: 6px 2px -4px; }
      .ac-extra a, .ac-hint a { color: var(--armus-gold-text, #8c1c24); }
      .ac-error { color: #b3261e; font-size: 13.5px; padding: 10px 15px; }
      .ac-foot { display: flex; gap: 10px; justify-content: flex-end; padding: 14px 22px; border-top: 1px solid var(--armus-border-soft, #eee); background: #fff; }
      .ac-btn { border-radius: 12px; padding: 13px 18px; font: 700 14.5px Inter, sans-serif; cursor: pointer; border: 1px solid var(--armus-border, #ddd); background: #fff; color: inherit; }
      .ac-btn.primary { background: var(--armus-gold-gradient, #8c1c24); color: #fff; border: 0; }
      .ac-btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
      .ac-btn:focus-visible, .ac-doc-head:focus-visible { outline: 2px solid var(--armus-gold-2, #8c1c24); outline-offset: 2px; }
      html.ac-lock, html.ac-lock body { overflow: hidden; }
      @media (max-width: 560px) {
        .ac-overlay { padding: 0; align-items: stretch; }
        .ac-panel { max-height: none; height: 100%; border-radius: 0; }
        .ac-head { padding: 16px 16px 10px; }
        .ac-body { padding: 12px 14px; }
        .ac-foot { padding: 12px 14px; }
        .ac-foot .ac-btn { flex: 1; }
        .ac-scroll { height: 48vh; }
      }
      @media (prefers-reduced-motion: reduce) { .ac-progress i { transition: none; } }
    `;
    document.head.appendChild(style);
  }

  // the <article class="legal-doc"> of one of our own pages
  async function loadDoc(url) {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const parsed = new DOMParser().parseFromString(await res.text(), "text/html");
    const article = parsed.querySelector("article.legal-doc");
    if (!article || !article.dataset.version) throw new Error(`${url}: no document`);
    // the table of contents only jumps around inside the page
    article.querySelectorAll(".toc").forEach((el) => el.remove());
    article.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    fixLinks(article);
    return { version: article.dataset.version, node: document.adoptNode(article) };
  }

  // links to other pages open in a new tab, so the half-filled form is
  // never lost (run again after a translation swaps the innerHTML)
  function fixLinks(root) {
    root.querySelectorAll("a[href]").forEach((a) => {
      if (a.getAttribute("href").startsWith("#")) {
        a.replaceWith(...a.childNodes);
      } else {
        a.target = "_blank";
        a.rel = "noopener";
      }
    });
  }

  const isEnglish = () => typeof armusGetLang === "function" && armusGetLang() === "en";

  // options.role: "teacher" accounts must be 18 or older, so their age
  // statement has no parent/guardian half
  function open(options = {}) {
    const isTeacher = options.role === "teacher";
    injectStyles();
    return new Promise((resolve) => {
      const lastFocus = document.activeElement;
      const overlay = document.createElement("div");
      overlay.className = "ac-overlay";
      overlay.innerHTML = `
        <div class="ac-panel" role="dialog" aria-modal="true" aria-labelledby="acTitle">
          <div class="ac-head">
            <div class="ac-eyebrow">${armusEscape(tx("consent.eyebrow", "Son adım"))}</div>
            <h2 id="acTitle">${armusEscape(tx("consent.title", "Sözleşme ve bilgilendirme"))}</h2>
            <p>${armusEscape(tx("consent.lead", "Hesabını oluşturmadan önce lütfen iki metni de sonuna kadar oku ve onayla."))}</p>
            ${isEnglish() ? `<p class="ac-en-note">${tx("legal.enNote", "")}</p>` : ""}
          </div>
          <div class="ac-body">
            ${DOCS.map((d, i) => `
              <section class="ac-doc${i === 0 ? " open" : ""}" data-key="${d.key}">
                <button type="button" class="ac-doc-head" aria-expanded="${i === 0}">
                  <span>${i + 1}. ${armusEscape(t(d.title))}</span>
                  <span class="ac-state">${armusEscape(tx("consent.stateUnread", "Okunmadı"))}</span>
                </button>
                <div class="ac-doc-inner">
                  <div class="ac-progress" aria-hidden="true"><i></i></div>
                  <div class="ac-scroll" tabindex="0" role="region" aria-label="${armusEscape(t(d.title))}">
                    <p class="ac-hint">${armusEscape(tx("consent.loading", "Metin yükleniyor…"))}</p>
                  </div>
                  <p class="ac-hint ac-scroll-hint">${armusEscape(tx("consent.scrollHint", "Onay kutusu, metnin sonuna geldiğinde açılır."))}</p>
                  <label class="ac-check disabled">
                    <input type="checkbox" disabled>
                    <span>${armusEscape(t(d.label))}</span>
                  </label>
                </div>
              </section>`).join("")}
            <div class="ac-extra">
              <label class="ac-check" id="acAgeLabel">
                <input type="checkbox" id="acAge">
                <span>${armusEscape(isTeacher
                  ? tx("consent.ageLabelTeacher", "18 yaşını doldurdum.")
                  : tx("consent.ageLabel", "18 yaşını doldurdum. 18 yaşından küçüksem, bu hesabı velimin veya yasal temsilcimin bilgisi ve onayıyla oluşturuyorum."))}</span>
              </label>
            </div>
            <div class="ac-optional">${armusEscape(tx("consent.optional", "İsteğe bağlı"))}</div>
            <div class="ac-extra">
              <label class="ac-check">
                <input type="checkbox" id="acMarketing">
                <span>${armusEscape(tx("consent.marketingLabel", "Kampanya, indirim ve yeniliklerden e-posta ile haberdar olmak istiyorum."))}
                  <a href="${MARKETING_URL}" target="_blank" rel="noopener">${armusEscape(tx("consent.marketingLink", "Ticari Elektronik İleti ve Açık Rıza Onay Metni"))}</a>.
                  ${armusEscape(tx("consent.marketingNote", "Bu onay isteğe bağlıdır; vermesen de tüm hizmetleri kullanabilirsin ve dilediğin zaman geri alabilirsin."))}</span>
              </label>
            </div>
            <p class="ac-error" id="acError" hidden></p>
          </div>
          <div class="ac-foot">
            <button type="button" class="ac-btn" id="acCancel">${armusEscape(tx("consent.cancel", "Vazgeç"))}</button>
            <button type="button" class="ac-btn primary" id="acConfirm" disabled>${armusEscape(tx("consent.confirm", "Onayla ve hesabı oluştur"))}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      document.documentElement.classList.add("ac-lock");

      const panel = overlay.querySelector(".ac-panel");
      const confirmBtn = overlay.querySelector("#acConfirm");
      const ageBox = overlay.querySelector("#acAge");
      const marketingBox = overlay.querySelector("#acMarketing");
      const errorEl = overlay.querySelector("#acError");
      const versions = { age_statement: AGE_STATEMENT_VERSION };
      const read = {};

      const sections = [...overlay.querySelectorAll(".ac-doc")];
      const boxOf = (s) => s.querySelector(".ac-check input");

      function update() {
        sections.forEach((s) => {
          const key = s.dataset.key;
          const box = boxOf(s);
          s.classList.toggle("done", box.checked);
          s.querySelector(".ac-state").textContent = box.checked
            ? "✓ " + tx("consent.stateDone", "Onaylandı")
            : read[key]
              ? tx("consent.stateRead", "Okundu")
              : tx("consent.stateUnread", "Okunmadı");
        });
        confirmBtn.disabled = !(sections.every((s) => boxOf(s).checked) && ageBox.checked);
      }

      function setOpen(section, isOpen) {
        section.classList.toggle("open", isOpen);
        section.querySelector(".ac-doc-head").setAttribute("aria-expanded", String(isOpen));
        if (isOpen) checkScrolled(section);
      }

      function checkScrolled(section) {
        const scroller = section.querySelector(".ac-scroll");
        const key = section.dataset.key;
        if (!versions[key]) return; // still loading, or failed
        // a folded text has no height at all - that is not "read to the end"
        if (!section.classList.contains("open") || scroller.clientHeight === 0) return;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const ratio = max <= 4 ? 1 : Math.min(1, scroller.scrollTop / max);
        section.querySelector(".ac-progress i").style.width = `${Math.round(ratio * 100)}%`;
        if (ratio >= 0.985 && !read[key]) {
          read[key] = true;
          const label = section.querySelector(".ac-check");
          label.classList.remove("disabled");
          boxOf(section).disabled = false;
          section.querySelector(".ac-scroll-hint").textContent = tx("consent.reachedEnd", "Metnin sonuna geldin; şimdi onaylayabilirsin.");
          update();
        }
      }

      sections.forEach((section, i) => {
        section.querySelector(".ac-doc-head").addEventListener("click", () => setOpen(section, !section.classList.contains("open")));
        section.querySelector(".ac-scroll").addEventListener("scroll", () => checkScrolled(section), { passive: true });
        boxOf(section).addEventListener("change", () => {
          update();
          // done with this one: fold it and open the next unread text
          if (boxOf(section).checked) {
            setOpen(section, false);
            const next = sections.slice(i + 1).find((s) => !boxOf(s).checked);
            if (next) {
              setOpen(next, true);
              next.querySelector(".ac-scroll").focus({ preventScroll: true });
            } else {
              ageBox.focus();
            }
          }
        });
      });
      ageBox.addEventListener("change", update);

      // load the texts
      DOCS.forEach((d, i) => {
        loadDoc(d.url)
          .then(({ version, node }) => {
            versions[d.key] = version;
            const scroller = sections[i].querySelector(".ac-scroll");
            scroller.innerHTML = "";
            scroller.appendChild(node);
            if (typeof armusApplyTranslations === "function") {
              // this re-renders every [data-i18n] on the page, the other
              // text in this panel included, so fix the links of both
              armusApplyTranslations();
              overlay.querySelectorAll(".ac-scroll .legal-doc").forEach(fixLinks);
            }
            checkScrolled(sections[i]);
          })
          .catch((err) => {
            console.error("legal text failed to load", err);
            sections[i].querySelector(".ac-scroll").innerHTML =
              `<p class="ac-hint">${armusEscape(tx("consent.loadFailed", "Metin yüklenemedi. İnternet bağlantını kontrol edip tekrar dene ya da metni yeni sekmede aç:"))} <a href="${d.url}" target="_blank" rel="noopener">${armusEscape(t(d.title))}</a></p>`;
          });
      });
      loadDoc(MARKETING_URL)
        .then(({ version }) => { versions.marketing = version; })
        .catch(() => { versions.marketing = AGE_STATEMENT_VERSION; });

      function close(result) {
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        document.documentElement.classList.remove("ac-lock");
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        resolve(result);
      }

      function focusables() {
        return [...panel.querySelectorAll("button, input:not([disabled]), a[href], [tabindex='0']")]
          .filter((el) => el.offsetParent !== null);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close(null);
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
      document.addEventListener("keydown", onKey, true);

      overlay.querySelector("#acCancel").addEventListener("click", () => close(null));
      confirmBtn.addEventListener("click", () => {
        if (!versions.terms || !versions.kvkk_notice) {
          errorEl.textContent = tx("consent.loadFailed", "Metin yüklenemedi. İnternet bağlantını kontrol edip tekrar dene ya da metni yeni sekmede aç:");
          errorEl.hidden = false;
          return;
        }
        close({
          channel: "web",
          versions: { ...versions, marketing: versions.marketing || AGE_STATEMENT_VERSION },
          terms: true,
          kvkk_notice: true,
          age_statement: true,
          marketing: marketingBox.checked,
        });
      });

      update();
      overlay.querySelector(".ac-scroll").focus({ preventScroll: true });
    });
  }

  function armusEscape(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.armusLegalConsent = { open };
})();
