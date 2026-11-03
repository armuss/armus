// ARMUS - the emails behind migration_112.sql's lesson rules. Called by
// database triggers and the armus-daily-policies cron job (through
// public.notify_policy) - never by the site itself.
//
// body.type:
//   "false_report"     { report_id, count }  - a student's report was
//                      dismissed as made up: a warning (the 3rd closes the
//                      account - "student_banned" covers that email)
//   "ban_suggestion"   { teacher_id, count } - 3 upheld no-shows in 30
//                      days: support is asked to consider a ban
//   "technical_refund" { booking_id }        - a technical problem on the
//                      teacher's side was confirmed: the lesson went back
//                      to the student
//   "student_banned"   { student_id, booking_ids } - the account is closed,
//                      future lessons cancelled, credits forfeited; the
//                      teachers of those lessons hear about it too
//   "daily"            {}  - credit expiry reminders (2 weeks ahead) and
//                      daylight-saving notices (a lesson whose time moves
//                      in the student's or teacher's own clock)
//
// IMPORTANT: after deploying this function, go to its Settings and turn
// OFF "Verify JWT" - the database calls it without a user token, with the
// x-armus-trigger-secret header instead (same as send-push-notification).
//
// Secrets (already set for the other email functions): RESEND_API_KEY,
// TRIGGER_SECRET; optional EMAIL_FROM, SITE_URL.

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const SUPPORT_EMAIL = "armus.support@gmail.com";

const FALSE_REPORT_LIMIT = 3;
const EXPIRY_REMINDER_DAYS = 14;

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// a teacher's full name is never shown to a student
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function wallClock(instant: Date, timeZone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Istanbul",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
}

// minutes ahead of UTC that `timeZone`'s clocks are at `instant`
function utcOffsetMinutes(timeZone: string, instant: Date) {
  const parts = wallClock(instant, timeZone);
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hour, Number(parts.minute), Number(parts.second));
  return Math.round((asIfUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

// lesson_date/lesson_time are wall-clock time in the teacher's zone
function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const guess = new Date(`${dateKey}T${time}:00Z`);
  return new Date(guess.getTime() - utcOffsetMinutes(timeZone, guess) * 60000);
}

function dateTimeLabel(instant: Date, timeZone: string) {
  const parts = wallClock(instant, timeZone);
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${Number(parts.day)} ${MONTH_NAMES[Number(parts.month) - 1]} ${DAY_NAMES[EN_WEEKDAY_ORDER.indexOf(parts.weekday)] ?? ""}, ${hour}:${parts.minute}`;
}

function timeLabel(instant: Date, timeZone: string) {
  const parts = wallClock(instant, timeZone);
  return `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

function dateLabel(iso: string) {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function emailHtml(recipientName: string, bodyHtml: string, ctaPath = "my-lessons.html", ctaLabel = "Derslerimi Gör") {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">${bodyHtml}</p>
      <a href="${SITE_URL}/${ctaPath}" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">${escapeHtml(ctaLabel)}</a>
    </div>
  </div>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!to) return false;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!resp.ok) {
      console.error("resend send failed", to, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("resend send threw", to, err);
    return false;
  }
}

async function loadProfile(supabaseAdmin: any, id: string) {
  if (!isUuid(id)) return null;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("id, name, email, timezone")
    .eq("id", id)
    .maybeSingle();
  return data;
}

// ---- credit expiry reminders ------------------------------------------

async function sendExpiryReminders(supabaseAdmin: any) {
  const soon = new Date(Date.now() + EXPIRY_REMINDER_DAYS * 86_400_000).toISOString();
  const { data: credits } = await supabaseAdmin
    .from("lesson_credits")
    .select("id, student_id, teacher_name, expires_at")
    .eq("status", "available")
    .is("expiry_reminder_sent_at", null)
    .lte("expires_at", soon)
    .gt("expires_at", new Date().toISOString());

  const byStudent = new Map<string, any[]>();
  for (const c of credits || []) {
    byStudent.set(c.student_id, [...(byStudent.get(c.student_id) || []), c]);
  }

  let sent = 0;
  for (const [studentId, list] of byStudent) {
    const student = await loadProfile(supabaseAdmin, studentId);
    if (!student?.email) continue;
    const lines = list
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at))
      .map((c) => `${escapeHtml(shortDisplayName(c.teacher_name))} · son gün <strong style="color:#e8c777;">${dateLabel(c.expires_at)}</strong>`)
      .join("<br>");
    const ok = await sendEmail(
      student.email,
      "Ders hakların yakında sona eriyor - ARMUS",
      emailHtml(
        student.name,
        `Kullanmadığın ${list.length} ders hakkının süresi 2 hafta içinde doluyor:<br>${lines}<br><br>Ders hakları alındıktan 6 ay sonra geçersiz olur. Süresi dolmadan bir ders rezerve etmen yeterli - rezerve edilen ders bekler.`,
        "teachers.html",
        "Ders Rezerve Et",
      ),
    );
    if (!ok) continue;
    await supabaseAdmin
      .from("lesson_credits")
      .update({ expiry_reminder_sent_at: new Date().toISOString() })
      .in("id", list.map((c) => c.id));
    sent++;
  }
  return sent;
}

