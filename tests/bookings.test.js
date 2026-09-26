// Regression tests for the pure booking/timezone/earnings logic in
// bookings.js (+ reviews.js's armusIsBookingPast, which depends on it).
// These guard exactly the bug classes that have actually shipped and been
// found in this codebase before: the toISOString()-vs-local-date
// timezone trap, teacher-vs-viewer timezone confusion, and commission-tier
// drift between dashboard.html and admin.html.
//
// Run: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadScripts } = require("./helpers/load-scripts");

const ctx = loadScripts(["bookings.js", "reviews.js"]);

// Values returned from the vm sandbox belong to a different realm - their
// Array/Object wrappers aren't the host realm's, so assert.deepEqual
// (deepStrictEqual under node:assert/strict) reports "same structure but
// not reference-equal" even when the actual values match. Round-tripping
// through JSON rebuilds the value with host-realm Array/Object
// constructors; fine here since every value crossing this boundary in
// these tests is plain strings/numbers/booleans.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("armusZonedTimeToUtc - Europe/Istanbul (fixed UTC+3, no DST)", () => {
  const result = ctx.armusZonedTimeToUtc("2026-06-15", "14:00", "Europe/Istanbul");
  assert.equal(result.toISOString(), "2026-06-15T11:00:00.000Z");
});

test("armusZonedTimeToUtc - America/New_York, correctly handles DST", () => {
  // EDT (summer, UTC-4)
  const summer = ctx.armusZonedTimeToUtc("2026-07-15", "14:00", "America/New_York");
  assert.equal(summer.toISOString(), "2026-07-15T18:00:00.000Z");
  // EST (winter, UTC-5) - same wall-clock time, different real offset
  const winter = ctx.armusZonedTimeToUtc("2026-01-15", "14:00", "America/New_York");
  assert.equal(winter.toISOString(), "2026-01-15T19:00:00.000Z");
});

test("armusZonedTimeToUtc - midnight wall time on a date boundary", () => {
  // teacher-local midnight in Istanbul on the 24th is still the 23rd in UTC
  const result = ctx.armusZonedTimeToUtc("2026-09-24", "00:00", "Europe/Istanbul");
  assert.equal(result.toISOString(), "2026-09-23T21:00:00.000Z");
});

test("armusFormatTimeRange - adds the lesson duration and pads/wraps correctly", () => {
  assert.equal(ctx.armusFormatTimeRange("10:00"), "10:00 – 10:50");
  assert.equal(ctx.armusFormatTimeRange("09:05"), "09:05 – 09:55");
  // wraps past midnight
  assert.equal(ctx.armusFormatTimeRange("23:40"), "23:40 – 00:30");
});

test("armusAllTimeSlots - 48 half-hour slots, first and last correct", () => {
  const slots = ctx.armusAllTimeSlots();
  assert.equal(slots.length, 48);
  assert.equal(slots[0], "00:00");
  assert.equal(slots[1], "00:30");
  assert.equal(slots[47], "23:30");
});

test("armusRoomNameForBooking - stable and strips dashes from the id", () => {
  const name = ctx.armusRoomNameForBooking("abc-123-def-456");
  assert.equal(name, "armus-lesson-abc123def456");
  // same id always produces the same room name
  assert.equal(ctx.armusRoomNameForBooking("abc-123-def-456"), name);
});

test("armusSlotsForDate - _set sentinel (new-style availability) takes precedence", () => {
  const teacher = {
    id: "t1",
    availabilityDates: { _set: true, "1": ["10:00", "10:30"] }, // Monday only
    weeklyAvailability: { 1: ["14:00"] }, // should be ignored - _set wins
  };
  const slots = ctx.armusSlotsForDate(teacher, "2026-09-28", 1, []); // a Monday
  const available = plain(slots.filter(s => s.available).map(s => s.time));
  assert.deepEqual(available, ["10:00", "10:30"]);
});

test("armusSlotsForDate - empty availabilityDates with _set:true means genuinely no slots, not a fallback", () => {
  // the whole point of the _set sentinel (dashboard.html): distinguishes
  // "teacher saved an empty calendar on purpose" from "never touched it"
  const teacher = {
    id: "t1",
    availabilityDates: { _set: true },
    weeklyAvailability: { 1: ["14:00"] }, // must NOT be used as a fallback here
  };
  const slots = ctx.armusSlotsForDate(teacher, "2026-09-28", 1, []);
  assert.equal(slots.some(s => s.available), false);
});

test("armusSlotsForDate - falls back to weeklyAvailability when availabilityDates was never set", () => {
  const teacher = { id: "t1", weeklyAvailability: { 2: ["09:00"] } }; // Tuesday
  const slots = ctx.armusSlotsForDate(teacher, "2026-09-29", 2, []);
  const available = plain(slots.filter(s => s.available).map(s => s.time));
  assert.deepEqual(available, ["09:00"]);
});

test("armusSlotsForDate - an already-booked (busy) time is never offered, even if the teacher's grid allows it", () => {
  const teacher = { id: "t1", weeklyAvailability: { 1: ["10:00", "10:30"] } };
  const busy = [{ date: "2026-09-28", time: "10:00" }];
  const slots = ctx.armusSlotsForDate(teacher, "2026-09-28", 1, busy);
  const available = plain(slots.filter(s => s.available).map(s => s.time));
  assert.deepEqual(available, ["10:30"]);
});

