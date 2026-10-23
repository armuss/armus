/*
 * ARMUS - the "pick a new time" dialog for moving a lesson
 * (reschedule-booking Edge Function, migration_107.sql). Shared by
 * my-lessons.html (student: the teacher's own open hours) and
 * dashboard.html (teacher: any free time of their own).
 *
 * Needs bookings.js (armusSlotsForDate, armusAllTimeSlots,
 * armusZonedTimeToUtc, armusFormatSlotTimeRangeForViewer, armusDayNames)
 * and i18n.js (armusT) loaded first.
 */

const ARMUS_RESCHEDULE_DAYS_SHOWN = 14;

function armusInjectRescheduleStyles() {
  if (document.getElementById("armusRescheduleStyles")) return;
  const style = document.createElement("style");
  style.id = "armusRescheduleStyles";
  style.textContent = `
    .rs-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0, 0, 0, .55); }
    .rs-dialog { width: 100%; max-width: 560px; max-height: calc(100vh - 32px); display: flex; flex-direction: column; gap: 14px; padding: 22px; border-radius: 18px; background: var(--armus-panel, #1a1712); border: 1px solid var(--armus-border, #2e2a22); color: var(--armus-ink, #f4f4f2); }
    .rs-dialog h2 { font-size: 18px; margin: 0; }
    .rs-note { font-size: 12.5px; line-height: 1.5; color: var(--armus-muted, #a3a3a6); margin: 0; }
    .rs-dates { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
    .rs-date { flex: 0 0 auto; min-width: 52px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px; border-radius: 12px; border: 1px solid var(--armus-border, #2e2a22); background: transparent; color: inherit; font: inherit; cursor: pointer; }
    .rs-date span:first-child { font-size: 11px; color: var(--armus-muted, #a3a3a6); }
    .rs-date span:last-child { font-size: 15px; font-weight: 700; }
    .rs-date[aria-pressed="true"] { border-color: var(--armus-gold-text, #b8860b); box-shadow: inset 0 0 0 1px var(--armus-gold-text, #b8860b); }
    .rs-slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; overflow-y: auto; min-height: 60px; }
    .rs-slot { padding: 9px 6px; border-radius: 10px; border: 1px solid var(--armus-border, #2e2a22); background: transparent; color: inherit; font: inherit; font-size: 12.5px; cursor: pointer; }
    .rs-slot[aria-pressed="true"] { border-color: var(--armus-gold-text, #b8860b); box-shadow: inset 0 0 0 1px var(--armus-gold-text, #b8860b); font-weight: 700; }
    .rs-empty { grid-column: 1 / -1; font-size: 12.5px; color: var(--armus-muted, #a3a3a6); }
    .rs-actions { display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; }
    .rs-btn { padding: 10px 16px; border-radius: 10px; border: 1px solid var(--armus-border, #2e2a22); background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .rs-btn-primary { border: none; background: var(--armus-gold-gradient, linear-gradient(90deg, #e8c777, #b8860b)); color: var(--armus-on-gold, #1c1c1e); }
    .rs-btn:disabled { opacity: .45; cursor: not-allowed; }
    .rs-date:focus-visible, .rs-slot:focus-visible, .rs-btn:focus-visible { outline: 2px solid var(--armus-gold-text, #b8860b); outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}

// "today" as the TEACHER's own calendar date (same reasoning as
// booking.html's teacherTodayAnchor) - a plain local Date used only for
// calendar arithmetic
function armusTeacherToday(timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date()).map(p => [p.type, p.value])
  );
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

// options:
//   teacher      - { id, availabilityDates, weeklyAvailability } whose
//                  open hours to offer, or null for "any free time"
//   timeZone     - the teacher's timezone (lesson times are wall-clock in it)
//   busyTimes    - { date, time, status? }[] already taken
//   current      - { date, time } the lesson's current slot (never offered)
//   title, note, confirmLabel
// Resolves { date, time } once picked and confirmed, or null if closed.
function armusOpenReschedulePicker(options) {
  armusInjectRescheduleStyles();
  const { teacher, timeZone, busyTimes, current } = options;
  const slotSource = teacher || {
    id: "any",
    availabilityDates: Object.assign({ _set: true }, ...[0, 1, 2, 3, 4, 5, 6].map(d => ({ [d]: armusAllTimeSlots() }))),
  };
  // the lesson's own slot is about to move - it must not block the
  // slots right next to it
  const busy = (busyTimes || []).filter(b => !(current && b.date === current.date && b.time === current.time));

  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "rs-overlay";
    overlay.innerHTML = `
      <div class="rs-dialog" role="dialog" aria-modal="true" aria-labelledby="rsTitle">
        <h2 id="rsTitle"></h2>
        <p class="rs-note"></p>
        <div class="rs-dates" role="group"></div>
        <div class="rs-slots" role="group"></div>
        <div class="rs-actions">
          <button type="button" class="rs-btn" data-rs-close></button>
          <button type="button" class="rs-btn rs-btn-primary" data-rs-confirm disabled></button>
        </div>
      </div>
    `;
    overlay.querySelector("#rsTitle").textContent = options.title || armusT("reschedule.title", "Yeni bir saat seç");
    const noteEl = overlay.querySelector(".rs-note");
    if (options.note) noteEl.textContent = options.note; else noteEl.remove();
    overlay.querySelector("[data-rs-close]").textContent = armusT("reschedule.close", "Vazgeç");
    const confirmBtn = overlay.querySelector("[data-rs-confirm]");
    confirmBtn.textContent = options.confirmLabel || armusT("reschedule.confirm", "Bu saati seç");

    const datesEl = overlay.querySelector(".rs-dates");
    const slotsEl = overlay.querySelector(".rs-slots");
    let picked = null;

    function finish(result) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(result);
    }
    function onKey(e) { if (e.key === "Escape") finish(null); }
    document.addEventListener("keydown", onKey);
    overlay.addEventListener("click", e => { if (e.target === overlay) finish(null); });
    overlay.querySelector("[data-rs-close]").addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => { if (picked) finish(picked); });

    function renderSlots(dateKey, dayOfWeek) {
      picked = null;
      confirmBtn.disabled = true;
      slotsEl.innerHTML = "";
      const now = Date.now();
      const open = armusSlotsForDate(slotSource, dateKey, dayOfWeek, busy).filter(s =>
        s.available
        && !(current && dateKey === current.date && s.time === current.time)
        && armusZonedTimeToUtc(dateKey, s.time, timeZone).getTime() > now
      );
      if (!open.length) {
        slotsEl.innerHTML = `<div class="rs-empty"></div>`;
        slotsEl.firstChild.textContent = armusT("reschedule.noSlots", "Bu tarihte boş saat yok, başka bir gün dene.");
        return;
      }
      open.forEach(slot => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rs-slot";
        btn.dataset.time = slot.time;
        btn.setAttribute("aria-pressed", "false");
        btn.textContent = armusFormatSlotTimeRangeForViewer(dateKey, slot.time, timeZone);
        btn.addEventListener("click", () => {
          slotsEl.querySelectorAll(".rs-slot").forEach(b => b.setAttribute("aria-pressed", "false"));
          btn.setAttribute("aria-pressed", "true");
          picked = { date: dateKey, time: slot.time };
          confirmBtn.disabled = false;
        });
        slotsEl.appendChild(btn);
      });
    }

    const today = armusTeacherToday(timeZone);
    const dayNames = armusDayNames();
    for (let i = 0; i < ARMUS_RESCHEDULE_DAYS_SHOWN; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateKey = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rs-date";
      btn.dataset.date = dateKey;
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = `<span>${dayNames[date.getDay()]}</span><span>${date.getDate()}</span>`;
      btn.addEventListener("click", () => {
        datesEl.querySelectorAll(".rs-date").forEach(b => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        renderSlots(dateKey, date.getDay());
      });
      datesEl.appendChild(btn);
    }

    document.body.appendChild(overlay);
    const first = datesEl.querySelector(".rs-date");
    first.click();
    first.focus();
  });
}

// "14 Eki Çar, 15:00 – 15:50" in the viewer's own time, for a request's
// new slot
function armusFormatRescheduleSlot(dateKey, time, teacherTimezone) {
  const when = armusFormatLessonWhen({ date: dateKey, time, teacherTimezone });
  return `${when.dateLabel}, ${when.timeRange}`;
}