// ---- daylight-saving notices -----------------------------------------
// Lessons 1-8 days ahead whose student and teacher are in zones that
// will be a different number of hours apart at the lesson than today:
// the lesson's time in one side's own clock is not the usual one.

async function sendDstNotices(supabaseAdmin: any) {
  const now = new Date();
  const from = new Date(now.getTime() + 1 * 86_400_000);
  const to = new Date(now.getTime() + 8 * 86_400_000);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = new Date(to.getTime() + 86_400_000).toISOString().slice(0, 10);

  const { data: bookings } = await supabaseAdmin
    .from("bookings")
    .select("id, student_id, teacher_id, teacher_name, student_name, lesson_date, lesson_time, teacher_timezone")
    .eq("status", "confirmed")
    .eq("dst_notice_sent", false)
    .gte("lesson_date", dateFrom)
    .lte("lesson_date", dateTo);

  const profiles = new Map<string, any>();
  const getProfile = async (id: string) => {
    if (!profiles.has(id)) profiles.set(id, await loadProfile(supabaseAdmin, id));
    return profiles.get(id);
  };

  let notified = 0;
  for (const b of bookings || []) {
    const lesson = zonedTimeToUtc(b.lesson_date, b.lesson_time, b.teacher_timezone);
    if (lesson < from || lesson > to) continue;

    const student = await getProfile(b.student_id);
    const teacher = await getProfile(b.teacher_id);
    const studentTz = student?.timezone || "Europe/Istanbul";
    const teacherTz = b.teacher_timezone || "Europe/Istanbul";
    if (studentTz === teacherTz) continue;

    const gapNow = utcOffsetMinutes(studentTz, now) - utcOffsetMinutes(teacherTz, now);
    const gapAtLesson = utcOffsetMinutes(studentTz, lesson) - utcOffsetMinutes(teacherTz, lesson);
    if (gapNow === gapAtLesson) continue;

    const shift = Math.abs(gapAtLesson - gapNow) / 60;
    const note = `Bu hafta saat uygulamasındaki (yaz/kış saati) bir değişiklik nedeniyle öğretmeninle aranızdaki saat farkı ${shift} saat değişiyor.`;

    let ok = true;
    if (student?.email) {
      ok = await sendEmail(
        student.email,
        "Saat değişikliği: dersinin saatine dikkat - ARMUS",
        emailHtml(student.name,
          `${note}<br><strong style="color:#f4f4f2;">${escapeHtml(shortDisplayName(b.teacher_name))}</strong> ile dersin senin saatinle <strong style="color:#e8c777;">${dateTimeLabel(lesson, studentTz)}</strong> başlıyor. Takviminde başka bir saat yazıyorsa bu saati esas al.`),
      ) && ok;
    }
    if (teacher?.email) {
      ok = await sendEmail(
        teacher.email,
        "Saat değişikliği: dersinin saatine dikkat - ARMUS",
        emailHtml(teacher.name,
          `${note.replace("öğretmeninle", "öğrencinle")}<br><strong style="color:#f4f4f2;">${escapeHtml(b.student_name)}</strong> ile dersin senin saatinle <strong style="color:#e8c777;">${dateTimeLabel(lesson, teacherTz)}</strong> başlıyor - öğrencinin saatiyle ${timeLabel(lesson, studentTz)}.`,
          "dashboard.html", "Paneline Git"),
      ) && ok;
    }
    if (!ok) continue;
    await supabaseAdmin.from("bookings").update({ dst_notice_sent: true }).eq("id", b.id);
    notified++;
  }
  return notified;
}

