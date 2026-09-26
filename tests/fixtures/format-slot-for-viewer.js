// Fixture spawned as a child process with a specific TZ (see
// bookings.test.js) - prints the result of formatting a fixed
// teacher-local slot for "the viewer" (this process's own local timezone,
// which is exactly what armusFormatSlotTimeRangeForViewer's un-zoned
// toLocaleTimeString() calls read).
const { loadScripts } = require("../helpers/load-scripts");
const ctx = loadScripts(["bookings.js"]);
process.stdout.write(ctx.armusFormatSlotTimeRangeForViewer("2026-06-15", "14:00", "Europe/Istanbul"));
