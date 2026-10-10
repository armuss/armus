// ARMUS - a subscribable calendar (.ics) feed of a teacher's own lessons,
// for dashboard.html's "Takvim Senkronizasyonu" section (Uygunluk tab).
// A calendar app (Google Calendar, Apple Calendar, ...) fetches this URL
// itself on its own refresh schedule - it can't carry a Supabase session,
// so this is reached unauthenticated and gated by the teacher+token query
// params instead of RLS. `token` must match that teacher's own
// profiles.calendar_token (migration_95.sql) - long and random enough
// that only someone holding the URL can read that schedule, same role a
// magic-link token plays elsewhere. Never called by the site itself; a
// teacher copies this URL once into their calendar app's "subscribe by
// URL" feature.
//
// No TRIGGER_SECRET check here (unlike the other Edge Functions) - this
// one is deliberately public-by-token, not trigger-only.
//
// Needs no secrets beyond the two already present in every Edge Function
// environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from "npm:@supabase/supabase-js@2";

const ARMUS_LESSON_MINUTES = 50;

// verbatim port of bookings.js's armusZonedTimeToUtc - lesson_date/
// lesson_time are wall-clock strings with no zone of their own, they mean
// whatever the TEACHER's calendar grid meant in the teacher's own local
// time (migration_37.sql) - this turns one back into the real UTC instant
// it refers to, DST-aware for any IANA zone (Deno's Intl support covers
// this the same way a browser's does).
function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string) {
  const guess = new Date(`${dateStr}T${timeStr}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Europe/Istanbul",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(guess).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second),
  );
  return new Date(guess.getTime() + (guess.getTime() - asIfUtc));
}

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// RFC5545 §3.3.11 TEXT escaping
function icsEscape(str: string) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string) {
  // RFC5545 §3.1: lines over 75 octets get folded with CRLF + a leading
  // space - most calendar apps tolerate long lines, but Outlook doesn't
  if (line.length <= 75) return line;
  let out = "";
  let rest = line;
  while (rest.length > 75) {
    out += rest.slice(0, 75) + "\r\n ";
    rest = rest.slice(75);
  }
  return out + rest;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const teacherId = url.searchParams.get("teacher");
    const token = url.searchParams.get("token");

    if (!teacherId || !token) {
      return new Response("missing teacher or token", { status: 400 });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: teacher } = await supabaseAdmin
      .from("profiles")
      .select("id, name, calendar_token")
      .eq("id", teacherId)
      .maybeSingle();

    if (!teacher || teacher.calendar_token !== token) {
      return new Response("unauthorized", { status: 401 });
    }

    const { data: bookings } = await supabaseAdmin
      .from("bookings")
      .select("*")
      .eq("teacher_id", teacherId)
      .neq("status", "cancelled");

    const now = icsDate(new Date());

    const events = (bookings || []).map((b) => {
      const start = zonedTimeToUtc(b.lesson_date, b.lesson_time, b.teacher_timezone || "Europe/Istanbul");
      const end = new Date(start.getTime() + ARMUS_LESSON_MINUTES * 60000);
      const summary = b.type === "trial"
        ? `${b.student_name} ile deneme dersi`
        : `${b.student_name} ile ders`;
      return [
        "BEGIN:VEVENT",
        `UID:${b.id}@armus.com.tr`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        foldLine(`SUMMARY:${icsEscape(summary)}`),
        "END:VEVENT",
      ].join("\r\n");
    });

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//ARMUS//Teacher Calendar//TR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      foldLine(`X-WR-CALNAME:${icsEscape(`ARMUS Derslerim - ${teacher.name}`)}`),
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n") + "\r\n";

    return new Response(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "inline; filename=armus-dersler.ics",
        "Cache-Control": "no-store",
      },
    });

  } catch (err) {
    console.error(err);
    return new Response("error", { status: 500 });
  }
});
