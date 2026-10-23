// ARMUS - moves a booked lesson to another time (Preply-style
// rescheduling, migration_107.sql). Called by the student (my-lessons.html)
// and the teacher (dashboard.html). Nothing about money changes: the same
// booking row moves, with the same payment / lesson credit behind it.
//
// Actions (body.action):
//   "request"  { booking_id, new_date, new_time }
//     - student, >= 12 hours before the lesson: moved straight away, to an
//       open slot in the teacher's availability
//     - student, < 12 hours before: a request the teacher accepts/declines
//     - teacher, any time before the lesson: a proposal the student
//       accepts/declines (any free time - it's the teacher's own time)
//   "respond"  { request_id, accept }  - the OTHER party answers
//   "withdraw" { request_id }          - the requester takes it back
// A request nobody answers before the lesson starts just lapses - the
// lesson stays where it was (apply_booking_reschedule refuses a lesson
// that already started).
//
// The move itself is apply_booking_reschedule (service role only): it
// re-checks the lesson is still movable and lets the no-overlap trigger
// refuse a slot that got taken meanwhile (AR001/23505).
//
// Emails the other side of every step (RESEND_API_KEY, EMAIL_FROM,
// SITE_URL - same as cancel-booking).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function,
// name it "reschedule-booking", paste this file, Deploy. Leave "Verify
// JWT" ON - the site calls it with the signed-in user's token.

import { createClient } from "npm:@supabase/supabase-js@2";

// same window as cancel-booking's FREE_CANCEL_HOURS (bookings.js mirrors
// both as ARMUS_FREE_CANCEL_HOURS)
const FREE_RESCHEDULE_HOURS = 12;
// how far ahead a lesson can be moved
const MAX_DAYS_AHEAD = 60;
const LESSON_MINUTES = 50;

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DEMO_TEACHER_IDS = ["sarah", "david", "emily", "michael", "anna", "james"];

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isDateKey(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// booking.html only ever offers half-hour slots (bookings.js armusAllTimeSlots)
function isHalfHourSlot(value: unknown) {
  return typeof value === "string" && /^([01][0-9]|2[0-3]):(00|30)$/.test(value);
}

// mirrors cancel-booking's armusZonedTimeToUtc
function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Istanbul",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return new Date(guess.getTime() + (guess.getTime() - asIfUtc));
}

