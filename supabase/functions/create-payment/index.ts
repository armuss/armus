// ARMUS - starts an iyzico Checkout Form payment for a booking OR a
// lesson package, first checking (bookings only) whether an available
// lesson credit (see migration_28.sql, granted by cancel-booking) covers
// it for free.
//
// Called from booking.html (armusSupabase.functions.invoke("create-payment", ...))
// right when the student clicks "Onayla", or from the app's package-offer
// screen after a trial lesson. Two outcomes for a booking:
//   - an available credit covers this booking (same teacher as the
//     credit, or any teacher if this is a trial lesson): the booking is
//     created directly, right here, with no iyzico step at all and no
//     charge - response is { bookedDirectly: true, creditApplied: true }
//   - no matching credit: unchanged, full price charged to the card
// Either way nothing is written to the real "bookings" table for a card
// payment - a pending_payments row is created instead, and the booking
// itself is only created by payment-callback once iyzico confirms the
// charge actually succeeded. This is what stops a student from getting a
// lesson slot without paying (or a slot being held forever for a payment
// that never completes). A credit-covered booking deliberately gets no
// pending_payments row at all - that's what stops a student from farming
// free lessons by cancelling a credit-covered booking to get another
// credit (cancel-booking only grants one when there's a real payment on
// file for the booking being cancelled).
//
// type: "package" (migration_29.sql) always goes to card - it's what a
// student buys after a trial to lock in weekly lessons with that same
// teacher. It's a single charge, not a real recurring subscription (no
// iyzico subscription API involved); payment-callback grants `quantity`
// lesson_credits for that teacher once the charge succeeds, consumed by
// this same function's credit-check above on each future booking.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Create a new function,
// name it "create-payment", paste this file in, Deploy.
//
// Needs these secrets set (Edge Functions -> Manage secrets):
//   IYZICO_API_KEY, IYZICO_SECRET_KEY
// Optional:
//   IYZICO_BASE_URL (defaults to the iyzico sandbox - switch to
//     https://api.iyzipay.com once you have a real production merchant
//     account and want to take real payments)
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// already injected automatically into every Edge Function - no need to
// set those yourself.
//
// Also uses SITE_URL, RESEND_API_KEY, EMAIL_FROM (same as payment-callback)
// to send a booking-confirmed email to both participants when a lesson
// credit covers a booking outright (no iyzico step, so payment-callback
// never runs for this path - this is the only place that booking's
// confirmation email can be sent from).

import Iyzipay from "npm:iyzipay@^2.0.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const iyzipay = new Iyzipay({
  apiKey: Deno.env.get("IYZICO_API_KEY") ?? "",
  secretKey: Deno.env.get("IYZICO_SECRET_KEY") ?? "",
  uri: Deno.env.get("IYZICO_BASE_URL") ?? "https://sandbox-api.iyzipay.com",
});

const SITE_URL = (Deno.env.get("SITE_URL") ?? "https://armus.com.tr").replace(/\/$/, "");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("EMAIL_FROM") ?? "ARMUS <onboarding@resend.dev>";