test("armusSlotsForDate - a cancelled busy row doesn't block the slot", () => {
  const teacher = { id: "t1", weeklyAvailability: { 1: ["10:00"] } };
  const busy = [{ date: "2026-09-28", time: "10:00", status: "cancelled" }];
  const slots = ctx.armusSlotsForDate(teacher, "2026-09-28", 1, busy);
  assert.equal(slots.find(s => s.time === "10:00").available, true);
});

test("armusTrialCountsAsEarned - a non-trial booking always counts", () => {
  const booking = { id: "b1", type: "lesson" };
  assert.equal(ctx.armusTrialCountsAsEarned(booking, [], []), true);
});

test("armusTrialCountsAsEarned - an unconverted trial (no real lesson, no credit) doesn't count yet", () => {
  const booking = { id: "b1", type: "trial", studentId: "s1", teacherId: "t1" };
  assert.equal(ctx.armusTrialCountsAsEarned(booking, [booking], []), false);
});

test("armusTrialCountsAsEarned - converts once the student books a real lesson with the same teacher", () => {
  const trial = { id: "b1", type: "trial", studentId: "s1", teacherId: "t1" };
  const realLesson = { id: "b2", type: "lesson", studentId: "s1", teacherId: "t1", status: "confirmed" };
  assert.equal(ctx.armusTrialCountsAsEarned(trial, [trial, realLesson], []), true);
});

test("armusTrialCountsAsEarned - only the earliest of several trials against the same teacher is ever credited", () => {
  const trial1 = { id: "b1", type: "trial", studentId: "s1", teacherId: "t1", createdAt: "2026-01-01T00:00:00Z" };
  const trial2 = { id: "b2", type: "trial", studentId: "s1", teacherId: "t1", createdAt: "2026-02-01T00:00:00Z" };
  const realLesson = { id: "b3", type: "lesson", studentId: "s1", teacherId: "t1", status: "confirmed" };
  const all = [trial1, trial2, realLesson];
  assert.equal(ctx.armusTrialCountsAsEarned(trial1, all, []), true, "the earliest trial should be credited");
  assert.equal(ctx.armusTrialCountsAsEarned(trial2, all, []), false, "a later duplicate trial should not double-count");
});

test("armusCommissionForHours - every tier boundary", () => {
  const cases = [
    [0, 30, 0], [99.9, 30, 0],
    [100, 28, 1], [199.9, 28, 1],
    [200, 25, 2], [299.9, 25, 2],
    [300, 20, 3], [499.9, 20, 3],
    [500, 15, 4], [1000, 15, 4],
  ];
  for (const [hours, expectedRate, expectedTier] of cases) {
    const result = ctx.armusCommissionForHours(hours);
    assert.equal(result.rate, expectedRate, `rate at ${hours}h`);
    assert.equal(result.tierIndex, expectedTier, `tierIndex at ${hours}h`);
  }
});

test("armusIsBookingPast - a lesson far in the future is not past", () => {
  const future = { date: "2099-01-01", time: "10:00", teacherTimezone: "Europe/Istanbul" };
  assert.equal(ctx.armusIsBookingPast(future), false);
});

test("armusIsBookingPast - a lesson far in the past is past", () => {
  const past = { date: "2020-01-01", time: "10:00", teacherTimezone: "Europe/Istanbul" };
  assert.equal(ctx.armusIsBookingPast(past), true);
});

test("armusCanJoinLessonNow - true only inside the join window", () => {
  const now = new Date();
  const startInFive = new Date(now.getTime() + 5 * 60000);
  const dateStr = startInFive.toISOString().slice(0, 10);
  const timeStr = startInFive.toISOString().slice(11, 16);
  const soonBooking = { date: dateStr, time: timeStr, teacherTimezone: "UTC" };
  assert.equal(ctx.armusCanJoinLessonNow(soonBooking), true, "starts in 5 min, inside the 15-min early window");

  const farStart = new Date(now.getTime() + 60 * 60000);
  const farBooking = {
    date: farStart.toISOString().slice(0, 10),
    time: farStart.toISOString().slice(11, 16),
    teacherTimezone: "UTC",
  };
  assert.equal(ctx.armusCanJoinLessonNow(farBooking), false, "starts in 60 min, outside the join window");
});

// armusFormatSlotTimeRangeForViewer converts into the CURRENT VIEWER's own
// local time via toLocaleTimeString() with no explicit timeZone - which
// means it depends on the process's own local timezone. Spawn a fresh node
// process with an explicit TZ so the result is deterministic regardless of
// what machine runs this test suite.
test("armusFormatSlotTimeRangeForViewer - converts a teacher-local slot into the viewer's own timezone", () => {
  const fixture = path.join(__dirname, "fixtures", "format-slot-for-viewer.js");
  const run = (tz) => execFileSync(process.execPath, [fixture], {
    env: { ...process.env, TZ: tz },
    encoding: "utf8",
  }).trim();

  // teacher's slot is 14:00 Europe/Istanbul (UTC+3) = 11:00 UTC.
  // a viewer physically in Istanbul should just see it as 14:00.
  assert.equal(run("Europe/Istanbul"), "14:00 – 14:50");
  // a viewer in Honolulu (UTC-10, no DST) should see the same real instant
  // as 01:00 the same day (11:00 UTC - 10h).
  assert.equal(run("Pacific/Honolulu"), "01:00 – 01:50");
});
