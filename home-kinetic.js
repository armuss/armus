/*
 * Homepage kinetic sections: the proof band (moving headline + fact
 * machine), the "3 steps" rows, the commission rates and the testimonials.
 * Styles live in home-kinetic.css.
 *
 * Adds html.hk-js, plus html.hk-motion unless the visitor prefers reduced
 * motion. Every hidden start state in the CSS is scoped to hk-motion, so
 * without this file (or with reduced motion) both sections render complete
 * and still; the fact tabs keep working either way.
 */
(function () {
  "use strict";

  const proof = document.querySelector(".hk-proof");
  const how = document.querySelector(".hk-how");
  const comm = document.querySelector(".hk-comm");
  const tst = document.querySelector(".hk-tst");
  if (!proof && !how && !comm && !tst) return;

  const root = document.documentElement;
  root.classList.add("hk-js");
  const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (motion) root.classList.add("hk-motion");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // i18n.js swaps translated elements' innerHTML (on the language toggle, and
  // again whenever auth.js re-applies translations), so anything built from
  // a translated element is rebuilt whenever that element's content changes.
  function watch(el, build) {
    build();
    new MutationObserver(build).observe(el, { childList: true, characterData: true, subtree: true });
  }

  // scroll speed and direction, shared by the moving headline
  let lastY = window.scrollY, vel = 0, dir = 1;
  window.addEventListener("scroll", () => {
    const d = window.scrollY - lastY;
    lastY = window.scrollY;
    if (Math.abs(d) > 0.5) dir = d > 0 ? 1 : -1;
    vel = Math.min(80, vel + Math.abs(d) * 0.6);
  }, { passive: true });

  /* ---------------- proof: moving headline ---------------- */
  function initMarquee() {
    const src = proof.querySelector(".hk-src");
    const rows = Array.from(proof.querySelectorAll(".hk-row"));
    if (!src || !rows.length) return;
    const STAR = '<svg class="hk-star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0C12.9 7.6 16.4 11.1 24 12C16.4 12.9 12.9 16.4 12 24C11.1 16.4 7.6 12.9 0 12C7.6 11.1 11.1 7.6 12 0Z"/></svg>';
    const state = rows.map((row) => ({ row, tracks: Array.from(row.querySelectorAll(".hk-track")), x: 0, w: 1 }));
    const lit = proof.querySelector(".hk-lit");

    function build() {
      const lines = src.innerHTML.split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean);
      state.forEach((s, i) => {
        const item = '<span class="hk-item">' + (lines[i] || lines[0] || "") + STAR + "</span>";
        s.tracks.forEach((t) => { t.innerHTML = item; });
        s.w = s.tracks[0].firstElementChild.getBoundingClientRect().width || 1;
        const copies = Math.ceil((window.innerWidth * 2) / s.w) + 1;
        s.tracks.forEach((t) => { t.innerHTML = item.repeat(copies); });
        s.x = -(((-s.x % s.w) + s.w) % s.w);
      });
    }
    watch(src, build);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
    let resizeT;
    window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(build, 150); });

    let px = 0, py = 0, hovering = false;
    if (lit && finePointer) {
      rows[0].addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; hovering = true; wake(); });
      rows[0].addEventListener("pointerleave", () => { hovering = false; });
    }

    // runs only while near the viewport. Woken straight from scroll events:
    // IntersectionObserver notices can lag ~0.5s behind a fast scroll,
    // long enough to see the rows frozen.
    const mq = proof.querySelector(".hk-marquee");
    const isNear = () => { const r = mq.getBoundingClientRect(); return r.bottom > -300 && r.top < window.innerHeight + 300; };
    let raf = 0, last = 0, frames = 0;
    const wake = () => { if (!raf && isNear()) raf = requestAnimationFrame(frame); };
    function frame(t) {
      raf = 0;
      if (++frames % 20 === 0 && !isNear()) { last = 0; return; }
      const dt = Math.min(64, t - (last || t));
      last = t;
      vel *= Math.pow(0.92, dt / 16.7);
      const speed = (0.045 + vel * 0.011) * dt * dir;
      const skew = clamp(vel * 0.22, 0, 11) * dir;
      state.forEach((s, i) => {
        s.x += i % 2 ? speed : -speed;
        if (s.x <= -s.w) s.x += s.w;
        if (s.x > 0) s.x -= s.w;
        const tf = "translate3d(" + s.x.toFixed(2) + "px,0,0) skewX(" + (i % 2 ? skew : -skew).toFixed(2) + "deg)";
        s.tracks.forEach((tr) => { tr.style.transform = tf; });
      });
      if (hovering) {
        // the flashlight follows the cursor in the moving track's own space
        const r = rows[0].getBoundingClientRect();
        lit.style.setProperty("--mx", (px - r.left - state[0].x).toFixed(1) + "px");
        lit.style.setProperty("--my", (py - r.top).toFixed(1) + "px");
      }
      raf = requestAnimationFrame(frame);
    }
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    wake();
  }

  /* ---------------- proof: fact machine ---------------- */
  function initMachine() {
    const m = proof.querySelector(".hk-machine");
    if (!m) return;
    const facts = Array.from(m.querySelectorAll(".hk-fact"));
    const phs = Array.from(m.querySelectorAll(".hk-ph"));
    const tabs = Array.from(m.querySelectorAll(".hk-tab"));
    const cols = Array.from(m.querySelectorAll(".hk-col"));
    const burst = m.querySelector(".hk-burst");
    const circ = m.querySelector(".hk-circ");
    cols.forEach((c) => { c.innerHTML = "<span>" + "0123456789".split("").map((d) => "<b>" + d + "</b>").join("") + "</span>"; });
    if (burst) burst.innerHTML = Array.from({ length: 12 }, (_, i) => '<i style="--a:' + (i * 30 + (i % 2 ? 9 : 0)) + "deg;--d:" + ((i % 3) * 0.05).toFixed(2) + 's"></i>').join("");

    let k = 0, z = 1, rollT, first = true;
    function setNumber(n) {
      if (!n || cols.length < 2) return;
      cols[0].firstChild.style.setProperty("--d", Math.floor(n / 10) % 10);
      cols[1].firstChild.style.setProperty("--d", n % 10);
    }
    function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

    function go(n) {
      const prev = k;
      k = (n + facts.length) % facts.length;
      m.dataset.k = k;
      facts.forEach((f, i) => {
        f.classList.toggle("is-on", i === k);
        f.classList.toggle("is-out", i === prev && prev !== k);
      });
      tabs.forEach((t, i) => {
        t.classList.toggle("is-on", i === k);
        t.setAttribute("aria-pressed", i === k ? "true" : "false");
      });
      setNumber(+facts[k].dataset.n);
      if (!motion) {
        phs.forEach((p, i) => p.classList.toggle("is-on", i === k));
        return;
      }
      m.classList.add("hk-rolling");
      clearTimeout(rollT);
      rollT = setTimeout(() => m.classList.remove("hk-rolling"), 650);
      if (prev !== k && phs[k]) {
        // the next photo opens from a random point on the rim, on top
        const p = phs[k], a = Math.random() * Math.PI * 2;
        p.style.transition = "none";
        p.classList.remove("is-on");
        p.style.setProperty("--cx", (50 + Math.cos(a) * 50).toFixed(1) + "%");
        p.style.setProperty("--cy", (50 + Math.sin(a) * 50).toFixed(1) + "%");
        p.style.zIndex = ++z;
        void p.offsetWidth;
        p.style.transition = "";
        p.classList.add("is-on");
        setTimeout(() => phs.forEach((q, i) => { if (i !== k) q.classList.remove("is-on"); }), 1250);
      }
      if (burst) restart(burst, "go");
      restart(m, "is-run");
    }

    tabs.forEach((t, i) => t.addEventListener("click", () => go(i)));
    // the active tab's underline doubles as the timer: when it fills, advance
    m.addEventListener("animationend", (e) => { if (e.animationName === "hk-grow") go(k + 1); });

    if (!motion) { setNumber(+facts[0].dataset.n); return; }

    let hover = false, inView = false;
    const sync = () => m.classList.toggle("is-paused", hover || !inView || document.hidden);
    m.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { hover = true; sync(); } });
    m.addEventListener("pointerleave", () => { hover = false; sync(); });
    document.addEventListener("visibilitychange", sync);
    sync();
    new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      if (inView && first) {
        first = false;
        setNumber(+facts[k].dataset.n);
        m.classList.add("hk-rolling");
        setTimeout(() => m.classList.remove("hk-rolling"), 650);
        if (burst) restart(burst, "go");
        restart(m, "is-run");
      }
      sync();
    }, { threshold: 0.6 }).observe(m);

    // swipe between facts on touch screens
    let sx = null;
    m.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") sx = e.clientX; });
    m.addEventListener("pointercancel", () => { sx = null; });
    m.addEventListener("pointerup", (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx;
      sx = null;
      if (Math.abs(dx) > 45) go(k + (dx < 0 ? 1 : -1));
    });

    if (finePointer && circ) {
      circ.addEventListener("pointermove", (e) => {
        const r = circ.getBoundingClientRect();
        circ.style.setProperty("--tx", (((e.clientX - r.left) / r.width - 0.5) * -14).toFixed(1) + "px");
        circ.style.setProperty("--ty", (((e.clientY - r.top) / r.height - 0.5) * -14).toFixed(1) + "px");
      });
      circ.addEventListener("pointerleave", () => { circ.style.setProperty("--tx", "0px"); circ.style.setProperty("--ty", "0px"); });
    }
  }

  /* ---------------- how it works ---------------- */
  function initHow() {
    const h2 = how.querySelector(".hk-h2");
    if (h2) {
      // every word rises out of its own mask; digits ("3") turn gold
      watch(h2, () => {
        if (h2.querySelector(".hk-w")) return;
        let i = 0;
        const out = [];
        h2.childNodes.forEach((node) => {
          if (node.nodeType === 3) {
            node.textContent.split(/(\s+)/).forEach((part) => {
              if (!part) return;
              if (/^\s+$/.test(part)) { out.push(" "); return; }
              out.push('<span class="hk-w' + (/^\d+$/.test(part) ? " hk-gold" : "") + '"><span style="--i:' + i++ + '">' + esc(part) + "</span></span>");
            });
          } else if (node.nodeName === "BR") {
            out.push("<br>");
          } else if (node.nodeType === 1) {
            out.push('<span class="hk-w"><span style="--i:' + i++ + '">' + node.outerHTML + "</span></span>");
          }
        });
        h2.innerHTML = out.join("");
      });
      if (motion) {
        new IntersectionObserver(([e], o) => {
          if (e.isIntersecting) { h2.classList.add("is-in"); o.disconnect(); }
        }, { threshold: 0.6, rootMargin: "0px 0px -20% 0px" }).observe(h2);
      }
    }

    // step 1: the search types itself (in the current language)
    const typed = how.querySelector(".hk-typed");
    const typedSrc = how.querySelector(".hk-typed-src");
    let typingDone = !motion;
    document.addEventListener("armus:langchange", () => {
      if (typed && typedSrc && typingDone) typed.textContent = typedSrc.textContent;
    });

    const steps = Array.from(how.querySelectorAll(".hk-step"));
    if (!motion) return;

    if (typed) typed.textContent = "";
    steps.forEach((s) => s.querySelectorAll(".hk-tc.is-hl").forEach((c) => c.classList.remove("is-hl")));

    const starters = {
      v1(step) {
        const par = step.querySelector(".hk-par");
        const cards = Array.from(step.querySelectorAll(".hk-tc"));
        const cursor = step.querySelector(".hk-cursor");
        let n = 0;
        (function type() {
          const full = typedSrc ? typedSrc.textContent : "";
          typed.textContent = full.slice(0, ++n);
          if (n < full.length) setTimeout(type, 55);
          else typingDone = true;
        })();
        if (cursor && par) {
          cursor.style.setProperty("--cx", par.offsetWidth - 60 + "px");
          cursor.style.setProperty("--cy", par.offsetHeight - 70 + "px");
        }
        let h = 0;
        function pick() {
          const c = cards[h];
          if (cursor) {
            cursor.style.setProperty("--cx", c.offsetLeft + c.offsetWidth * 0.66 + "px");
            cursor.style.setProperty("--cy", c.offsetTop + c.offsetHeight * 0.6 + "px");
          }
          setTimeout(() => {
            if (cursor) restart(cursor, "click");
            cards.forEach((x) => x.classList.toggle("is-hl", x === c));
            h = (h + 1) % cards.length;
          }, 950);
        }
        setTimeout(() => { pick(); setInterval(pick, 2600); }, 1500);
      },
      v2(step) {
        const clock = step.querySelector(".hk-clock");
        const cap = step.querySelector(".hk-cap");
        const line = step.querySelector(".hk-cap-text");
        let sec = 0;
        if (clock) setInterval(() => { sec++; clock.textContent = String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0"); }, 1000);
        if (!cap || !line) return;
        const lines = (cap.dataset.lines || "").split("|").filter(Boolean);
        let li = 0;
        (function say() {
          const s = lines[li % lines.length] || "";
          li++;
          line.textContent = "";
          cap.classList.add("is-on");
          let n = 0;
          (function type() {
            line.textContent = s.slice(0, ++n);
            if (n < s.length) setTimeout(type, 32);
            else setTimeout(() => { cap.classList.remove("is-on"); setTimeout(say, 650); }, 2600);
          })();
        })();
      },
      v3(step) {
        step.classList.add("is-drawn");
        const rider = step.querySelector(".hk-rider animateMotion");
        if (rider && rider.beginElement) setTimeout(() => rider.beginElement(), 2200);
        const seg = step.querySelector(".hk-seg");
        if (!seg) return;
        const opts = Array.from(seg.querySelectorAll("span"));
        const days = Array.from(step.querySelectorAll(".hk-days span"));
        const PLAN = [[1], [1, 3], [0, 2, 4]];
        let s = 1;
        const set = () => {
          seg.style.setProperty("--s", s);
          opts.forEach((o, j) => o.classList.toggle("is-on", j === s));
          days.forEach((d, j) => d.classList.toggle("is-on", PLAN[s].includes(j)));
        };
        setInterval(() => { s = (s + 1) % 3; set(); }, 2400);
      },
    };
    function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

    // scroll-linked: rule draws, gold rises in the number, visual opens
    const near = new Set();
    let running = false, last = 0, wx = 0;
    function tick(t) {
      if (!near.size) { running = false; last = 0; return; }
      const dt = Math.min(64, t - (last || t));
      last = t;
      wx = (wx + dt * 0.03) % 90;
      const vh = window.innerHeight;
      const reads = [];
      near.forEach((s) => {
        const num = s.querySelector(".hk-num");
        reads.push([s, s.getBoundingClientRect(), num, num.offsetHeight, s.querySelector(".hk-par")]);
      });
      reads.forEach(([s, r, num, h, par]) => {
        // the row's top travelling from 85% of the screen up to 25%:
        // everything below plays out across that stretch of scrolling
        const p = clamp((vh * 0.85 - r.top) / (vh * 0.6), 0, 1);
        const f = clamp((p - 0.1) / 0.85, 0, 1);
        s.style.setProperty("--p", p.toFixed(3));
        num.style.setProperty("--fy", (-16 + (h + 32) * (1 - f)).toFixed(1) + "px");
        num.style.setProperty("--wx", wx.toFixed(1) + "px");
        num.style.setProperty("--rot", ((1 - f) * -7).toFixed(2) + "deg");
        if (par) par.style.setProperty("--py", ((r.top + r.height / 2 - vh / 2) * -0.07).toFixed(1) + "px");
        if (p > 0.25 && !s.classList.contains("is-in")) {
          s.classList.add("is-in");
          const v = s.querySelector(".hk-pic");
          const key = v && ["v1", "v2", "v3"].find((c) => v.classList.contains("hk-" + c));
          if (key) starters[key](s);
        }
      });
      requestAnimationFrame(tick);
    }
    steps.forEach((s) => { s.style.setProperty("--p", 0); });
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => (e.isIntersecting ? near.add(e.target) : near.delete(e.target)));
      if (near.size && !running) { running = true; requestAnimationFrame(tick); }
    }, { rootMargin: "15% 0px 15% 0px" });
    steps.forEach((s) => io.observe(s));

    if (finePointer) {
      how.querySelectorAll(".hk-pic").forEach((pic) => {
        pic.addEventListener("pointermove", (e) => {
          const r = pic.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          pic.style.transform = "perspective(1000px) rotateX(" + (-y * 5).toFixed(2) + "deg) rotateY(" + (x * 5).toFixed(2) + "deg)";
        });
        pic.addEventListener("pointerleave", () => { pic.style.transform = ""; });
      });
    }
  }


  // runs `step(dt)` on every frame while `el` is within 200px of the
  // viewport; woken by scroll/resize, stops itself when far away
  function nearLoop(el, step) {
    let raf = 0, last = 0;
    const isNear = () => { const r = el.getBoundingClientRect(); return r.bottom > -200 && r.top < window.innerHeight + 200; };
    function frame(t) {
      raf = 0;
      if (!isNear()) { last = 0; return; }
      const dt = Math.min(64, t - (last || t));
      last = t;
      step(dt);
      raf = requestAnimationFrame(frame);
    }
    const wake = () => { if (!raf && isNear()) raf = requestAnimationFrame(frame); };
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    wake();
    return wake;
  }

  /* ---------------- commission: the higher rates get struck through ---------------- */
  function initComm() {
    const box = comm.querySelector(".hk-rates");
    if (!box) return;
    const rates = Array.from(box.querySelectorAll(".hk-rate"));
    const last = rates.length - 1;
    // `cut` rates are struck; once all the others are, the last one is circled
    const set = (cut) => rates.forEach((r, i) => {
      r.classList.toggle("is-cut", i < last && i < cut);
      r.classList.toggle("is-win", i === last && cut > last);
    });
    if (!motion) { set(rates.length); return; }
    let prev = -1;
    nearLoop(box, () => {
      const vh = window.innerHeight, stacked = window.innerWidth <= 900;
      const r = box.getBoundingClientRect();
      const p = clamp((vh * 0.85 - r.top) / (vh * (stacked ? 0.8 : 0.6)), 0, 1);
      const cut = Math.floor(p * (rates.length + 0.2));
      if (cut !== prev) { prev = cut; set(cut); }
    });
  }

  /* ---------------- testimonials: one at a time, with the names under it ---------------- */
  function initQuotes() {
    const grid = tst.querySelector(".hk-quotes");
    if (!grid) return;
    const title = tst.querySelector(".hk-tst-h");
    const people = document.createElement("div");
    people.className = "hk-people";
    people.setAttribute("role", "tablist");
    if (title && title.id) people.setAttribute("aria-labelledby", title.id);
    let rows = [], tabs = [], current = 0;

    function show(i, focus) {
      current = (i + rows.length) % rows.length;
      rows.forEach((row, n) => {
        const on = n === current;
        row.classList.toggle("is-on", on);
        row.setAttribute("aria-hidden", on ? "false" : "true");
        tabs[n].classList.toggle("is-on", on);
        tabs[n].setAttribute("aria-selected", on ? "true" : "false");
        tabs[n].tabIndex = on ? 0 : -1;
      });
      const tab = tabs[current];
      if (focus) tab.focus({ preventScroll: true });
      // on a phone the names are one sliding row: bring the current one to
      // its middle (scrolling the row itself, never the page)
      if (people.scrollWidth > people.clientWidth + 1) {
        const left = tab.offsetLeft - (people.clientWidth - tab.offsetWidth) / 2;
        people.scrollTo({ left, behavior: motion ? "smooth" : "auto" });
      }
    }
    // once the visitor picks a name themselves, the turns stop
    const take = () => people.classList.remove("is-auto");

    function build() {
      rows = Array.from(grid.querySelectorAll(".hk-rv"));
      people.textContent = "";
      tabs = [];
      rows.forEach((row, n) => {
        const p = row.querySelector(".hk-rv-text p");
        // the quotation marks are the design's own; a review typed with
        // its own doesn't get two pairs
        const text = p ? p.textContent.trim().replace(/^[“"«]+|[”"»]+$/g, "").trim() : "";
        if (p && p.textContent !== text) p.textContent = text;
        row.classList.toggle("hk-long", text.length > 150);
        row.id = "hkRv" + n;
        row.setAttribute("role", "tabpanel");
        row.setAttribute("aria-labelledby", "hkP" + n);

        const av = row.querySelector(".hk-av"), name = row.querySelector(".hk-rv-who strong"), place = row.querySelector(".hk-rv-who small");
        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "hk-p";
        tab.id = "hkP" + n;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", row.id);
        // a longer review stays up longer: about reading speed, within 6-12 seconds
        const words = text.split(/\s+/).length;
        tab.style.setProperty("--hk-turn", clamp(3.2 + words * 0.32, 6, 12).toFixed(1) + "s");
        tab.innerHTML = '<span class="hk-av" aria-hidden="true">' + esc(av ? av.textContent : "") + "</span>" +
          "<span><strong>" + esc(name ? name.textContent : "") + "</strong><small>" + esc(place ? place.textContent : "") + "</small></span>" +
          '<i class="hk-p-bar" aria-hidden="true"></i>';
        tab.addEventListener("click", () => { take(); show(n); });
        people.appendChild(tab);
        tabs.push(tab);
      });
      // one review needs no row of names, and has nothing to turn to
      const many = rows.length > 1;
      grid.classList.toggle("is-tabs", many);
      people.hidden = !many;
      people.classList.toggle("is-auto", many && motion);
      if (many) show(0);
      else rows.forEach((row) => { row.classList.remove("is-on"); row.removeAttribute("aria-hidden"); row.removeAttribute("role"); row.removeAttribute("aria-labelledby"); });
    }

    grid.after(people);
    build();

    people.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      take();
      show(e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : current + step, true);
    });
    // the line under the current name has filled: next review
    people.addEventListener("animationend", (e) => {
      if (e.animationName === "hk-tst-turn" && people.classList.contains("is-auto")) show(current + 1);
    });
    // no turns while the section is off screen
    if ("IntersectionObserver" in window) {
      people.classList.add("is-held");
      new IntersectionObserver((entries) => {
        people.classList.toggle("is-held", !entries[entries.length - 1].isIntersecting);
      }, { threshold: 0.35 }).observe(tst);
    }
    // the admin-panel testimonials replace the static ones after load
    new MutationObserver(build).observe(grid, { childList: true });
  }

  if (proof) { if (motion) initMarquee(); initMachine(); }
  if (how) initHow();
  if (comm) initComm();
  if (tst) initQuotes();
})();