Deno.serve(async (req) => {
  try {
    if (!TRIGGER_SECRET || req.headers.get("x-armus-trigger-secret") !== TRIGGER_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (body.type === "false_report") {
      const count = Number(body.count) || 1;
      // the 3rd closes the account - "student_banned" sends that email
      if (count >= FALSE_REPORT_LIMIT) return new Response("ban email covers it", { status: 200 });

      const { data: report } = await supabaseAdmin
        .from("attendance_reports").select("student_id, booking_id").eq("id", body.report_id).maybeSingle();
      if (!report) return new Response("skip", { status: 200 });
      const student = await loadProfile(supabaseAdmin, report.student_id);
      if (!student?.email) return new Response("skip", { status: 200 });

      await sendEmail(
        student.email,
        "Bildirimin hakkında uyarı - ARMUS",
        emailHtml(student.name,
          `Yaptığın bir ders bildirimini inceledik ve doğru olmadığına karar verdik (ders kayıtları bildirimle uyuşmuyor). Bu bir uyarıdır: ${FALSE_REPORT_LIMIT} asılsız bildirimde hesabın kapatılır. Şu ana kadar: <strong style="color:#e8c777;">${count} / ${FALSE_REPORT_LIMIT}</strong>.<br>Bir yanlışlık olduğunu düşünüyorsan destek ekibimize yazabilirsin.`,
          "iletisim.html", "Destek Ekibine Yaz"),
      );
      return new Response("sent", { status: 200 });
    }

    if (body.type === "ban_suggestion") {
      const teacher = await loadProfile(supabaseAdmin, body.teacher_id);
      await sendEmail(
        SUPPORT_EMAIL,
        `Ban önerisi: ${teacher?.name || body.teacher_id} - ARMUS`,
        emailHtml("ARMUS ekibi",
          `<strong style="color:#f4f4f2;">${escapeHtml(teacher?.name || String(body.teacher_id))}</strong> (${escapeHtml(teacher?.email || "")}) son 30 günde ${Number(body.count) || 3} kez derse gelmedi (doğrulanmış bildirim). Profil 14 gün herkesten gizlendi. Hesabın kapatılıp kapatılmayacağına yönetim panelinden karar verebilirsin.`,
          "admin.html", "Yönetim Paneli"),
      );
      return new Response("sent", { status: 200 });
    }

    if (body.type === "technical_refund") {
      const { data: booking } = await supabaseAdmin
        .from("bookings").select("*").eq("id", body.booking_id).maybeSingle();
      if (!booking) return new Response("skip", { status: 200 });
      const lesson = zonedTimeToUtc(booking.lesson_date, booking.lesson_time, booking.teacher_timezone);
      const student = await loadProfile(supabaseAdmin, booking.student_id);
      const teacher = await loadProfile(supabaseAdmin, booking.teacher_id);
      if (student?.email) {
        await sendEmail(
          student.email,
          "Teknik sorun: dersin iade edildi - ARMUS",
          emailHtml(student.name,
            `${escapeHtml(shortDisplayName(booking.teacher_name))} ile ${dateTimeLabel(lesson, student.timezone)} dersinde öğretmen tarafında yaşanan teknik sorunu inceledik. Ders yeterince yapılamadığı için ${booking.refunded ? "ders hakkın bakiyene geri eklendi - dilediğin zaman kullanabilirsin" : "ders iptal edildi"}.`),
        );
      }
      if (teacher?.email) {
        await sendEmail(
          teacher.email,
          "Teknik sorun bildirimi sonuçlandı - ARMUS",
          emailHtml(teacher.name,
            `${escapeHtml(booking.student_name)} ile ${dateTimeLabel(lesson, teacher.timezone)} dersinde senin tarafında teknik bir sorun yaşandığı ve dersin 25 dakikadan az yapılabildiği doğrulandı. Ders öğrenciye iade edildi ve bu ders için ödeme yapılmaz. Bu bir ceza değildir, profilin etkilenmez.`,
            "dashboard.html", "Paneline Git"),
        );
      }
      return new Response("sent", { status: 200 });
    }

    if (body.type === "student_banned") {
      const student = await loadProfile(supabaseAdmin, body.student_id);
      if (student?.email) {
        await sendEmail(
          student.email,
          "Hesabın kapatıldı - ARMUS",
          emailHtml(student.name,
            `ARMUS kullanım şartlarına aykırılık nedeniyle hesabın kapatıldı. Kullanım şartlarında belirtildiği gibi planlanmış derslerin iptal edildi ve kalan ders hakların geçersiz hale geldi. Bir yanlışlık olduğunu düşünüyorsan destek ekibimize yazabilirsin.`,
            "iletisim.html", "Destek Ekibine Yaz"),
        );
      }
      const ids = Array.isArray(body.booking_ids) ? body.booking_ids.filter(isUuid).slice(0, 500) : [];
      if (ids.length) {
        const { data: bookings } = await supabaseAdmin
          .from("bookings").select("*").in("id", ids);
        for (const b of bookings || []) {
          const teacher = await loadProfile(supabaseAdmin, b.teacher_id);
          if (!teacher?.email) continue;
          const lesson = zonedTimeToUtc(b.lesson_date, b.lesson_time, b.teacher_timezone);
          await sendEmail(
            teacher.email,
            "Bir dersin iptal edildi - ARMUS",
            emailHtml(teacher.name,
              `${escapeHtml(b.student_name)} ile ${dateTimeLabel(lesson, teacher.timezone)} dersin iptal edildi: öğrencinin hesabı kapatıldı. Bu saat yeniden rezervasyona açıldı.`,
              "dashboard.html", "Paneline Git"),
          );
        }
      }
      return new Response("sent", { status: 200 });
    }

    if (body.type === "daily") {
      const reminders = await sendExpiryReminders(supabaseAdmin);
      const dst = await sendDstNotices(supabaseAdmin);
      return new Response(JSON.stringify({ reminders, dst }), { status: 200 });
    }

    return new Response("unknown type", { status: 200 });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
