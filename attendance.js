/*
 * ARMUS - teacher attendance reports (a student flags that a teacher
 * didn't show up, or started late, for one of their own bookings).
 * Requires supabase-config.js (Supabase SDK + armusSupabase client) to be
 * loaded first. See migration_41.sql for the full policy behind this:
 * a report immediately hides the teacher from new students until an
 * admin resolves it, and repeated admin-confirmed reports escalate to a
 * temporary or permanent hide.
 */

// migration_112.sql's lesson rules, mirrored for the UI (the database is
// the real gate): a report can be filed until 24 hours after the lesson;
// up to 15 minutes late is a warning, more and the student picks between
// "held with the time left" and "count it as not held"; a technical
// problem on the teacher's side with under 25 minutes held gives the
// lesson back.
const ARMUS_REPORT_WINDOW_HOURS = 24;
const ARMUS_LATE_WARNING_MINUTES = 15;
const ARMUS_TECH_REFUND_MINUTES = 25;

// type: "no_show", "late" or "technical". lateMinutes: how many minutes
// past the scheduled start the teacher joined (optional, also kept on a
// no-show the student chose after a long wait). techSide ("teacher" /
// "student") and minutesHeld: a technical report.
// Returns the new report row on success, or false if it failed (already
// reported, not the student's own booking, too late, etc).
async function armusReportAttendanceIssue({ bookingId, teacherId, studentId, type, lateMinutes, note, techSide, minutesHeld }) {

  const row = {
    booking_id: bookingId,
    teacher_id: teacherId,
    student_id: studentId,
    type,
  };
  if ((type === "late" || type === "no_show") && lateMinutes) row.late_minutes = lateMinutes;
  if (type === "technical") {
    row.tech_side = techSide;
    if (Number.isFinite(minutesHeld)) row.minutes_held = minutesHeld;
  }
  if (note) row.student_note = note;

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .insert(row)
    .select()
    .single();

  if (error) return false;
  return armusMapAttendanceReportRow(data);
}

// Whether this booking already has an attendance report - used to skip
// asking again (the post-class check-in) and to show the student their
// own report's status.
async function armusGetAttendanceReportForBooking(bookingId) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapAttendanceReportRow(data);
}

// The teacher's own open (not yet reviewed) report, if any - dashboard.html
// shows the warning banner and explanation form from this. A teacher only
// ever has at most one truly "open" one at a time in practice (each new
// report is tied to a different booking), but this returns the most
// recent if somehow more than one is open.
async function armusGetOwnOpenAttendanceReport(teacherId) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .eq("teacher_id", teacherId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapAttendanceReportRow(data);
}

// The teacher's own report that most needs their attention right now:
// any still-open one first (so it can actually be explained - a teacher
// can end up with more than one open report at once, from different
// bookings, before an admin gets to either of them, and without this
// preference dashboard.html would only ever surface whichever one
// happens to be more recent, silently stranding an older open report
// nobody could ever explain through the UI), otherwise the single most
// recent report regardless of status, so an "awaiting review"
// (explained) or a resolved one still has something to show.
async function armusGetLatestOwnAttendanceReport(teacherId) {

  const openReport = await armusGetOwnOpenAttendanceReport(teacherId);
  if (openReport) return openReport;

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return armusMapAttendanceReportRow(data);
}

// The teacher submits their one explanation - only works while the
// report is still "open" (enforced server-side, see migration_41.sql).
// Returns the updated row, or false on failure.
async function armusSubmitAttendanceExplanation(reportId, explanation) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .update({ status: "explained", teacher_explanation: explanation })
    .eq("id", reportId)
    .select()
    .single();

  if (error) return false;
  return armusMapAttendanceReportRow(data);
}

// Admin-only: every attendance report. The
// attendance_reports_select_participant_or_admin RLS policy is what
// actually enforces this - a non-admin caller only gets their own.
async function armusAdminGetAllAttendanceReports() {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error || !data) return [];
  return data.map(armusMapAttendanceReportRow);
}

