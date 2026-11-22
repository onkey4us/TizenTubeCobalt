// Host-guard unit test: runs the REAL tizentube_mobile_*.js modules in a Node vm with a
// fake window/location/document for many URLs, and checks they only activate on the
// youtube.com web hosts (never on accounts.google.com etc.).
// Usage: node tools/touch_harness/host_guard_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '../../cobalt/shell/embedded_resources/cobalt_java_script_polyfill');
const modules = fs.readdirSync(dir).filter(f => /^tizentube_mobile_.*\.js$/.test(f)).sort()
  .map(f => ({ f, src: fs.readFileSync(path.join(dir, f), 'utf8') }));

function run(url, { harness = false, topFrame = true } = {}) {
  const u = new URL(url);
  const touched = [];
  const noop = () => {};
  const el = () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, appendChild: noop, addEventListener: noop, querySelector: () => null });
  const document = {
    readyState: 'loading', head: null, documentElement: null, body: null,
    createElement: () => { touched.push('createElement'); return el(); },
    createElementNS: () => { touched.push('createElementNS'); return el(); },
    createTextNode: () => ({}),
    addEventListener: (t) => touched.push('document.addEventListener:' + t),
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  };
  const win = {
    location: { href: u.href, hostname: u.hostname, pathname: u.pathname, protocol: u.protocol, search: u.search },
    document, localStorage: { getItem: () => null, setItem: noop },
    addEventListener: (t) => touched.push('window.addEventListener:' + t),
    matchMedia: () => ({ matches: true, addEventListener: noop }),
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: noop, requestAnimationFrame: noop,
    console: { log: noop, warn: noop, error: noop },
    MutationObserver: function () { this.observe = noop; this.disconnect = noop; },
    URLSearchParams, Event: function () {}, JSON: { parse: JSON.parse, stringify: JSON.stringify },
    innerWidth: 915, innerHeight: 412,
  };
  const realParse = win.JSON.parse;
  win.window = win; win.self = win; win.top = topFrame ? win : {};
  if (harness) win.__TIZENTUBE_MOBILE_HARNESS__ = true;
  win.fetch = function () {}; win.Response = function () {}; win.Response.prototype.json = function () {};
  const realJson = win.Response.prototype.json, realFetch = win.fetch;
  const ctx = vm.createContext(win);
  for (const m of modules) vm.runInContext(m.src, ctx, { filename: m.f });
  return {
    active: !!win.TTM,
    hooked: win.JSON.parse !== realParse || win.Response.prototype.json !== realJson || win.fetch !== realFetch,
    touched: touched.length,
    backHook: typeof win.__tizentubeMobileHandleBack === 'function',
  };
}

const cases = [
  ['https://m.youtube.com/', true],
  ['https://m.youtube.com/watch?v=kJQP7kiw5Fk', true],
  ['https://www.youtube.com/watch?v=kJQP7kiw5Fk', true],
  ['https://youtube.com/', true],
  ['https://accounts.google.com/ServiceLogin?service=youtube', false],
  ['https://accounts.google.com/v3/signin/identifier', false],
  ['https://accounts.youtube.com/accounts/SetSID', false],
  ['https://myaccount.google.com/', false],
  ['https://consent.youtube.com/m?continue=https://m.youtube.com/', false],
  ['https://consent.google.com/', false],
  ['https://www.google.com/', false],
  ['https://music.youtube.com/', false],
  ['https://studio.youtube.com/', false],
  ['https://m.youtube.com.evil.example/', false],
  ['https://evilyoutube.com/', false],
  ['http://m.youtube.com/', false],
  ['https://www.youtube.com/tv', false],
  ['https://www.youtube.com/tv#/browse', false],
  ['https://sponsor.ajay.app/', false],
  ['https://accounts.google.com/', false, { harness: true }],  // page cannot opt in
  ['http://127.0.0.1:8765/tools/touch_harness/', true, { harness: true }],
  ['http://127.0.0.1:8765/tools/touch_harness/', false],
  ['https://m.youtube.com/embed/x', false, { topFrame: false }],  // iframe
];

let pass = 0;
for (const [url, expected, opts] of cases) {
  const r = run(url, opts);
  const ok = r.active === expected && (expected || (!r.hooked && r.touched === 0 && !r.backHook));
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${expected ? 'runs   ' : 'no-op  '} ${url}${opts ? ' ' + JSON.stringify(opts) : ''}` +
    (ok ? '' : `  -> ${JSON.stringify(r)}`));
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(pass === cases.length ? 0 : 1);
