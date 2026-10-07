// Regression tests for messages.js's armusMessageViolatesContactPolicy -
// this has to agree with the messages_block_contact_sharing DB trigger
// (enforce_no_contact_sharing in schema.sql), which is the real,
// unbypassable enforcement. These guard the two ways it previously
// drifted from the trigger: blocking ordinary words that only happen to
// contain a flagged substring (over-blocking, the trigger would have
// allowed them), and missing Turkish phone-sharing inflections the
// trigger's unanchored stems do catch (under-blocking).
//
// Run: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load-scripts");

const ctx = loadScripts(["messages.js"]);

test("armusMessageViolatesContactPolicy - flags an email address", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("mail me at test@example.com please"), true);
});

test("armusMessageViolatesContactPolicy - flags a run of digits as a phone number", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("beni ara 0532 111 22 33"), true);
});

test("armusMessageViolatesContactPolicy - flags whatsapp/instagram/telegram by name", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("bana whatsapptan yaz"), true);
  assert.equal(ctx.armusMessageViolatesContactPolicy("instagramdan takip et"), true);
  assert.equal(ctx.armusMessageViolatesContactPolicy("telegramda da varım"), true);
});

test("armusMessageViolatesContactPolicy - flags insta/imo only as whole words, matching the DB trigger", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("beni insta'dan ekle"), true);
  assert.equal(ctx.armusMessageViolatesContactPolicy("imo'dan yazarım"), true);
});

test("armusMessageViolatesContactPolicy - does not flag ordinary words that merely contain insta/imo as a substring", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("I'll call you instantly"), false);
  assert.equal(ctx.armusMessageViolatesContactPolicy("installment plan works for me"), false);
  assert.equal(ctx.armusMessageViolatesContactPolicy("we took a limousine"), false);
});

test("armusMessageViolatesContactPolicy - catches Turkish phone-sharing inflections beyond the exact base word", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("numarayla yazabilirsin"), true);
  assert.equal(ctx.armusMessageViolatesContactPolicy("numarasıyla arayabilirsin"), true);
});

test("armusMessageViolatesContactPolicy - an ordinary lesson-related message is never flagged", () => {
  assert.equal(ctx.armusMessageViolatesContactPolicy("Yarın saat 5'te görüşelim, hazırlık yapar mısın?"), false);
});
