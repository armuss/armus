/* how-it-works page motion (design "Yol").
 * html.hw-motion is added in the page head when motion is allowed; every
 * hidden start state in the page CSS is scoped to it, so without this
 * script (or with reduced motion) the page simply shows its final state. */
(function () {
  "use strict";
  window.__hwOK = true;
  const root = document.documentElement;
  const motion = root.classList.contains("hw-motion");
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lang = () => (typeof armusGetLang === "function" ? armusGetLang() : "tr");

  // i18n swaps innerHTML on language change (and auth.js re-applies it), so
  // anything we rebuild from translated markup re-runs when it changes.
  function watch(el, build) {
    if (!el) return;
    build();
    new MutationObserver(build).observe(el, { childList: true });
  }

  function init() {
    hero();
    path();
    stats();
    tiles();
    quote();
  }

  /* ---------- hero: lines rise ---------- */
  function hero() {
    const h1 = document.getElementById("hwTitle");
    watch(h1, () => {
      if (h1.querySelector(".hw-l")) return;
      h1.innerHTML = h1.innerHTML.split(/<br\s*\/?>/i)
        .map((part) => '<span class="hw-l"><span>' + part.trim() + "</span></span>").join("");
    });
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById("hwHero").classList.add("in")));
  }

  /* ---------- the path ---------- */
  function path() {
    const sec = document.getElementById("hwPath");
    const svg = sec.querySelector(".hw-track");
    const bg = svg.querySelector(".bg"), fg = svg.querySelector(".fg"), dot = svg.querySelector(".dot");
    const steps = [...sec.querySelectorAll(".hw-step")];
    let lut = [], total = 1, nums = [], raf = 0;

    function build() {
      const W = sec.clientWidth, H = sec.clientHeight, sr = sec.getBoundingClientRect();
      const mobile = matchMedia("(max-width: 900px)").matches;
      nums = steps.map((s) => {
        const r = s.querySelector(".hw-num").getBoundingClientRect();
        return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 };
      });
      const x0 = nums[0].x;
      const pts = [{ x: x0, y: 0 }, ...nums, { x: x0, y: H }];
      let d = "M" + pts[0].x + " " + pts[0].y;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dy = b.y - a.y;
        const w = mobile ? 0 : (i % 2 ? 1 : -1) * Math.min(90, W * 0.08);
        d += " C" + (a.x + w) + " " + (a.y + dy * 0.45) + " " + (b.x - w) + " " + (b.y - dy * 0.45) + " " + b.x + " " + b.y;
      }
      bg.setAttribute("d", d);
      fg.setAttribute("d", d);
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      // y -> length lookup (the path only ever moves downwards)
      total = fg.getTotalLength();
      lut = [];
      for (let i = 0; i <= 240; i++) {
        const l = (total * i) / 240;
        lut.push([fg.getPointAtLength(l).y, l]);
      }
      update();
    }

    function lenAt(y) {
      if (y <= lut[0][0]) return 0;
      for (let i = 1; i < lut.length; i++) {
        if (lut[i][0] >= y) {
          const [y0, l0] = lut[i - 1], [y1, l1] = lut[i];
          return l0 + (l1 - l0) * ((y - y0) / Math.max(1e-6, y1 - y0));
        }
      }
      return total;
    }

    function update() {
      raf = 0;
      if (!lut.length) return;
      const vh = innerHeight, r = sec.getBoundingClientRect();
      const head = clamp(vh * 0.6 - r.top, 0, r.height);
      const len = motion ? lenAt(head) : total;
      fg.style.setProperty("--o", String(1 - len / total));
      const pt = fg.getPointAtLength(Math.max(0.01, len));
      dot.setAttribute("cx", pt.x);
      dot.setAttribute("cy", pt.y);
      steps.forEach((s, i) => {
        if (!s.classList.contains("on") && (!motion || head >= nums[i].y - 20)) start(s, i);
      });
    }
    const queue = () => { if (!raf) raf = requestAnimationFrame(update); };

    build();
    addEventListener("scroll", queue, { passive: true });
    let rt = 0;
    addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(build, 120); });
    // images and fonts change row heights after first layout
    addEventListener("load", build);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
    if ("ResizeObserver" in window) new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(build, 120); }).observe(sec);
  }

  /* ---------- step visuals ---------- */
  const starters = [v1, v2, v3];
  function start(step, i) {
    step.classList.add("on");
    if (motion) starters[i](step.querySelector(".hw-vis"));
  }

  // does something only while the visual is on screen
  function whileVisible(el, tick, every) {
    let id = 0;
    const io = new IntersectionObserver(([e]) => {
      clearInterval(id);
      id = 0;
      if (e.isIntersecting && !document.hidden) id = setInterval(tick, every);
    });
    io.observe(el);
  }

  function v1(vis) {
    // the intro video starts, then its caption appears
    const box = vis.querySelector(".hw-v1");
    setTimeout(() => box.classList.add("playing"), 1100);
    setTimeout(() => box.classList.add("subs"), 1700);
  }

  function v2(vis) {
    const clock = vis.querySelector(".hw-clock"), bubble = vis.querySelector(".hw-bubble"), cap = vis.querySelector(".hw-cap");
    const lines = bubble.dataset.lines.split("|");
    let s = 0, k = 0;
    bubble.animate([{ opacity: 0, transform: "translateY(14px) scale(.96)" }, { opacity: 1, transform: "none" }],
      { duration: 700, delay: 700, easing: "cubic-bezier(.34,1.56,.64,1)", fill: "backwards" });
    whileVisible(vis, () => {
      s++;
      clock.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
      if (s % 4 === 0) {
        k = (k + 1) % lines.length;
        cap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).onfinish = () => {
          cap.textContent = lines[k];
          cap.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 350, fill: "forwards" });
        };
      }
    }, 1000);
  }

  function v3(vis) {
    const chips = [...vis.querySelectorAll(".hw-words span")], cnt = vis.querySelector(".hw-cnt");
    const base = Number(cnt.textContent) || 130;
    chips.forEach((c, i) => setTimeout(() => c.classList.add("in"), 500 + i * 110));
    countUp(cnt, base, 1600, (v) => String(v));
    let total = base, last = -1;
    setTimeout(() => whileVisible(vis, () => {
      chips.forEach((c) => c.classList.remove("new"));
      let i;
      do { i = Math.floor(Math.random() * chips.length); } while (i === last && chips.length > 1);
      last = i;
      void chips[i].offsetWidth;
      chips[i].classList.add("new");
      cnt.textContent = String(++total);
      cnt.animate([{ transform: "scale(1.25)" }, { transform: "none" }], { duration: 400, easing: "cubic-bezier(.34,1.56,.64,1)" });
    }, 2600), 2200);
  }

  function countUp(el, to, ms, fmt) {
    const t0 = performance.now();
    (function f(now) {
      const p = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(to * e));
      if (p < 1) requestAnimationFrame(f);
    })(t0);
  }

  /* ---------- numbers band ---------- */
  function stats() {
    const els = [...document.querySelectorAll(".hw-stat strong")];
    const fmt = (el, v) => {
      const tr = lang() === "tr";
      const n = v.toLocaleString(tr ? "tr-TR" : "en-US");
      return el.dataset.fmt === "pct" ? (tr ? "%" + n : n + "%") : n + "+";
    };
    let counted = !motion;
    const final = () => els.forEach((el) => { el.textContent = fmt(el, Number(el.dataset.to)); });
    final();
    document.addEventListener("armus:langchange", () => { if (counted) final(); });
    if (!motion) return;
    els.forEach((el) => { el.textContent = fmt(el, 0); });
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      els.forEach((el, i) => setTimeout(() => countUp(el, Number(el.dataset.to), 2200, (v) => fmt(el, v)), i * 180));
      setTimeout(() => { counted = true; final(); }, 2200 + els.length * 180 + 50);
    }, { rootMargin: "0px 0px -30% 0px" });
    io.observe(document.querySelector(".hw-stats"));
  }

  /* ---------- benefit tiles ---------- */
  function tiles() {
    const all = [...document.querySelectorAll(".hw-tile")];
    if (!motion) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const i = all.indexOf(e.target);
      setTimeout(() => e.target.classList.add("in"), (matchMedia("(max-width: 900px)").matches ? 0 : i) * 160);
    }), { rootMargin: "0px 0px -25% 0px" });
    all.forEach((t) => io.observe(t));
  }

  /* ---------- quote lights up word by word ---------- */
  function quote() {
    const p = document.getElementById("hwQuote");
    let words = [], raf = 0;
    watch(p, () => {
      if (!p.querySelector(".hw-wd")) {
        p.innerHTML = p.textContent.trim().split(/\s+/).map((w) => '<span class="hw-wd">' + w.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</span>").join(" ");
      }
      words = [...p.querySelectorAll(".hw-wd")];
      update();
    });
    function update() {
      raf = 0;
      if (!motion) return;
      const vh = innerHeight, r = p.getBoundingClientRect();
      const doc = document.documentElement;
      // finish no lower than the highest point the paragraph can reach
      const maxScroll = doc.scrollHeight - vh, reachTop = r.top - (maxScroll - scrollY);
      const end = Math.max(vh * 0.35, reachTop + 4), startY = Math.max(vh * 0.85, end + vh * 0.3);
      const k = clamp((startY - r.top) / (startY - end), 0, 1);
      const lit = Math.round(k * words.length);
      words.forEach((w, i) => w.classList.toggle("on", i < lit));
    }
    addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    addEventListener("resize", update);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
