// Regression tests for i18n.js's output-sanitization helpers - the
// mandatory guard for any user/DB-derived string going into innerHTML.
// A real stored-XSS vulnerability (an unescaped category value in
// student-dashboard.html) was found and fixed via a missed call to
// armusEscapeHtml earlier in this codebase's history; these tests exist
// so the helper itself never silently regresses.
//
// Run: node --test tests/

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadScripts } = require("./helpers/load-scripts");

const ctx = loadScripts(["i18n.js"]);

test("armusEscapeHtml - escapes all five HTML-significant characters", () => {
  const input = `<script>alert("hi & 'bye'")</script>`;
  const escaped = ctx.armusEscapeHtml(input);
  assert.equal(
    escaped,
    "&lt;script&gt;alert(&quot;hi &amp; &#39;bye&#39;&quot;)&lt;/script&gt;"
  );
  // never contains a raw angle bracket after escaping
  assert.equal(/[<>]/.test(escaped), false);
});

test("armusEscapeHtml - null/undefined become an empty string, not the literal word", () => {
  assert.equal(ctx.armusEscapeHtml(null), "");
  assert.equal(ctx.armusEscapeHtml(undefined), "");
});

test("armusEscapeHtml - non-string input is stringified first", () => {
  assert.equal(ctx.armusEscapeHtml(42), "42");
});

test("armusSafeUrl - rejects a javascript: URL", () => {
  assert.equal(ctx.armusSafeUrl("javascript:alert(1)"), "");
});

test("armusSafeUrl - rejects a data: URL", () => {
  assert.equal(ctx.armusSafeUrl("data:text/html,<script>alert(1)</script>"), "");
});

test("armusSafeUrl - accepts a plain https URL", () => {
  const url = "https://example.com/photo.jpg";
  assert.equal(ctx.armusSafeUrl(url), url);
});

test("armusSafeUrl - rejects an https URL carrying an embedded quote/space (attribute-breakout attempt)", () => {
  assert.equal(ctx.armusSafeUrl(`https://example.com/x" onerror="alert(1)`), "");
  assert.equal(ctx.armusSafeUrl("https://example.com/x y"), "");
});

test("armusSafeUrl - accepts a local demo-teacher avatar path", () => {
  assert.equal(ctx.armusSafeUrl("avatars/sarah.jpg"), "avatars/sarah.jpg");
});

test("armusSafeUrl - rejects a path-traversal attempt disguised as an avatar path", () => {
  assert.equal(ctx.armusSafeUrl("avatars/../../etc/passwd.jpg"), "");
});