const DAY_NAMES = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const MONTH_NAMES = [
  "Oca", "Şub", "Mar", "Nis", "May", "Haz",
  "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara",
];
const EN_WEEKDAY_ORDER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// A teacher's full real name is never shown to a student anywhere -
// only "Ahmet Y." (see auth.js armusShortDisplayName) - so a student
// can't take that name off ARMUS and look the teacher up elsewhere,
// bypassing the platform. Same policy here for the emails this function
// sends the student; never applied to a student's own name shown to
// their teacher.
function shortDisplayName(fullName: string) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "Öğretmen";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function bookingConfirmedEmailHtml(recipientName: string, otherName: string, whenLabel: string, typeLabel: string, joinUrl: string) {
  return `
  <div style="background:#0d0d0f;padding:40px 20px;font-family:Arial,sans-serif;">
    <div style="max-width:440px;margin:0 auto;background:#1a1712;border:1px solid #2e2a22;border-radius:16px;padding:32px;text-align:center;">
      <div style="font-size:22px;font-weight:800;letter-spacing:-1px;background:linear-gradient(90deg,#e8c777,#b8860b);-webkit-background-clip:text;background-clip:text;color:transparent;margin-bottom:24px;">ARMUS</div>
      <p style="color:#f4f4f2;font-size:14px;margin:0 0 6px;">Merhaba ${escapeHtml(recipientName)},</p>
      <p style="color:#a3a3a6;font-size:13px;line-height:1.6;margin:0 0 22px;">
        <strong style="color:#f4f4f2;">${escapeHtml(otherName)}</strong> ile ${escapeHtml(typeLabel)}in onaylandı:<br>
        <strong style="color:#e8c777;">${whenLabel}</strong>
      </p>
      <a href="${joinUrl}" style="display:inline-block;background:linear-gradient(90deg,#e8c777,#b8860b);color:#1c1c1e;font-size:14px;font-weight:700;padding:13px 26px;border-radius:12px;text-decoration:none;">Derslerimi Gör</a>
      <p style="color:#66666a;font-size:11px;margin:26px 0 0;">Ders saatine kadar hazır olman gerekmez, bağlantı ders başladığında açılacak.</p>
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

// mirrors bookings.js's armusNormalizeTurkishPhone - keep the two in sync.
// "+90 555 112 51 21", "905551125121", "0555 223 21 23" and bare
// "5551125121" are all the same number as far as the payer is concerned;
// canonicalize to the "+90XXXXXXXXXX" iyzico's gsmNumber field actually
// expects (a bare "05552232123" sent as-is made format-valid inputs die
// at checkoutFormInitialize). Landlines (area codes starting 2/3/4) are
// rejected on purpose - iyzico validates gsmNumber itself and would fail
// the whole payment later with a worse error.
function normalizeTurkishGsm(value: unknown): string | null {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (!/^5\d{9}$/.test(digits)) return null;
  return "+90" + digits;
}

// mirrors bookings.js's armusIsValidTurkishIdentityNumber - keep the two
// in sync. T.C. Kimlik No's official MOD-10 scheme (nvi.gov.tr): 11
// digits, the first never 0; the 10th digit is (7 * (sum of digits
// 1,3,5,7,9) - sum of digits 2,4,6,8) mod 10 and the 11th is (sum of the
// first 10) mod 10, which the algorithm also forces to be even. The old
// format-only check here accepted pure garbage like "11111111111" and
// sent it to iyzico as a real identity number. The ((x % 10) + 10) % 10
// dance matters: 7*odd - even goes negative when the even-position
// digits outweigh the odd ones (JS's % keeps the sign) and a raw -9
// would wrongly fail against a real digit 1.
function isValidTurkishIdentityNumber(value: unknown): boolean {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!/^[1-9][0-9]{10}$/.test(digits)) return false;
  const d = digits.split("").map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  if (d[9] !== (((oddSum * 7 - evenSum) % 10) + 10) % 10) return false;
  if (d[10] !== (oddSum + evenSum + d[9]) % 10) return false;
  return d[10] % 2 === 0;
}

// mirrors cancel-booking/index.ts's armusZonedTimeToUtc - date/time here
// are plain wall-clock strings with no zone of their own; this turns them
// into the real UTC instant so "is this slot in the past" is checked
// against the actual lesson time, not a UTC misreading of it.
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

// booking.html only ever offers slots on the half-hour (bookings.js's
// armusAllTimeSlots) - reject anything else outright rather than trying
// to look it up in a teacher's grid.
function isHalfHourSlot(timeStr: string) {
  return /^([01][0-9]|2[0-3]):(00|30)$/.test(timeStr);
}

// mirrors bookings.js's armusSlotsForDate: a teacher's per-date grid
// (availability_dates, keyed by day-of-week string) wins when set,
// otherwise their older weekly_availability array (indexed by
// day-of-week number). A teacher with neither set has never declared
// any working hours at all, so nothing is bookable for them.
function isSlotInTeacherAvailability(
  weeklyAvailability: unknown,
  availabilityDates: unknown,
  dayOfWeek: number,
  time: string,
): boolean {
  if (availabilityDates && typeof availabilityDates === "object" && Object.keys(availabilityDates as object).length) {
    const daySlots = (availabilityDates as Record<string, string[]>)[String(dayOfWeek)] || [];
    return Array.isArray(daySlots) && daySlots.includes(time);
  }
  if (Array.isArray(weeklyAvailability) && weeklyAvailability.length) {
    const daySlots = weeklyAvailability[dayOfWeek];
    return Array.isArray(daySlots) && daySlots.includes(time);
  }
  return false;
}

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

    const { data: profile } = await supabase
      .from("profiles")
      .select("name, email, city, timezone")
      .eq("id", user.id)
      .single();

    if (!profile) return jsonResponse({ error: "Profil bulunamadı." }, 400);

    const body = await req.json().catch(() => ({}));
    let { teacherId, teacherName } = body;
    const { type, date, time, phone, identityNumber, quantity } = body;

    if (type !== "trial" && type !== "lesson" && type !== "package") {
      return jsonResponse({ error: "Geçersiz ders tipi." }, 400);
    }
    if (!teacherId || !teacherName) {
      return jsonResponse({ error: "Eksik bilgi." }, 400);
    }
    if (type !== "package" && (!date || !time)) {
      return jsonResponse({ error: "Eksik rezervasyon bilgisi." }, 400);
    }
    if (type !== "package" && !isHalfHourSlot(String(time))) {
      return jsonResponse({ error: "Geçersiz ders saati." }, 400);
    }

    const numericQuantity = Number(quantity);
    // 200 is far above any real package the UI ever offers (mobile's own
    // package screen tops out at 5 lessons/week x 4 weeks = 20) - just a
    // ceiling against an arbitrary quantity being sent directly to this
    // function, which would otherwise multiply straight into `numericPrice`
    // below with nothing else bounding it.
    if (type === "package" && (!Number.isInteger(numericQuantity) || numericQuantity <= 0 || numericQuantity > 200)) {
      return jsonResponse({ error: "Geçersiz ders sayısı." }, 400);
    }

    // service-role: pending_payments has no client-facing RLS policies at
    // all (see migration_22.sql) - only this trusted server context ever
    // writes to it
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Nothing was stopping one logged-in account from scripting this
    // endpoint hundreds of times a minute - each call either writes a
    // pending_payments row and hits iyzico's own checkoutFormInitialize
    // API, or (credit-covered) writes a real booking. At volume that's
    // unbounded pending_payments growth and enough traffic to iyzico's
    // API to risk a newly-live merchant account being throttled or
    // flagged for abuse - an outage of the platform's ability to take
    // ANY payment, not just this one account's. 30/hour is far above any
    // real student's booking activity.
    const { count: recentAttempts } = await supabaseAdmin
      .from("pending_payments")
      .select("id", { count: "exact", head: true })
      .eq("student_id", user.id)
      .gte("created_at", new Date(Date.now() - 60 * 60_000).toISOString());

    if ((recentAttempts ?? 0) >= 30) {
      return jsonResponse({ error: "Çok fazla ödeme denemesi yaptın. Lütfen bir süre sonra tekrar dene." }, 429);
    }

    // The client used to just send `price` and this function trusted it
    // outright - anyone could tamper with the request and pay whatever
    // they wanted for any lesson. Price is now always resolved here,
    // server-side, from the teacher's real rate - the client-submitted
    // price (if any) is ignored entirely.
    //
    // Demo teachers (teachers-data.js) aren't real profiles rows, so
    // there's nothing in the database to look their price up from -
    // this mirrors that file's fixed prices. Keep the two in sync if a
    // demo teacher's price ever changes.
    const DEMO_TEACHER_PRICES: Record<string, number> = {
      sarah: 800,
      david: 650,
      emily: 500,
      michael: 900,
      anna: 550,
      james: 700,
    };

    let pricePerLesson: number;
    // migration_37.sql - which zone lesson_date/lesson_time (below) is
    // wall-clock time IN, so a credit-covered booking's date/time means
    // the same real instant everywhere else (cancel-booking, reminder
    // cron) reads it. Demo teachers have no profile row to read a real
    // timezone from, so they're always Europe/Istanbul.
    let teacherTimezone = "Europe/Istanbul";
    let teacherEmail: string | null = null;
    let teacherRealName: string | null = null;
    const isDemoTeacher = Object.prototype.hasOwnProperty.call(DEMO_TEACHER_PRICES, teacherId);

    if (isDemoTeacher) {
      pricePerLesson = DEMO_TEACHER_PRICES[teacherId];
    } else {
      const { data: teacherProfile } = await supabaseAdmin
        .from("profiles")
        .select("price, status, timezone, weekly_availability, availability_dates, email, name, is_banned, hidden_from_new_students, hidden_until")
        .eq("id", teacherId)
        .maybeSingle();

      if (!teacherProfile || teacherProfile.status !== "approved" || !(Number(teacherProfile.price) > 0)) {
        return jsonResponse({ error: "Öğretmen bulunamadı ya da şu anda ders vermiyor." }, 400);
      }

      // marketplace.js's armusFilterVisibleTeachers only hides a banned/
      // hidden teacher from the listing client-side - this function is
      // reachable directly (armusSupabase.functions.invoke) with any
      // teacherId at all, so without this the attendance-report ban/hide
      // system (migration_41.sql) does nothing to stop a student from
      // still booking and paying a teacher ARMUS has already flagged.
      // Matches armusIsTeacherHiddenFromEveryone/armusFilterVisibleTeachers:
      // banned or actively hidden_until blocks everyone; hidden_from_new_students
      // only blocks a student who has never booked this teacher before -
      // an existing student keeps their relationship with that teacher.
      const hiddenUntilStillActive = teacherProfile.hidden_until && new Date(teacherProfile.hidden_until) > new Date();
      if (teacherProfile.is_banned || hiddenUntilStillActive) {
        return jsonResponse({ error: "Öğretmen bulunamadı ya da şu anda ders vermiyor." }, 400);
      }
      if (teacherProfile.hidden_from_new_students) {
        const { count: priorBookingCount } = await supabaseAdmin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("student_id", user.id)
          .eq("teacher_id", teacherId);
        if (!priorBookingCount) {
          return jsonResponse({ error: "Öğretmen bulunamadı ya da şu anda ders vermiyor." }, 400);
        }
      }
      pricePerLesson = Number(teacherProfile.price);
      teacherTimezone = teacherProfile.timezone || "Europe/Istanbul";
      teacherEmail = teacherProfile.email || null;
      teacherRealName = teacherProfile.name || null;
      // never trust the client-supplied display name for a real teacher -
      // it's reachable directly (armusSupabase.functions.invoke) with any
      // string at all, and would otherwise end up stored on the booking/
      // pending_payments row, in the student's confirmation email, and on
      // the iyzico basket item, all showing a name that doesn't match the
      // real teacher tied to teacherId
      teacherName = teacherRealName || teacherName;

      // booking.html's picker (bookings.js's armusSlotsForDate) only ever
      // offers a time that's both on the teacher's declared grid and on
      // the half-hour - but that's client-side filtering only, and this
      // function is reachable directly (armusSupabase.functions.invoke)
      // with any date/time at all. Without this, anyone could book (and
      // pay for) a slot the teacher never opened, or one already in the
      // past - the former can then be weaponized through the
      // attendance-report system (migration_41.sql) to hide or ban a
      // teacher over a "no-show" for a lesson time they had no way of
      // knowing about; the latter lets a review be posted the instant
      // payment clears instead of after the lesson actually happens.
      if (type !== "package") {
        const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
        if (Number.isNaN(dayOfWeek)) {
          return jsonResponse({ error: "Geçersiz tarih." }, 400);
        }
        if (!isSlotInTeacherAvailability(teacherProfile.weekly_availability, teacherProfile.availability_dates, dayOfWeek, String(time))) {
          return jsonResponse({ error: "Öğretmen bu saatte müsait değil. Lütfen başka bir saat seç." }, 400);
        }
      }
    }

    if (type !== "package") {
      const lessonStart = zonedTimeToUtc(String(date), String(time), teacherTimezone);
      if (Number.isNaN(lessonStart.getTime()) || lessonStart < new Date()) {
        return jsonResponse({ error: "Geçersiz ya da geçmiş bir tarih/saat seçildi." }, 400);
      }
    }

    const numericPrice = type === "package" ? pricePerLesson * numericQuantity : pricePerLesson;
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      return jsonResponse({ error: "Geçersiz fiyat." }, 400);
    }

    const conversationId = crypto.randomUUID();
    const nameParts = (profile.name || "ARMUS Kullanıcısı").trim().split(/\s+/);
    const firstName = nameParts[0] || "ARMUS";
    const lastName = nameParts.slice(1).join(" ") || "Kullanıcı";

    // does an available lesson credit cover this booking? Same teacher as
    // the credit covers any lesson type; a credit from a different teacher
    // only covers a trial lesson (see migration_28.sql). Packages are
    // always a real charge - never covered by an existing credit, since
    // buying a package is what CREATES credits, not what consumes them.
    const { data: credits } = type !== "package"
      ? await supabaseAdmin
          .from("lesson_credits")
          .select("*")
          .eq("student_id", user.id)
          .eq("status", "available")
          .order("created_at", { ascending: true })
      : { data: null };

    let appliedCredit = (credits || []).find((c: any) => c.teacher_id === teacherId) || null;
    if (!appliedCredit && type === "trial" && credits && credits.length > 0) {
      appliedCredit = credits[0];
    }

    // a credit covers this booking - book it now, no card charge, no
    // iyzico step, and deliberately no pending_payments row at all (see
    // this file's header comment for why that matters)
    if (appliedCredit) {

      // Claim the credit with a conditional update (status must still be
      // "available") BEFORE creating the booking, instead of trusting the
      // "credits" SELECT above and updating unconditionally afterwards.
      // Two of the student's own requests racing (a double-submit, two
      // open tabs, a retried request) could otherwise both pass that
      // SELECT while the credit was still "available" in both, both
      // create a real booking, and only then both write
      // status: "used" - the second write succeeding too, silently,
      // since it was never conditioned on the row still being
      // available. That's a real free lesson: one credit funding two
      // bookings. This update returning no row means someone else (or
      // another request from this same one) already won the race, so
      // this request never gets to create a booking at all.
      const { data: claimedCredit } = await supabaseAdmin
        .from("lesson_credits")
        .update({ status: "used", used_at: new Date().toISOString() })
        .eq("id", appliedCredit.id)
        .eq("status", "available")
        .select()
        .maybeSingle();

      if (!claimedCredit) {
        return jsonResponse({ error: "Bu kredi az önce kullanıldı. Lütfen sayfayı yenileyip tekrar dene." }, 409);
      }

      const { data: booking, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .insert({
          student_id: user.id,
          student_name: profile.name,
          teacher_id: teacherId,
          teacher_name: teacherName,
          type,
          lesson_date: date,
          lesson_time: time,
          teacher_timezone: teacherTimezone,
          price: numericPrice,
        })
        .select()
        .single();

      if (bookingError || !booking) {

        // the credit is already claimed at this point but no booking got
        // created - release it back to available so it isn't wasted
        await supabaseAdmin
          .from("lesson_credits")
          .update({ status: "available", used_at: null })
          .eq("id", appliedCredit.id);

        // 23505 = unique_violation - someone else booked this exact
        // teacher/date/time first (bookings_teacher_slot_unique, see
        // migration_35.sql). Nothing was charged on this path (it's
        // credit-covered), so it's safe to just ask them to pick again.
        if (bookingError?.code === "23505") {
          return jsonResponse({ error: "Bu saat başka bir öğrenci tarafından alındı. Lütfen başka bir saat seç." }, 409);
        }
        console.error("credit-covered booking insert failed", bookingError);
        return jsonResponse({ error: "Rezervasyon oluşturulamadı." }, 500);
      }

      await supabaseAdmin
        .from("lesson_credits")
        .update({ used_booking_id: booking.id })
        .eq("id", appliedCredit.id);

      const lessonInstant = zonedTimeToUtc(String(date), String(time), teacherTimezone);
      const typeLabel = type === "trial" ? "deneme ders" : "ders";
      const joinUrl = `${SITE_URL}/my-lessons.html`;

      if (profile.email) {
        await sendEmail(
          profile.email,
          "Dersin onaylandı - ARMUS",
          bookingConfirmedEmailHtml(
            profile.name, shortDisplayName(teacherName),
            formatDateTimeLabel(lessonInstant, profile.timezone), typeLabel, joinUrl,
          ),
        );
      }
      if (teacherEmail) {
        await sendEmail(
          teacherEmail,
          "Yeni bir dersin var - ARMUS",
          bookingConfirmedEmailHtml(
            // teacherEmail is only ever set for a real teacher, whose name
            // was already copied into teacherName - the || is for the type
            // system, not a real fallback
            teacherRealName || teacherName, profile.name,
            formatDateTimeLabel(lessonInstant, teacherTimezone), typeLabel, joinUrl,
          ),
        );
      }

      return jsonResponse({ bookedDirectly: true, creditApplied: true });
    }

    const cleanPhone = normalizeTurkishGsm(phone);
    if (!cleanPhone) {
      return jsonResponse({ error: "Geçerli bir cep telefonu numarası gir." }, 400);
    }

    const cleanIdentity = String(identityNumber || "").trim();
    if (!isValidTurkishIdentityNumber(cleanIdentity)) {
      return jsonResponse({ error: "Geçerli bir T.C. kimlik numarası gir (11 haneli)." }, 400);
    }

    // Two open tabs, or a double-click on "confirm", can both reach this
    // point before either one's pending_payments row resolves - each
    // would otherwise get its own iyzico checkout page, and if both get
    // paid that's two real charges for what the student meant as one
    // booking (only one ever becomes a real booking; the other today
    // just turns into a lesson credit instead of a refund - better than
    // losing the money, but the double charge itself should never
    // happen). Block a second identical request outright while an
    // earlier one for the exact same thing is still unresolved. Scoped
    // to the last 20 minutes so an abandoned checkout (student just
    // never finishes it, no callback ever fires) doesn't lock this
    // slot/package out forever.
    const duplicateMatch = type === "package"
      ? { teacher_id: teacherId, quantity: numericQuantity }
      : { teacher_id: teacherId, lesson_date: date, lesson_time: time };

    const { data: inFlight } = await supabaseAdmin
      .from("pending_payments")
      .select("id")
      .eq("student_id", user.id)
      .eq("type", type)
      .match(duplicateMatch)
      .in("status", ["pending", "processing"])
      .gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString())
      .limit(1)
      .maybeSingle();

    if (inFlight) {
      return jsonResponse({ error: "Bu işlem için zaten bir ödemen devam ediyor. Diğer sekmeyi tamamla ya da birkaç dakika sonra tekrar dene." }, 409);
    }

    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("pending_payments")
      .insert({
        conversation_id: conversationId,
        student_id: user.id,
        student_name: profile.name,
        teacher_id: teacherId,
        teacher_name: teacherName,
        type,
        lesson_date: type === "package" ? null : date,
        lesson_time: type === "package" ? null : time,
        quantity: type === "package" ? numericQuantity : null,
        price: numericPrice,
        status: "pending",
      })
      .select()
      .single();

    if (pendingError || !pending) {
      console.error("pending_payments insert failed", pendingError);
      return jsonResponse({ error: "Ödeme başlatılamadı." }, 500);
    }

    const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/payment-callback`;
    const addressLine = profile.city || "Türkiye";

    const iyzicoRequest = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: numericPrice.toFixed(2),
      paidPrice: numericPrice.toFixed(2),
      currency: Iyzipay.CURRENCY.TRY,
      basketId: pending.id,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl,
      buyer: {
        id: user.id,
        name: firstName,
        surname: lastName,
        gsmNumber: cleanPhone,
        email: profile.email || user.email,
        identityNumber: cleanIdentity,
        registrationAddress: addressLine,
        // x-forwarded-for is "client, proxy1, proxy2, ..." as a request
        // passes through hops - the FIRST entry is client-supplied and
        // trivially spoofable (functions.invoke lets a caller set
        // arbitrary headers), but the LAST entry is the one appended by
        // our own edge network's trusted final hop. Sending the
        // spoofable first entry to iyzico's buyer.ip let a caller mask
        // the real originating IP on a fraudulent card attempt from
        // whatever fraud/3-D-Secure risk scoring iyzico does with it -
        // same class of bug already fixed in send-contact-email/site-chat.
        ip: req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "85.34.78.112",
        city: profile.city || "İstanbul",
        country: "Turkey",
      },
      shippingAddress: {
        contactName: profile.name || "ARMUS Kullanıcısı",
        city: profile.city || "İstanbul",
        country: "Turkey",
        address: addressLine,
      },
      billingAddress: {
        contactName: profile.name || "ARMUS Kullanıcısı",
        city: profile.city || "İstanbul",
        country: "Turkey",
        address: addressLine,
      },
      basketItems: [
        {
          id: pending.id,
          name: type === "package"
            ? `${numericQuantity} Ders Paketi - ${teacherName}`
            : `${type === "trial" ? "Deneme Dersi" : "Ders"} - ${teacherName}`,
          category1: "Eğitim",
          itemType: Iyzipay.BASKET_ITEM_TYPE.VIRTUAL,
          price: numericPrice.toFixed(2),
        },
      ],
    };

    const result: any = await new Promise((resolve, reject) => {
      iyzipay.checkoutFormInitialize.create(iyzicoRequest, (err: unknown, res: unknown) => {
        if (err) reject(err); else resolve(res);
      });
    });

    if (result.status !== "success") {
      await supabaseAdmin.from("pending_payments").update({ status: "failed" }).eq("id", pending.id);
      console.error("iyzico initialize failed", result);
      return jsonResponse({ error: result.errorMessage || "Ödeme başlatılamadı." }, 500);
    }

    await supabaseAdmin
      .from("pending_payments")
      .update({ iyzico_token: result.token })
      .eq("id", pending.id);

    return jsonResponse({ paymentPageUrl: result.paymentPageUrl });

  } catch (err) {
    console.error(err);
    return jsonResponse({ error: "Beklenmeyen bir hata oluştu." }, 500);
  }
});
