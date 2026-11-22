// Headless E2E for tools/touch_harness (Chrome DevTools Protocol, Node >= 22).
// Usage from the repo root:
//   python3 -m http.server 8765 --bind 127.0.0.1 &
//   node tools/touch_harness/e2e_cdp.mjs        (CHROME=/path/to/chrome to override)
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 9333;
const chrome = spawn(process.env.CHROME || 'google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu',
  `--remote-debugging-port=${PORT}`, '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + (process.env.TMPDIR || '/tmp') + '/ttm-chrome-' + process.pid, 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const consoleMsgs = [];
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}
const results = [];
function check(name, ok, detail = '') { results.push({ name, ok: !!ok, detail }); }
async function touch(type, x, y) {
  await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
}
try {
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(200); }
  }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    if (d.method === 'Runtime.consoleAPICalled') consoleMsgs.push(d.params.type + ': ' + d.params.args.map(a => a.value ?? a.description).join(' '));
    if (d.method === 'Runtime.exceptionThrown') consoleMsgs.push('EXCEPTION: ' + JSON.stringify(d.params.exceptionDetails).slice(0, 300));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2.6, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: 'http://127.0.0.1:8765/tools/touch_harness/index.html' });
  await sleep(2500);

  check('userscript initialised (window.TTM)', await ev('!!(window.TTM && TTM.adblock && TTM.player && TTM.settingsUi && TTM.gestures)'));
  check('Trusted Types enforced like m.youtube.com', await ev(`(() => { try { document.createElement('div').innerHTML = '<b>x</b>'; return false; } catch (e) { return e instanceof TypeError; } })()`));
  check('modules loaded from repo path', (await ev('window.__harnessModuleBase')) === '../../cobalt/shell/embedded_resources/cobalt_java_script_polyfill/');
  check('ad CSS hides feed/overlay ads', await ev(`['ytm-promoted-sparkles-web-renderer','ad-slot-renderer','ytm-companion-ad-renderer','.ytp-ad-overlay-container']
     .every(s => getComputedStyle(document.querySelector(s)).display === 'none')`));
  check('normal tiles still visible', await ev(`getComputedStyle(document.querySelector('ytm-rich-item-renderer')).display !== 'none'`));
  const jsonOk = await ev(`(() => { const p = JSON.parse(JSON.stringify({responseContext:{}, adPlacements:[1], playerAds:[1],
     contents:{items:[{videoRenderer:{}},{adSlotRenderer:{}},{richItemRenderer:{content:{promotedSparklesWebRenderer:{}}}}]}}));
     return !p.adPlacements && !p.playerAds && p.contents.items.length === 1; })()`);
  check('JSON.parse strips ad data', jsonOk);
  const fetchJson = await ev(`new Response(JSON.stringify({responseContext:{}, playerAds:[1], x:1})).json().then(o => !o.playerAds && o.x === 1)`);
  check('Response.json strips ad data', fetchJson);

  // Speed: set default 1.5 and check video.
  await ev(`document.querySelector('#movie_player video').play().catch(()=>{})`);
  await sleep(500);
  await ev(`TTM.setSetting('speed', 1.5)`);
  await sleep(300);
  check('default speed applied', (await ev(`document.querySelector('#movie_player video').playbackRate`)) === 1.5);
  check('settings persisted in localStorage', (await ev(`JSON.parse(localStorage.getItem('tizentube_mobile_settings_v1')).speed`)) === 1.5);
  await ev(`TTM.setSetting('speed', 1)`);

  // SponsorBlock: mock segments loaded, seek into sponsor 5..12 -> skip + toast.
  check('SponsorBlock segments loaded', (await ev(`TTM.player.sponsorblock.segments.length`)) === 4);
  await ev(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 6; return v.play().catch(()=>{}); })()`);
  await sleep(900);
  const afterSkip = await ev(`document.querySelector('#movie_player video').currentTime`);
  check('sponsor segment auto-skipped (t>=12)', afterSkip >= 11.9, 't=' + afterSkip.toFixed(2));
  const toast = await ev(`(() => { const t = document.getElementById('ttm-skip-toast'); return t && t.classList.contains('ttm-show') ? t.textContent : null; })()`);
  check('toast shown with Vietnamese text + Hoàn tác', toast && toast.includes('Đã bỏ qua đoạn tài trợ') && toast.includes('Hoàn tác'), toast);
  const rect = await ev(`(() => { const r = document.getElementById('ttm-skip-toast').getBoundingClientRect(); return {b: r.bottom, h: innerHeight}; })()`);
  check('toast at bottom of screen', rect.b > rect.h * 0.7, JSON.stringify(rect));
  // Undo.
  await ev(`document.querySelector('#ttm-skip-toast button').click()`);
  await sleep(900);
  const afterUndo = await ev(`document.querySelector('#movie_player video').currentTime`);
  check('Hoàn tác seeks back into segment and does not re-skip', afterUndo >= 5 && afterUndo < 11, 't=' + afterUndo.toFixed(2));
  check('toast hidden after undo', await ev(`!document.getElementById('ttm-skip-toast').classList.contains('ttm-show')`));
  // Toast auto-hides after 4 s: trigger another skip (selfpromo 20..24).
  await ev(`document.querySelector('#movie_player video').currentTime = 20.5`);
  await sleep(700);
  const t2 = await ev(`document.getElementById('ttm-skip-toast').textContent`);
  check('selfpromo toast text', t2.includes('tự quảng bá'), t2);
  await sleep(4200);
  check('toast auto-hides after 4 s', await ev(`!document.getElementById('ttm-skip-toast').classList.contains('ttm-show')`));
  // Disabled category (intro default off) not skipped: SPA nav to video 2 (intro 2..6).
  await ev(`document.getElementById('btn-next').click()`);
  await sleep(1200);
  check('SPA navigation reloads segments', (await ev(`TTM.player.sponsorblock.videoId`)) === 'jNQXAC9IVRw');
  await ev(`(() => { const v = document.querySelector('#movie_player video'); v.currentTime = 3; return v.play().catch(()=>{}); })()`);
  await sleep(800);
  const tIntro = await ev(`document.querySelector('#movie_player video').currentTime`);
  check('disabled category (intro) not skipped', tIntro < 6, 't=' + tIntro.toFixed(2));

  // Ad playing: click skip / jump.
  await ev(`document.getElementById('btn-ad').click()`);
  await sleep(1800);
  const adState = await ev(`({ad: document.getElementById('movie_player').classList.contains('ad-showing'), muted: document.querySelector('#movie_player video').muted})`);
  check('playing ad skipped (jump to end / skip click)', !adState.ad, JSON.stringify(adState));
  await sleep(800);
  check('video unmuted after ad', !(await ev(`document.querySelector('#movie_player video').muted`)));

  // Gestures: vertical swipe right half = volume via bridge.
  const pr = await ev(`(() => { const r = document.getElementById('movie_player').getBoundingClientRect(); return {l:r.left,t:r.top,w:r.width,h:r.height}; })()`);
  const vol0 = await ev(`TizenTubeMobile.getVolume()`);
  let x = pr.l + pr.w * 0.75, y0 = pr.t + pr.h * 0.55;
  await ev(`window.__nativeLogCount = document.querySelectorAll('#log div').length`);
  await touch('touchStart', x, y0);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', x, y0 - i * 8); await sleep(16); }
  const indShown = await ev(`(() => { const e = document.getElementById('ttm-level'); if (!e) return null; const r = e.getBoundingClientRect();
     return {show: e.classList.contains('ttm-show'), cx: r.left + r.width/2, cy: r.top + r.height/2, w: innerWidth, h: innerHeight, icon: e.getAttribute('data-icon')}; })()`);
  await touch('touchEnd');
  await sleep(100);
  const vol1 = await ev(`TizenTubeMobile.getVolume()`);
  check('right-half swipe up raises volume (bridge)', vol1 > vol0, `${vol0.toFixed(2)} → ${vol1.toFixed(2)}`);
  check('level indicator shown in centre', indShown && indShown.show && Math.abs(indShown.cx - indShown.w / 2) < 5 && Math.abs(indShown.cy - indShown.h / 2) < 5 && indShown.icon === 'volume', JSON.stringify(indShown));
  const logs = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('swipe not seen as native tap/swipe', !/native/.test(logs), logs.split('\n').filter(l => /native/.test(l)).join(' | '));
  await sleep(900);
  check('indicator hides after gesture', await ev(`!document.getElementById('ttm-level').classList.contains('ttm-show')`));

  // Left half = brightness down.
  const b0 = await ev(`TizenTubeMobile.getBrightness()`);
  x = pr.l + pr.w * 0.25; y0 = pr.t + pr.h * 0.3;
  await touch('touchStart', x, y0);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', x, y0 + i * 8); await sleep(16); }
  await touch('touchEnd');
  await sleep(100);
  const b1 = await ev(`TizenTubeMobile.getBrightness()`);
  check('left-half swipe down lowers brightness (bridge)', b1 < b0, `${b0.toFixed(2)} → ${b1.toFixed(2)}`);

  // Tap and double-tap still reach the "native" player handler.
  await ev(`window.__nativeLogCount = document.querySelectorAll('#log div').length`);
  const tx = pr.l + pr.w * 0.8, ty = pr.t + pr.h * 0.5;
  const tBefore = await ev(`document.querySelector('#movie_player video').currentTime`);
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(80);
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(400);
  const logs2 = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('native double-tap seek still works', /native double-tap seek \+10s/.test(logs2), logs2.split('\n').filter(l => /native/.test(l)).join(' | '));
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(500);
  const logs3 = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('native single tap still toggles controls', /native tap: toggle controls/.test(logs3));
  // Short vertical move below threshold is not claimed.
  const vB = await ev(`TizenTubeMobile.getVolume()`);
  await touch('touchStart', tx, ty); await touch('touchMove', tx, ty - 15); await touch('touchEnd'); await sleep(100);
  check('short move (<24px) ignored', (await ev(`TizenTubeMobile.getVolume()`)) === vB);
  // Horizontal swipe not claimed.
  await touch('touchStart', tx - 100, ty); for (let i = 1; i <= 8; i++) await touch('touchMove', tx - 100 + i * 15, ty + i * 2); await touch('touchEnd'); await sleep(100);
  check('horizontal swipe ignored', (await ev(`TizenTubeMobile.getVolume()`)) === vB);

  // Fallback without bridge: video.volume.
  await ev(`(() => { const c = document.getElementById('opt-bridge'); c.checked = false; c.dispatchEvent(new Event('change')); })()`);
  await ev(`document.querySelector('#movie_player video').volume = 0.3`);
  x = pr.l + pr.w * 0.75; y0 = pr.t + pr.h * 0.55;
  await touch('touchStart', x, y0);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', x, y0 - i * 10); await sleep(16); }
  await touch('touchEnd'); await sleep(100);
  check('fallback: video.volume changes without bridge', (await ev(`document.querySelector('#movie_player video').volume`)) > 0.3);

  // Account menu entry + settings sheet + Back closes sheet.
  await ev(`document.getElementById('avatar-btn').click()`);
  await sleep(500);
  const entry = await ev(`(() => { const e = document.querySelector('ytm-multi-page-menu-renderer [data-ttm-entry]'); if (!e) return null;
     const r = e.getBoundingClientRect(); return {text: e.textContent, h: r.height, first: e === e.parentNode.firstElementChild}; })()`);
  check('"Cài đặt TizenTube" injected into account menu', entry && entry.text.includes('Cài đặt TizenTube'), JSON.stringify(entry));
  check('menu entry touch target ≥ 48px', entry && entry.h >= 48);
  check('no floating TizenTube buttons on page', await ev(`![...document.querySelectorAll('[data-ttm-entry]')].some(e => getComputedStyle(e).position === 'fixed')`));
  await ev(`document.querySelector('[data-ttm-entry]').click()`);
  await sleep(200);
  check('settings sheet opens', await ev(`!!document.getElementById('ttm-sheet')`));
  const sheetText = await ev(`document.getElementById('ttm-sheet').innerText`);
  check('sheet has Vietnamese toggles', ['Chặn quảng cáo', 'SponsorBlock', 'Tốc độ phát mặc định', 'Tài trợ'].every(s => sheetText.includes(s)));
  // Toggle adblock off via sheet → CSS removed.
  await ev(`document.querySelector('#ttm-sheet label input').click()`);
  await sleep(100);
  check('turning off ad blocking shows ads again', await ev(`getComputedStyle(document.querySelector('ytm-promoted-sparkles-web-renderer')).display !== 'none'`));
  await ev(`document.querySelector('#ttm-sheet label input').click()`);
  // Speed select.
  await ev(`(() => { const s = document.querySelector('#ttm-sheet select'); s.value = '2'; s.dispatchEvent(new Event('change')); })()`);
  await sleep(100);
  check('speed from sheet applied', (await ev(`document.querySelector('#movie_player video').playbackRate`)) === 2);
  check('Back handler closes sheet', (await ev(`window.__tizentubeMobileHandleBack()`)) === true && (await ev(`!document.getElementById('ttm-sheet')`)));
  // With the 25_layout module, Back first leaves the landscape fill (if a video put the
  // page into it), and only then reports "nothing to close" so the app does history.back().
  const backFill = await ev(`(() => { const wasFill = TTM.layout.mode !== 'off'; const r1 = window.__tizentubeMobileHandleBack(); return { wasFill, r1, r2: window.__tizentubeMobileHandleBack() }; })()`);
  check('Back handler: exits fill first (if any), then returns false', backFill.r2 === false && backFill.r1 === backFill.wasFill, JSON.stringify(backFill));
  // Fallback location: overflow sheet when account menu closed.
  await ev(`document.body.click()`);
  await sleep(100);
  await ev(`document.getElementById('overflow-btn').click()`);
  await sleep(300);
  check('fallback entry in player overflow sheet', await ev(`!!document.querySelector('ytm-bottom-sheet-renderer [data-ttm-entry]')`));
  // Persistence across reload.
  await send('Page.reload');
  await sleep(2000);
  check('settings survive reload', (await ev(`TTM.settings.speed`)) === 2);
  await ev(`localStorage.clear()`);

  // ---------------------------------------------------- designer v4 checks
  check('open-in-app button hidden', await ev(`getComputedStyle(document.getElementById('mock-open-app')).display === 'none'`));
  // Landscape fill: play video -> header hidden, player covers the viewport.
  await ev(`(() => { localStorage.clear(); })()`);
  await send('Page.reload'); await sleep(2000);
  await ev(`document.querySelector('#movie_player video').play().catch(()=>{})`);
  await sleep(800);
  const fill = await ev(`(() => { const r = document.getElementById('player-container-id').getBoundingClientRect();
    const v = document.querySelector('#movie_player video').getBoundingClientRect();
    return { mode: TTM.layout.mode, cls: document.documentElement.classList.contains('ttm-fill'),
      header: getComputedStyle(document.getElementById('header-bar')).display, r: [r.left, r.top, r.width, r.height],
      v: [v.left, v.top, v.width, v.height], fit: getComputedStyle(document.querySelector('#movie_player video')).objectFit,
      vw: innerWidth, vh: innerHeight }; })()`);
  check('landscape auto-fill: player covers viewport, header hidden',
    (fill.mode === 'fill' || fill.mode === 'real') && fill.cls && fill.header === 'none' && fill.r[0] === 0 && fill.r[1] === 0 &&
    fill.r[2] === fill.vw && fill.r[3] === fill.vh && fill.v[2] === fill.vw && fill.v[3] === fill.vh && fill.fit === 'cover', JSON.stringify(fill));
  // Toast contrast: compute WCAG ratio over a white backdrop (worst case).
  await ev(`TTM.player.showSkipToast({ category: 'sponsor' }, function () {})`);
  // v5: no fade-in, the toast is fully opaque in the same frame it is shown.
  const toastNow = await ev(`(() => { const t = document.getElementById('ttm-skip-toast'); const cs = getComputedStyle(t);
    return { opacity: cs.opacity, anims: t.getAnimations().length, bg: cs.backgroundColor, color: cs.color }; })()`);
  check('toast opaque immediately (no fade-in), bg rgba(0,0,0,.85), text #fff', toastNow.opacity === '1' && toastNow.anims === 0 &&
    toastNow.bg === 'rgba(0, 0, 0, 0.85)' && toastNow.color === 'rgb(255, 255, 255)', JSON.stringify(toastNow));
  const contrast = await ev(`(() => {
    const parse = c => c.match(/[\\d.]+/g).map(Number);
    const lum = ([r, g, b]) => { const f = x => (x /= 255) <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const over = (fg, bg) => { const a = fg[3] === undefined ? 1 : fg[3]; return [0, 1, 2].map(i => fg[i] * a + bg[i] * (1 - a)); };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const t = document.getElementById('ttm-skip-toast'), b = t.querySelector('button');
    const ts = getComputedStyle(t), bs = getComputedStyle(b);
    const bg = parse(ts.backgroundColor), bgOnWhite = over(bg, [255, 255, 255]);
    const btnBg = over(parse(bs.backgroundColor), bgOnWhite);
    return { alpha: bg[3], text: +ratio(parse(ts.color), bgOnWhite).toFixed(2), button: +ratio(parse(bs.color), btnBg).toFixed(2), weight: +bs.fontWeight }; })()`);
  check('toast ~85% opaque, text and bold "Hoàn tác" ≥ 4.5:1 even over white', contrast.alpha >= 0.8 && contrast.text >= 4.5 && contrast.button >= 4.5 && contrast.weight >= 700, JSON.stringify(contrast));
  // Settings sheet: ✕, 85vh, scrollable body; Back closes sheet first, then fill.
  await ev(`TTM.settingsUi.open()`);
  await sleep(200);
  const sh = await ev(`(() => { const s = document.getElementById('ttm-sheet'), b = s.querySelector('.ttm-body'), x = s.querySelector('.ttm-x');
    const r = s.getBoundingClientRect(), xr = x.getBoundingClientRect();
    const intro = [...b.querySelectorAll('label')].find(l => l.textContent.includes('Mở đầu'));
    return { h: r.height, vh: innerHeight, top: r.top, bottom: r.bottom, scrollable: b.scrollHeight > b.clientHeight,
      x: [xr.width, xr.height, Math.round(xr.right - r.right), Math.round(xr.top - r.top)], hasIntro: !!intro }; })()`);
  check('settings sheet ≤ 85vh, inside viewport, body scrolls, ✕ ≥ 48px top-right',
    sh.h <= sh.vh * 0.851 && sh.top >= 0 && sh.bottom <= sh.vh && sh.scrollable && sh.x[0] >= 48 && sh.x[1] >= 48 && sh.x[2] <= 0 && sh.x[2] > -16 && sh.x[3] < 16 && sh.hasIntro, JSON.stringify(sh));
  // Touch-drag inside the sheet body scrolls it and is not taken as a volume swipe.
  const vBefore = await ev(`TizenTubeMobile.getVolume()`);
  const bb = await ev(`(() => { const r = document.querySelector('#ttm-sheet .ttm-body').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.75, r.top + r.height * 0.2]; })()`);
  // Raw touch drag (Input.synthesizeScrollGesture is a no-op in headless).
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bb[0], y: bb[1] }] });
  for (let i = 1; i <= 20; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bb[0], y: bb[1] + (bb[2] - bb[1]) * i / 20 }] }); await sleep(16); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(400);
  const scrolled = await ev(`document.querySelector('#ttm-sheet .ttm-body').scrollTop`);
  check('touch scroll in sheet scrolls body, no volume change', scrolled > 20 && (await ev(`TizenTubeMobile.getVolume()`)) === vBefore, 'scrollTop=' + scrolled);
  check('no bottom "Đóng" button / actions bar in the sheet (v5)', await ev(`(() => { const s = document.getElementById('ttm-sheet');
    return !s.querySelector('.ttm-actions') && [...s.querySelectorAll('button')].every(b => b.classList.contains('ttm-x')); })()`));
  await ev(`document.querySelector('#ttm-sheet .ttm-x').click()`);
  check('✕ closes the sheet', await ev(`!document.getElementById('ttm-sheet')`));
  await ev(`TTM.settingsUi.open()`);
  check('Back #1 closes sheet (fill stays)', (await ev(`window.__tizentubeMobileHandleBack()`)) === true && (await ev(`!document.getElementById('ttm-sheet') && TTM.layout.mode !== 'off'`)));
  const back2 = await ev(`window.__tizentubeMobileHandleBack()`);
  const modeAfter = await ev(`TTM.layout.mode`);
  check('Back #2 exits fill mode', modeAfter === 'off' || (back2 === false && modeAfter === 'real'), 'back2=' + back2 + ' mode=' + modeAfter);
  check('header visible again after exit', modeAfter !== 'off' || (await ev(`getComputedStyle(document.getElementById('header-bar')).display !== 'none'`)));

  const errs = consoleMsgs.filter(m => /EXCEPTION|^error/.test(m) && !/JSDelivr/.test(m));
  check('no JS exceptions / console errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('harness run', false, String(e.stack || e));
} finally {
  chrome.kill('SIGKILL');
  let pass = 0;
  for (const r of results) { console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.detail ? '  [' + r.detail + ']' : '')); if (r.ok) pass++; }
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