function formatDateTimeLabel(lessonInstant: Date, recipientTimezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: recipientTimezone || "Europe/Istanbul",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short",
    }).formatToParts(lessonInstant).map((p) => [p.type, p.value]),
  );
  const dayIndex = EN_WEEKDAY_ORDER.indexOf(parts.weekday);
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${Number(parts.day)} ${MONTH_NAMES[Number(parts.month) - 1]} ${DAY_NAMES[dayIndex] ?? ""}, ${hour}:${parts.minute}`;
}

// mirrors create-payment's isSlotInTeacherAvailability (bookings.js
// armusSlotsForDate): the per-day grid wins once the teacher saved it
// (_set), else the older weekly_availability array
function isSlotInTeacherAvailability(weeklyAvailability: unknown, availabilityDates: unknown, dayOfWeek: number, time: string) {
  if (
    availabilityDates && typeof availabilityDates === "object" &&
    (availabilityDates as Record<string, unknown>)._set === true
  ) {
    const daySlots = (availabilityDates as Record<string, unknown>)[String(dayOfWeek)];
    return Array.isArray(daySlots) && daySlots.includes(time);
  }
  if (Array.isArray(weeklyAvailability)) {
    const daySlots = weeklyAvailability[dayOfWeek];
    return Array.isArray(daySlots) && daySlots.includes(time);
  }
  return false;
}

// mirrors bookings.js armusHashCode - demo teachers' mock availability
function armusHashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function escapeHtml(str: string) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// a teacher's full name is never shown to a student (armusShortDisplayName)
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function emailHtml(recipientName: string, bodyHtml: string, ctaPath: string, ctaLabel: string) {
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
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });
    if (!resp.ok) console.error("resend send failed", to, await resp.text());
  } catch (err) {
    console.error("resend send threw", to, err);
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const MSG_SLOT_TAKEN = "Bu saat az önce doldu ya da öğretmenin başka bir dersiyle çakışıyor. Lütfen başka bir saat seç.";
const MSG_NOT_MOVABLE = "Bu dersin saati artık değiştirilemez (ders başladı ya da iptal edildi).";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Giriş yapmalısın." }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "Giriş yapmalısın." }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    async function loadBooking(id: string) {
      const { data } = await supabaseAdmin.from("bookings").select("*").eq("id", id).maybeSingle();
      return data;
    }

    async function loadProfile(id: string) {
      if (!isUuid(id)) return null;
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("email, name, timezone, weekly_availability, availability_dates")
        .eq("id", id)
        .maybeSingle();
      return data;
    }

    function lessonLabel(date: string, time: string, booking: any, recipient: any) {
      return formatDateTimeLabel(zonedTimeToUtc(date, time, booking.teacher_timezone), recipient?.timezone);
    }

    // the other participant, from the point of view of `role`
    async function counterpart(booking: any, role: "student" | "teacher") {
      if (role === "student") {
        return { profile: await loadProfile(booking.teacher_id), ctaPath: "dashboard.html", ctaLabel: "Paneline Git" };
      }
      return { profile: await loadProfile(booking.student_id), ctaPath: "my-lessons.html", ctaLabel: "Derslerimi Gör" };
    }

    function mapApplyError(error: any) {
      if (error?.code === "AR001" || error?.code === "23505") return jsonResponse({ error: MSG_SLOT_TAKEN }, 409);
      if (error?.code === "AR004") return jsonResponse({ error: MSG_NOT_MOVABLE }, 400);
      console.error("apply_booking_reschedule failed", error);
      return jsonResponse({ error: "Dersin saati değiştirilemedi." }, 500);
    }

    // ------------------------------------------------------------------
    if (action === "request") {
      const { booking_id: bookingId, new_date: newDate, new_time: newTime } = body;
      if (!bookingId || !isDateKey(newDate) || !isHalfHourSlot(newTime)) {
        return jsonResponse({ error: "Geçersiz tarih ya da saat." }, 400);
      }

      const booking = await loadBooking(bookingId);
      if (!booking) return jsonResponse({ error: "Rezervasyon bulunamadı." }, 404);

      const isStudent = user.id === booking.student_id;
      const isTeacher = String(user.id) === booking.teacher_id;
      if (!isStudent && !isTeacher) return jsonResponse({ error: "Bu dersin saatini değiştirme yetkin yok." }, 403);
      const role: "student" | "teacher" = isStudent ? "student" : "teacher";

      const lessonStart = zonedTimeToUtc(booking.lesson_date, booking.lesson_time, booking.teacher_timezone);
      if (booking.status !== "confirmed" || lessonStart.getTime() <= Date.now()) {
        return jsonResponse({ error: MSG_NOT_MOVABLE }, 400);
      }

      const newStart = zonedTimeToUtc(newDate, newTime, booking.teacher_timezone);
      if (Number.isNaN(newStart.getTime()) || newStart.getTime() <= Date.now()) {
        return jsonResponse({ error: "Geçmiş bir saat seçilemez." }, 400);
      }
      if (newStart.getTime() > Date.now() + MAX_DAYS_AHEAD * 86_400_000) {
        return jsonResponse({ error: `Ders en fazla ${MAX_DAYS_AHEAD} gün sonrasına taşınabilir.` }, 400);
      }
      if (newDate === booking.lesson_date && newTime === booking.lesson_time) {
        return jsonResponse({ error: "Ders zaten bu saatte." }, 400);
      }

      // a student can only pick from the teacher's own open hours; a
      // teacher proposing is offering their own time, any free slot
      if (isStudent) {
        const dayOfWeek = new Date(`${newDate}T00:00:00Z`).getUTCDay();
        let open: boolean;
        if (DEMO_TEACHER_IDS.includes(booking.teacher_id)) {
          open = armusHashCode(booking.teacher_id + newDate + newTime) % 3 !== 0;
        } else {
          const teacherProfile = await loadProfile(booking.teacher_id);
          open = !!teacherProfile && isSlotInTeacherAvailability(
            teacherProfile.weekly_availability, teacherProfile.availability_dates, dayOfWeek, newTime,
          );
        }
        if (!open) return jsonResponse({ error: "Öğretmen bu saatte müsait değil. Lütfen başka bir saat seç." }, 400);
      }

      // early overlap check so a request never goes out for a time that's
      // already taken (apply_booking_reschedule re-checks on accept)
      const { data: nearby } = await supabaseAdmin
        .from("bookings")
        .select("id, lesson_date, lesson_time, teacher_timezone")
        .eq("teacher_id", booking.teacher_id)
        .neq("status", "cancelled")
        .gte("lesson_date", new Date(newStart.getTime() - 2 * 86_400_000).toISOString().slice(0, 10))
        .lte("lesson_date", new Date(newStart.getTime() + 2 * 86_400_000).toISOString().slice(0, 10));
      const lessonMs = LESSON_MINUTES * 60_000;
      const overlaps = (nearby || []).some((b: any) => {
        if (b.id === booking.id) return false;
        const start = zonedTimeToUtc(b.lesson_date, b.lesson_time, b.teacher_timezone).getTime();
        return start < newStart.getTime() + lessonMs && start + lessonMs > newStart.getTime();
      });
      if (overlaps) return jsonResponse({ error: MSG_SLOT_TAKEN }, 409);

      const hoursUntil = (lessonStart.getTime() - Date.now()) / 3_600_000;
      const other = await counterpart(booking, role);

      // student, in time: moved right now
      if (isStudent && hoursUntil >= FREE_RESCHEDULE_HOURS) {
        const { error } = await supabaseAdmin.rpc("apply_booking_reschedule", {
          p_booking_id: booking.id, p_new_date: newDate, p_new_time: newTime,
          p_request_id: null, p_requested_by: "student", p_requester_id: user.id,
        });
        if (error) return mapApplyError(error);

        if (other.profile?.email) {
          await sendEmail(
            other.profile.email,
            "Bir dersin yeni saate taşındı - ARMUS",
            emailHtml(other.profile.name,
              `<strong style="color:#f4f4f2;">${escapeHtml(booking.student_name)}</strong> dersini yeni bir saate taşıdı:<br>` +
              `<span style="text-decoration:line-through;">${lessonLabel(booking.lesson_date, booking.lesson_time, booking, other.profile)}</span> → ` +
              `<strong style="color:#e8c777;">${lessonLabel(newDate, newTime, booking, other.profile)}</strong>`,
              other.ctaPath, other.ctaLabel),
          );
        }
        return jsonResponse({ ok: true, applied: true });
      }

      // otherwise a request for the other side. One open request per
      // lesson: the requester's own earlier one is replaced, the other
      // side's has to be answered first.
      const { data: pending } = await supabaseAdmin
        .from("reschedule_requests")
        .select("id, requested_by")
        .eq("booking_id", booking.id)
        .eq("status", "pending")
        .maybeSingle();
      if (pending && pending.requested_by !== role) {
        return jsonResponse({ error: "Bu ders için karşı tarafın bekleyen bir saat değişikliği isteği var. Önce ona yanıt ver." }, 409);
      }
      if (pending) {
        await supabaseAdmin.from("reschedule_requests")
          .update({ status: "withdrawn", resolved_at: new Date().toISOString() })
          .eq("id", pending.id).eq("status", "pending");
      }

      const { data: created, error: insertError } = await supabaseAdmin
        .from("reschedule_requests")
        .insert({
          booking_id: booking.id, requested_by: role, requester_id: user.id,
          old_date: booking.lesson_date, old_time: booking.lesson_time,
          new_date: newDate, new_time: newTime,
        })
        .select("id")
        .single();
      if (insertError || !created) {
        if (insertError?.code === "23505") {
          return jsonResponse({ error: "Bu ders için zaten bekleyen bir saat değişikliği isteği var." }, 409);
        }
        console.error("reschedule request insert failed", insertError);
        return jsonResponse({ error: "İstek gönderilemedi." }, 500);
      }

      if (other.profile?.email) {
        const who = isStudent
          ? `<strong style="color:#f4f4f2;">${escapeHtml(booking.student_name)}</strong>`
          : `<strong style="color:#f4f4f2;">${escapeHtml(shortDisplayName(booking.teacher_name))}</strong>`;
        const verb = isStudent ? "dersin için yeni bir saat istiyor" : "dersin için yeni bir saat öneriyor";
        await sendEmail(
          other.profile.email,
          "Ders saati değişikliği isteği - ARMUS",
          emailHtml(other.profile.name,
            `${who}, ${lessonLabel(booking.lesson_date, booking.lesson_time, booking, other.profile)} ${verb}: ` +
            `<strong style="color:#e8c777;">${lessonLabel(newDate, newTime, booking, other.profile)}</strong>.<br>` +
            `Kabul etmek ya da reddetmek için ${isStudent ? "panelini" : "Derslerim sayfanı"} aç. Ders başlayana kadar yanıt verilmezse ders eski saatinde kalır.`,
            other.ctaPath, other.ctaLabel),
        );
      }
      return jsonResponse({ ok: true, applied: false, requestId: created.id });
    }

    // ------------------------------------------------------------------
    if (action === "respond" || action === "withdraw") {
      const requestId = body.request_id;
      if (!requestId) return jsonResponse({ error: "request_id gerekli." }, 400);

      const { data: request } = await supabaseAdmin
        .from("reschedule_requests").select("*").eq("id", requestId).maybeSingle();
      if (!request || request.status !== "pending") {
        return jsonResponse({ error: "Bu istek artık geçerli değil." }, 400);
      }
      const booking = await loadBooking(request.booking_id);
      if (!booking) return jsonResponse({ error: "Rezervasyon bulunamadı." }, 404);

      const isStudent = user.id === booking.student_id;
      const isTeacher = String(user.id) === booking.teacher_id;
      const role: "student" | "teacher" | null = isStudent ? "student" : isTeacher ? "teacher" : null;
      if (!role) return jsonResponse({ error: "Bu istek üzerinde yetkin yok." }, 403);

      if (action === "withdraw") {
        if (role !== request.requested_by) return jsonResponse({ error: "Sadece isteği gönderen geri çekebilir." }, 403);
        await supabaseAdmin.from("reschedule_requests")
          .update({ status: "withdrawn", resolved_at: new Date().toISOString() })
          .eq("id", request.id).eq("status", "pending");
        return jsonResponse({ ok: true });
      }

      // respond: only the side that did NOT ask
      if (role === request.requested_by) return jsonResponse({ error: "Kendi isteğine yanıt veremezsin." }, 403);

      const requesterSide = await counterpart(booking, role);
      const responderName = role === "teacher" ? shortDisplayName(booking.teacher_name) : booking.student_name;

      if (body.accept === true) {
        const { error } = await supabaseAdmin.rpc("apply_booking_reschedule", {
          p_booking_id: booking.id, p_new_date: request.new_date, p_new_time: request.new_time,
          p_request_id: request.id, p_requested_by: null, p_requester_id: null,
        });
        if (error) return mapApplyError(error);

        if (requesterSide.profile?.email) {
          await sendEmail(
            requesterSide.profile.email,
            "Ders saati değişti - ARMUS",
            emailHtml(requesterSide.profile.name,
              `<strong style="color:#f4f4f2;">${escapeHtml(responderName)}</strong> saat değişikliğini kabul etti. Dersin artık ` +
              `<strong style="color:#e8c777;">${lessonLabel(request.new_date, request.new_time, booking, requesterSide.profile)}</strong>.`,
              requesterSide.ctaPath, requesterSide.ctaLabel),
          );
        }
        return jsonResponse({ ok: true, accepted: true });
      }

      await supabaseAdmin.from("reschedule_requests")
        .update({ status: "declined", resolved_at: new Date().toISOString() })
        .eq("id", request.id).eq("status", "pending");

      if (requesterSide.profile?.email) {
        await sendEmail(
          requesterSide.profile.email,
          "Saat değişikliği kabul edilmedi - ARMUS",
          emailHtml(requesterSide.profile.name,
            `<strong style="color:#f4f4f2;">${escapeHtml(responderName)}</strong> saat değişikliğini kabul etmedi. Ders eski saatinde kalıyor: ` +
            `<strong style="color:#e8c777;">${lessonLabel(booking.lesson_date, booking.lesson_time, booking, requesterSide.profile)}</strong>.`,
            requesterSide.ctaPath, requesterSide.ctaLabel),
        );
      }
      return jsonResponse({ ok: true, accepted: false });
    }

    return jsonResponse({ error: "Geçersiz işlem." }, 400);

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
