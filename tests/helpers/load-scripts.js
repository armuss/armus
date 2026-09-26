// Loads one or more of the site's plain <script>-tag JS files (bookings.js,
// i18n.js, reviews.js, ...) into a single isolated vm context and returns
// that context's globals, so their top-level `function armusXxx() {...}`
// declarations can be called directly from a test - the same way they end
// up as globals in a real page once loaded via <script src="...">.
//
// These files were written to run in a browser with no bundler, so they
// sometimes touch `document`/`window` at the top level (i18n.js boots its
// chat widget on DOMContentLoaded). The stub below is only enough to let
// that code load without throwing - it deliberately does nothing, so a
// widget-building side effect never actually runs during a test.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.join(__dirname, "..", "..");

function makeDomStub() {
  const stubEl = () => ({
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    appendChild() {},
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  return {
    readyState: "loading",
    addEventListener() {},
    createElement: stubEl,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    body: stubEl(),
    head: stubEl(),
  };
}

// filenames: e.g. ["bookings.js", "reviews.js"] - loaded in order into one
// shared context, so a later file can call an earlier file's functions
// exactly like they do when loaded as <script> tags on a real page.
function loadScripts(filenames) {
  const context = {
    console,
    // most site JS guards on `typeof X === "function"` before calling an
    // optional cross-file helper (e.g. armusGetLang), so leaving
    // localStorage/armusSupabase undefined is fine unless a test needs one.
    document: makeDomStub(),
    // `window` is a self-reference to the global context, same as a real
    // browser - so `window.addEventListener` has to be a top-level
    // property here, not nested inside a separate object that would just
    // get shadowed by the self-reference below.
    addEventListener() {},
    location: { pathname: "/" },
    navigator: { language: "tr-TR" },
    localStorage: {
      _data: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
      setItem(k, v) { this._data[k] = String(v); },
      removeItem(k) { delete this._data[k]; },
    },
  };
  context.window = context;
  vm.createContext(context);

  for (const filename of filenames) {
    const filePath = path.join(REPO_ROOT, filename);
    const code = fs.readFileSync(filePath, "utf8");
    vm.runInContext(code, context, { filename: filePath });
  }

  return context;
}

module.exports = { loadScripts };