// Admin-only: resolve a report. status is "upheld" or "dismissed" - the
// hide/unhide and the repeated-violation escalation (ban / temporary
// full hide) all happen server-side (see migration_41.sql), nothing
// further to do here once this succeeds. falseReport (dismissed only,
// migration_112.sql): the student made it up - a strike against them.
async function armusAdminResolveAttendanceReport(reportId, status, falseReport) {

  const { data, error } = await armusSupabase
    .from("attendance_reports")
    .update(status === "dismissed" ? { status, false_report: !!falseReport } : { status })
    .eq("id", reportId)
    .select()
    .single();

  if (error) return false;
  return armusMapAttendanceReportRow(data);
}

// The teacher's own self-service "make visible" action for the
// trial-no-show escalation ladder (migration_100.sql) - mirrors
// Preply's "Make visible" button. Returns the RPC's own result string:
// "ok" | "not_eligible" | "ack_required" | "no_action".
async function armusSelfUnhideFromNewStudents(ack) {

  const { data, error } = await armusSupabase.rpc("self_unhide_from_new_students", { p_ack: !!ack });

  if (error) return "no_action";
  return data;
}

function armusMapAttendanceReportRow(row) {
  return {
    id: row.id,
    bookingId: row.booking_id,
    teacherId: row.teacher_id,
    studentId: row.student_id,
    type: row.type,
    lateMinutes: row.late_minutes,
    techSide: row.tech_side || null,
    minutesHeld: row.minutes_held ?? null,
    falseReport: row.false_report === true,
    studentNote: row.student_note,
    status: row.status,
    teacherExplanation: row.teacher_explanation,
    createdAt: row.created_at,
    explainedAt: row.explained_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

// ---- who was in the class room (lesson_presence, migration_112.sql) ----

// Called about once a minute while someone is in the call - the database
// only counts it for the lesson's own student/teacher, around its time.
async function armusLessonHeartbeat(bookingId) {
  try {
    await armusSupabase.rpc("lesson_heartbeat", { p_booking_id: bookingId });
  } catch (err) {}
}

// { student: {firstSeenAt, lastSeenAt, minutes} | null, teacher: ... }
// keyed by booking id - for the admin's report review (and the lesson's
// own participants)
async function armusGetLessonPresence(bookingIds) {
  const ids = (bookingIds || []).filter(Boolean);
  if (!ids.length) return {};
  const { data, error } = await armusSupabase
    .from("lesson_presence")
    .select("*")
    .in("booking_id", ids);
  if (error || !data) return {};
  const byBooking = {};
  data.forEach(row => {
    byBooking[row.booking_id] = byBooking[row.booking_id] || { student: null, teacher: null };
    byBooking[row.booking_id][row.role] = {
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      minutes: Math.round((row.seconds_present || 0) / 60),
    };
  });
  return byBooking;
}

// ---- a student reports a teacher to the admin (teacher_reports) ----

function armusTeacherReportReasons() {
  return {
    harassment: armusT("teacherReport.reasonHarassment", "Taciz ya da hakaret"),
    inappropriate: armusT("teacherReport.reasonInappropriate", "Uygunsuz davranış ya da içerik"),
    payment_bypass: armusT("teacherReport.reasonPaymentBypass", "Site dışında ödeme ya da iletişim istedi"),
    scam: armusT("teacherReport.reasonScam", "Dolandırıcılık şüphesi"),
    unprofessional: armusT("teacherReport.reasonUnprofessional", "Profesyonel olmayan davranış"),
    other: armusT("teacherReport.reasonOther", "Diğer"),
  };
}

// Returns true, "duplicate" (an open report on this teacher already), or false.
async function armusReportTeacher({ teacherId, reporterId, bookingId, reason, note }) {
  const row = { teacher_id: teacherId, reporter_id: reporterId, reason };
  if (bookingId) row.booking_id = bookingId;
  if (note) row.note = note.slice(0, 2000);
  const { error } = await armusSupabase.from("teacher_reports").insert(row);
  if (error) return error.code === "23505" ? "duplicate" : false;
  return true;
}

// A small modal to pick a reason and add a note - the same on the
// teacher's profile and on a lesson card. Resolves when it closes.
function armusEnsureReportModalStyles() {
  if (document.getElementById("armusReportModalStyles")) return;
  const style = document.createElement("style");
  style.id = "armusReportModalStyles";
  style.textContent = `
    .armus-report-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .armus-report-modal { background: var(--armus-panel, #fff); color: var(--armus-ink, #1c1c1e); border-radius: 16px; padding: 22px; width: 100%; max-width: 420px; box-shadow: 0 20px 60px rgba(0,0,0,.25); display: flex; flex-direction: column; gap: 10px; }
    .armus-report-modal h3 { margin: 0; font-size: 17px; }
    .armus-report-modal p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--armus-muted, #666); }
    .armus-report-modal label { font-size: 12.5px; font-weight: 600; }
    .armus-report-modal select, .armus-report-modal textarea { width: 100%; box-sizing: border-box; border: 1.5px solid var(--armus-border, #ddd); border-radius: 10px; padding: 9px 11px; font: inherit; font-size: 13.5px; background: var(--armus-panel, #fff); color: inherit; }
    .armus-report-modal textarea { min-height: 90px; resize: vertical; }
    .armus-report-status { color: #c0392b !important; }
    .armus-report-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 6px; }
    .armus-report-actions button { border: 1.5px solid var(--armus-border, #ddd); background: transparent; color: inherit; border-radius: 10px; padding: 9px 16px; font: inherit; font-size: 13.5px; font-weight: 600; cursor: pointer; }
    .armus-report-actions button.primary { background: var(--armus-gold-3, #8c1c24); border-color: var(--armus-gold-3, #8c1c24); color: var(--armus-on-gold, #faf5e2); }
    .armus-report-actions button:disabled { opacity: .5; cursor: default; }
    .armus-report-actions button:focus-visible, .armus-report-modal select:focus-visible, .armus-report-modal textarea:focus-visible { outline: 2px solid var(--armus-gold-3, #8c1c24); outline-offset: 2px; }
  `;
  document.head.appendChild(style);
}

function armusOpenTeacherReportModal({ teacherId, teacherName, reporterId, bookingId }) {
  armusEnsureReportModalStyles();
  return new Promise(resolve => {
    const reasons = armusTeacherReportReasons();
    const overlay = document.createElement("div");
    overlay.className = "armus-report-overlay";
    overlay.innerHTML = `
      <div class="armus-report-modal" role="dialog" aria-modal="true" aria-labelledby="armusReportTitle">
        <h3 id="armusReportTitle">${armusEscapeHtml(armusT("teacherReport.title", "{name} hakkında şikayet").replace("{name}", teacherName || ""))}</h3>
        <p>${armusT("teacherReport.text", "Şikayetin sadece ARMUS ekibine gider, öğretmen kimin bildirdiğini görmez.")}</p>
        <label for="armusReportReason">${armusT("teacherReport.reasonLabel", "Sebep")}</label>
        <select id="armusReportReason">
          ${Object.entries(reasons).map(([value, label]) => `<option value="${value}">${armusEscapeHtml(label)}</option>`).join("")}
        </select>
        <label for="armusReportNote">${armusT("teacherReport.noteLabel", "Ne oldu? (isteğe bağlı)")}</label>
        <textarea id="armusReportNote" maxlength="2000"></textarea>
        <p class="armus-report-status" hidden></p>
        <div class="armus-report-actions">
          <button type="button" data-close>${armusT("class.cancel", "İptal")}</button>
          <button type="button" class="primary" data-send>${armusT("teacherReport.send", "Şikayeti Gönder")}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = sent => { overlay.remove(); resolve(sent); };
    const status = overlay.querySelector(".armus-report-status");
    overlay.querySelector("[data-close]").addEventListener("click", () => close(false));
    overlay.addEventListener("click", e => { if (e.target === overlay) close(false); });
    overlay.querySelector("[data-send]").addEventListener("click", async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const result = await armusReportTeacher({
        teacherId, reporterId, bookingId,
        reason: overlay.querySelector("#armusReportReason").value,
        note: overlay.querySelector("#armusReportNote").value.trim(),
      });
      if (result === true) {
        overlay.querySelector(".armus-report-modal").innerHTML = `
          <h3>${armusT("teacherReport.sentTitle", "Şikayetin alındı")}</h3>
          <p>${armusT("teacherReport.sentText", "Ekibimiz inceleyecek ve gerekirse seninle iletişime geçecek. Acil bir durum varsa destek ekibimize de yazabilirsin.")}</p>
          <div class="armus-report-actions"><button type="button" class="primary" data-done>${armusT("class.close", "Kapat")}</button></div>
        `;
        overlay.querySelector("[data-done]").addEventListener("click", () => close(true));
        return;
      }
      btn.disabled = false;
      status.hidden = false;
      status.textContent = result === "duplicate"
        ? armusT("teacherReport.duplicate", "Bu öğretmen hakkında incelenmeyi bekleyen bir şikayetin zaten var.")
        : armusT("teacherReport.failed", "Şikayet gönderilemedi. Bu öğretmenle bir dersin ya da yazışman olmalı.");
    });
  });
}

// Admin-only (teacher_reports_select_own_or_admin)
async function armusAdminGetTeacherReports() {
  const { data, error } = await armusSupabase
    .from("teacher_reports")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data;
}

async function armusAdminResolveTeacherReport(id, adminNote) {
  const { data, error } = await armusSupabase
    .from("teacher_reports")
    .update({ status: "resolved", admin_note: adminNote || null, resolved_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) return false;
  return data;
}

// ---- "did the lesson happen?" - the one flow class.html (in the room
// and on leaving) and my-lessons.html (afterwards, from the email) share ----
//
// opts:
//   booking, studentId
//   noShowReady   - the 10-minute grace after the start has passed
//   askHappened   - also offer "yes, it happened" -> onHappened()
//   onFiled(report, message) - a report went in (default: show message)
//   onCancel      - adds a cancel button
//   ui            - class names: options, actions, choice, primary, secondary, input
function armusRenderAttendanceFlow(container, opts) {
  const { booking, studentId, noShowReady = true, askHappened = false, onHappened, onFiled, onCancel } = opts;
  const ui = Object.assign({
    options: "attendance-report-options",
    actions: "post-class-actions",
    choice: "btn btn-light",
    primary: "btn btn-light",
    secondary: "btn",
    input: "",
  }, opts.ui || {});
  const WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
  const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
  const PLUG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l22 22"></path><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>';
  const t = armusT;

  const actions = (...buttons) => `<div class="${ui.actions}">${buttons.join("")}</div>`;
  const backBtn = `<button type="button" class="${ui.secondary}" data-back>${t("attendance.back", "← Geri")}</button>`;
  const cancelBtn = onCancel ? `<button type="button" class="${ui.secondary}" data-cancel>${t("class.cancel", "İptal")}</button>` : "";
  const wire = (selector, handler) => {
    const el = container.querySelector(selector);
    if (el) el.addEventListener("click", handler);
  };
  const wireCommon = () => {
    wire("[data-back]", main);
    wire("[data-cancel]", () => onCancel());
  };
  const readNumber = (input, min, max) => {
    const raw = input.value.trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  async function submit(fields, message) {
    container.innerHTML = `<p>${t("class.reportSending", "Gönderiliyor...")}</p>`;
    const report = await armusReportAttendanceIssue({
      bookingId: booking.id, teacherId: booking.teacherId, studentId, ...fields,
    });
    if (!report) {
      container.innerHTML = `
        <p>${t("attendance.failed", "Bildirim gönderilemedi. Ders bitiminden sonraki 24 saat içinde ve sadece bir kez bildirim yapılabilir - lütfen tekrar dene.")}</p>
        ${actions(backBtn, `<button type="button" class="${ui.primary}" data-retry>${t("class.reportRetry", "Tekrar dene")}</button>`)}
      `;
      wireCommon();
      wire("[data-retry]", () => submit(fields, message));
      return;
    }
    if (onFiled) onFiled(report, message);
    else container.innerHTML = `<p>${message}</p>`;
  }

  function main() {
    container.innerHTML = `
      <div class="${ui.options}">
        ${askHappened ? `<button type="button" class="${ui.choice}" data-pick="yes"><span>${t("attendance.yes", "Evet, ders yapıldı")}</span></button>` : ""}
        <button type="button" class="${ui.choice}" data-pick="late">${CLOCK}<span>${t("attendance.late", "Öğretmen geç geldi")}</span></button>
        <button type="button" class="${ui.choice}" data-pick="no_show" ${noShowReady ? "" : "disabled"}>${WARN}<span>${t("attendance.noShow", "Öğretmen derse gelmedi")}</span></button>
        <button type="button" class="${ui.choice}" data-pick="technical">${PLUG}<span>${t("attendance.technical", "Teknik bir sorun yaşandı")}</span></button>
      </div>
      ${noShowReady ? "" : `<p>${t("class.reportNoShowTooSoon", "Öğretmen hâlâ gelmediyse birkaç dakika sonra tekrar dene.")}</p>`}
      ${cancelBtn ? actions(cancelBtn) : ""}
    `;
    wireCommon();
    wire('[data-pick="yes"]', () => onHappened && onHappened());
    wire('[data-pick="late"]', late);
    if (noShowReady) wire('[data-pick="no_show"]', noShow);
    wire('[data-pick="technical"]', technical);
  }

  function late() {
    container.innerHTML = `
      <p>${t("attendance.lateHowMany", "Öğretmen kaç dakika geç geldi?")}</p>
      <input type="number" min="1" max="50" class="${ui.input}" data-minutes placeholder="${t("class.reportLateMinutesPlaceholder", "Örn. 10")}">
      ${actions(backBtn, `<button type="button" class="${ui.primary}" data-next>${t("class.continueBtn", "Devam Et")}</button>`)}
    `;
    wireCommon();
    const input = container.querySelector("[data-minutes]");
    wire("[data-next]", () => {
      const minutes = readNumber(input, 1, 50);
      if (!minutes) { input.focus(); return; }
      if (minutes <= ARMUS_LATE_WARNING_MINUTES) {
        submit({ type: "late", lateMinutes: minutes },
          t("attendance.lateWarnSent", "Bildirimin alındı. 15 dakikaya kadar gecikmeler öğretmene uyarı olarak iletilir."));
      } else {
        lateChoice(minutes);
      }
    });
  }

  function lateChoice(minutes) {
    container.innerHTML = `
      <p>${t("attendance.lateChoiceText", "Öğretmen {n} dakika geç geldi. 15 dakikadan uzun gecikmelerde ne olacağına sen karar verirsin:").replace("{n}", minutes)}</p>
      <div class="${ui.options}">
        <button type="button" class="${ui.choice}" data-choice="held"><span>${t("attendance.lateHeld", "Ders kalan sürede yapıldı")}</span></button>
        <button type="button" class="${ui.choice}" data-choice="not_held"><span>${t("attendance.lateNotHeld", "Ders yapılmamış sayılsın (ders hakkım iade edilsin)")}</span></button>
      </div>
      ${actions(backBtn)}
    `;
    wireCommon();
    wire('[data-choice="held"]', () => submit({ type: "late", lateMinutes: minutes },
      t("attendance.lateHeldSent", "Bildirimin alındı ve öğretmene uyarı olarak iletildi.")));
    wire('[data-choice="not_held"]', () => submit({
      type: "no_show",
      lateMinutes: minutes,
      note: t("attendance.lateNotHeldNote", "Öğretmen {n} dakika geç geldi; öğrenci dersin yapılmamış sayılmasını seçti.").replace("{n}", minutes),
    }, t("attendance.noShowSent", "Bildirimin alındı. Ekibimiz ders kayıtlarını inceleyecek; doğrulanırsa ders hakkın iade edilir.")));
  }

  function noShow() {
    container.innerHTML = `
      <p>${t("attendance.noShowConfirm", "Öğretmen derse hiç girmedi mi? Ekibimiz ders kayıtlarına (kimin derse ne zaman girdiğine) bakarak inceleyecek; doğrulanırsa ders hakkın iade edilir. Asılsız bildirimler uyarı alır, 3 asılsız bildirimde hesap kapatılır.")}</p>
      ${actions(backBtn, `<button type="button" class="${ui.primary}" data-send>${t("attendance.noShowSend", "Öğretmen Gelmedi")}</button>`)}
    `;
    wireCommon();
    wire("[data-send]", () => submit({ type: "no_show" },
      t("attendance.noShowSent", "Bildirimin alındı. Ekibimiz ders kayıtlarını inceleyecek; doğrulanırsa ders hakkın iade edilir.")));
  }

  function technical() {
    container.innerHTML = `
      <p>${t("attendance.techWhose", "Sorun kimin tarafındaydı?")}</p>
      <div class="${ui.options}">
        <button type="button" class="${ui.choice}" data-side="teacher"><span>${t("attendance.techTeacher", "Öğretmenin tarafında (bağlantısı koptu, sesi ya da görüntüsü gelmedi)")}</span></button>
        <button type="button" class="${ui.choice}" data-side="student"><span>${t("attendance.techStudent", "Benim tarafımda")}</span></button>
      </div>
      ${actions(backBtn)}
    `;
    wireCommon();
    container.querySelectorAll("[data-side]").forEach(btn => btn.addEventListener("click", () => techMinutes(btn.dataset.side)));
  }

  function techMinutes(side) {
    container.innerHTML = `
      <p>${t("attendance.techMinutes", "Ders kaç dakika yapılabildi?")}</p>
      <input type="number" min="0" max="50" class="${ui.input}" data-minutes placeholder="${t("attendance.techMinutesPlaceholder", "Örn. 20")}">
      <p>${side === "teacher"
        ? t("attendance.techTeacherRule", "Öğretmen tarafındaki bir sorun yüzünden ders 25 dakikadan az yapılabildiyse, inceleme sonunda ders hakkın iade edilir.")
        : t("attendance.techStudentRule", "Senin tarafındaki teknik sorunlarda ders iadesi yapılmaz, ama bildirimin kayda geçer.")}</p>
      ${actions(backBtn, `<button type="button" class="${ui.primary}" data-send>${t("class.reportSend", "Gönder")}</button>`)}
    `;
    wireCommon();
    const input = container.querySelector("[data-minutes]");
    wire("[data-send]", () => {
      const minutes = readNumber(input, 0, 50);
      if (minutes === null) { input.focus(); return; }
      const message = side === "student"
        ? t("attendance.techStudentSent", "Bildirimin kayda geçti. Senin tarafındaki teknik sorunlarda ders iadesi yapılmaz.")
        : (minutes < ARMUS_TECH_REFUND_MINUTES
          ? t("attendance.techRefundSent", "Bildirimin alındı. İnceleme sonunda doğrulanırsa ders hakkın iade edilir.")
          : t("attendance.techNoRefundSent", "Bildirimin alındı. Ders 25 dakika ya da daha uzun yapılabildiği için iade yapılmaz."));
      submit({ type: "technical", techSide: side, minutesHeld: minutes }, message);
    });
  }

  main();
}

