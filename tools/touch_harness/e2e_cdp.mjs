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

  check('userscript initialised (window.TTM)', await ev('!!(window.TTM && TTM.adblock && TTM.player && TTM.settingsUi && TTM.layout && TTM.visibility && TTM.background && !TTM.gestures)'));
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

  // ------------------------------------------------ v6: no vertical swipes
  const pr = await ev(`(() => { const r = document.getElementById('movie_player').getBoundingClientRect(); return {l:r.left,t:r.top,w:r.width,h:r.height}; })()`);
  const vol0 = await ev(`TizenTubeMobile.getVolume()`), bri0 = await ev(`TizenTubeMobile.getBrightness()`);
  let x = pr.l + pr.w * 0.75, y0 = pr.t + pr.h * 0.55;
  await touch('touchStart', x, y0);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', x, y0 - i * 8); await sleep(16); }
  await touch('touchEnd'); await sleep(200);
  x = pr.l + pr.w * 0.25;
  await touch('touchStart', x, y0);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', x, y0 - i * 8); await sleep(16); }
  await touch('touchEnd'); await sleep(200);
  check('v6: no volume/brightness swipe (bridge untouched, no level HUD)',
    (await ev(`TizenTubeMobile.getVolume()`)) === vol0 && (await ev(`TizenTubeMobile.getBrightness()`)) === bri0 &&
    (await ev(`!document.getElementById('ttm-level') && !window.TTM.gestures`)));

  // Tap and double-tap still reach the "native" player handler (also near the edges:
  // the 32 px edge exclusion is gone and nothing of ours listens to 1-finger touches).
  await ev(`window.__nativeLogCount = document.querySelectorAll('#log div').length`);
  const tx = pr.l + pr.w * 0.8, ty = pr.t + pr.h * 0.5;
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(80);
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(400);
  const logs2 = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('native double-tap seek still works', /native double-tap seek \+10s/.test(logs2), logs2.split('\n').filter(l => /native/.test(l)).join(' | '));
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(500);
  const logs3 = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('native single tap still toggles controls', /native tap: toggle controls/.test(logs3));
  await ev(`window.__nativeLogCount = document.querySelectorAll('#log div').length`);
  const ex = pr.l + 10;  // inside the old 32 px edge strip
  await sleep(500);
  await touch('touchStart', ex, ty); await touch('touchEnd'); await sleep(80);
  await touch('touchStart', ex, ty); await touch('touchEnd'); await sleep(400);
  const logsE = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('double-tap at the left edge (old exclusion strip) reaches the page', /native double-tap seek -10s/.test(logsE), logsE.split('\n').filter(l => /native/.test(l)).join(' | '));

  // -------------------------------------------- v6: pinch toggles fit/fill
  async function pinch(cx, cy, d0, d1) {
    const pts = d => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
    for (let i = 1; i <= 8; i++) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / 8) }); await sleep(16); }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(150);
  }
  const fitInfo = () => ev(`(() => { const v = document.querySelector('#movie_player video'); const t = document.getElementById('ttm-mode-toast');
    return { fit: TTM.layout.fit, objectFit: getComputedStyle(v).objectFit, toast: t && t.classList.contains('ttm-show') ? t.textContent : null }; })()`);
  const f0 = await fitInfo();
  check('v6: default video framing is fit (object-fit: contain)', f0.fit === 'fit' && f0.objectFit === 'contain', JSON.stringify(f0));
  const pcx = pr.l + pr.w / 2, pcy = pr.t + pr.h / 2;
  await pinch(pcx, pcy, 80, 220);
  const f1 = await fitInfo();
  check('v6: pinch out → Phủ kín (cover) + toast', f1.fit === 'fill' && f1.objectFit === 'cover' && f1.toast === 'Phủ kín', JSON.stringify(f1));
  await sleep(1300);
  await pinch(pcx, pcy, 220, 80);
  const f2 = await fitInfo();
  check('v6: pinch in → Vừa khung (contain) + toast', f2.fit === 'fit' && f2.objectFit === 'contain' && f2.toast === 'Vừa khung', JSON.stringify(f2));
  await ev(`window.__nativeLogCount = document.querySelectorAll('#log div').length`);
  await sleep(1300);
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(80);
  await touch('touchStart', tx, ty); await touch('touchEnd'); await sleep(400);
  const logsP = await ev(`[...document.querySelectorAll('#log div')].slice(window.__nativeLogCount).map(d => d.textContent).join('\\n')`);
  check('double-tap seek still works after pinches', /native double-tap seek \+10s/.test(logsP));

  // ------------------------------------------ v6: visibility / focus spoof
  const vis = await ev(`(() => { let seen = 0; const f = () => seen++;
    document.addEventListener('visibilitychange', f); window.addEventListener('blur', f); window.addEventListener('pagehide', f);
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const r = { mode: TTM.settings.onLeave, hidden: document.hidden, state: document.visibilityState, hasFocus: document.hasFocus(), seen };
    document.removeEventListener('visibilitychange', f); window.removeEventListener('blur', f); window.removeEventListener('pagehide', f); return r; })()`);
  check('v6 audio mode: hidden=false, visible, hasFocus, page listeners blocked', vis.mode === 'audio' && vis.hidden === false &&
    vis.state === 'visible' && vis.hasFocus === true && vis.seen === 0, JSON.stringify(vis));
  const inputFocus = await ev(`(() => { const i = document.getElementById('search-input'); document.getElementById('search-bar').hidden = false;
    let n = 0; i.addEventListener('blur', () => n++, { once: true }); i.focus(); i.blur(); document.getElementById('search-bar').hidden = true; return n; })()`);
  check('element blur (inputs) still reaches the page', inputFocus === 1);
  await ev(`TTM.setSetting('onLeave', 'stop')`);
  const vis2 = await ev(`(() => { let seen = 0; const f = () => seen++; document.addEventListener('visibilitychange', f);
    document.dispatchEvent(new Event('visibilitychange')); document.removeEventListener('visibilitychange', f); return { seen, bridgeMode: TizenTubeMobile.getLeaveMode() }; })()`);
  check('v6 Dừng phát: no spoof (event reaches page); mode pushed to Java bridge', vis2.seen === 1 && vis2.bridgeMode === 'stop', JSON.stringify(vis2));
  await ev(`TTM.setSetting('onLeave', 'audio')`);
  check('playing state reported to Java bridge', (await ev(`(document.querySelector('#movie_player video').play().catch(()=>{}), new Promise(r => setTimeout(() => r(TizenTubeMobile.__playing), 1300)))`)) === true);

  // ---------------------------------------------------- v6: PiP from Java
  await ev(`TTM.player.showSkipToast({ category: 'sponsor' }, function () {})`);
  await ev(`(function(on){document.documentElement.classList.toggle('ttm-pip',on);window.dispatchEvent(new CustomEvent('tizentube-pip',{detail:{active:on}}));})(true)`);
  await sleep(300);
  const pip = await ev(`(() => { const d = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'absent'; };
    return { mode: TTM.layout.mode, toast: d('#ttm-skip-toast'), header: d('#header-bar'), pcc: d('#player-control-container'), entry: d('[data-ttm-entry]') }; })()`);
  check('v6 PiP: only video (fill), TizenTube overlays and header hidden', pip.mode === 'fill' && pip.toast === 'none' && pip.header === 'none', JSON.stringify(pip));
  await ev(`(function(on){document.documentElement.classList.toggle('ttm-pip',on);window.dispatchEvent(new CustomEvent('tizentube-pip',{detail:{active:on}}));})(false)`);
  await sleep(300);
  check('v6 PiP exit restores previous layout', (await ev(`!document.documentElement.classList.contains('ttm-pip') && getComputedStyle(document.getElementById('ttm-skip-toast')).display !== 'none'`)));

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
  check('sheet has Vietnamese toggles', ['Chặn quảng cáo', 'SponsorBlock', 'Tốc độ phát mặc định', 'Tài trợ', 'Khung video', 'Vừa khung', 'Phủ kín', 'Khi chuyển app', 'Chỉ phát âm thanh', 'Cửa sổ nổi (PiP)', 'Dừng phát'].every(s => sheetText.includes(s)));
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
  check('wide (915×412, 2.22:1) auto-fill: player covers viewport, header hidden, video contain',
    (fill.mode === 'fill' || fill.mode === 'real') && fill.cls && fill.header === 'none' && fill.r[0] === 0 && fill.r[1] === 0 &&
    fill.r[2] === fill.vw && fill.r[3] === fill.vh && fill.v[2] === fill.vw && fill.v[3] === fill.vh && fill.fit === 'contain', JSON.stringify(fill));
  // Aspect gate: resize to a near-square car pane, then wide again, in one page session.
  const modeAt = async (w, h) => { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1.5, mobile: true }); await sleep(900); return ev(`TTM.layout.mode + ' ' + TTM.layout.aspect().toFixed(2)`); };
  const mPane = await modeAt(507, 480), mWide = await modeAt(1280, 480), mPane2 = await modeAt(600, 480);
  check('aspect gate: pane 507×480 → normal layout, 1280×480 → fill, 600×480 → normal (no reload)',
    mPane.startsWith('off') && mWide.startsWith('fill') && mPane2.startsWith('off') && (await ev(`!!window.TTM`)), [mPane, mWide, mPane2].join(' | '));
  const mBorder = await modeAt(760, 480);  // 1.58: inside the hysteresis band, stays off
  check('aspect hysteresis: 760×480 (1.58) stays normal after a narrow pane', mBorder.startsWith('off'), mBorder);
  await send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2.6, mobile: true }); await sleep(900);
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
  const infoLine = await ev(`(() => { const i = document.querySelector('#ttm-sheet .ttm-info'); return i && i.textContent; })()`);
  check('v6: sheet info line "DPR … · màn …×… · khung …×…"', /^DPR [\d.]+ · màn \d+×\d+ · khung \d+×\d+$/.test(infoLine || ''), infoLine);
  const radios = await ev(`[...document.querySelectorAll('#ttm-sheet fieldset[data-ttm-setting=onLeave] input')].map(i => i.value + (i.checked ? '*' : ''))`);
  check('v6: "Khi chuyển app" has 3 options, Chỉ phát âm thanh checked', JSON.stringify(radios) === JSON.stringify(['audio*', 'pip', 'stop']), JSON.stringify(radios));
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

  // ------------------------------------------------------------- v7 checks
  const codec = await ev(`(() => { const its = t => MediaSource.isTypeSupported(t);
    const r = { av1: its('video/mp4; codecs="av01.0.05M.08"'), vp9: its('video/webm; codecs="vp9"'), avc: its('video/mp4; codecs="avc1.4d401f"'),
      uhd: its('video/webm; codecs="vp9"; width=3840; height=2160'), hfr: its('video/mp4; codecs="avc1.4d401f"; framerate=120'),
      audio: its('audio/webm; codecs="opus"'), cptAv1: document.createElement('video').canPlayType('video/mp4; codecs="av01.0.05M.08"') };
    return r; })()`);
  check('v7 codec gate (auto): av01 ✗, 2160p ✗, 120fps ✗, vp9/avc1/opus ✓', !codec.av1 && !codec.uhd && !codec.hfr && codec.vp9 && codec.avc && codec.audio && codec.cptAv1 === '', JSON.stringify(codec));
  const dec = await ev(`Promise.all([navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType: 'video/mp4; codecs="av01.0.08M.08"', width: 1920, height: 1080, bitrate: 2e6, framerate: 30 } }),
    navigator.mediaCapabilities.decodingInfo({ type: 'media-source', video: { contentType: 'video/mp4; codecs="avc1.640028"', width: 3840, height: 2160, bitrate: 2e7, framerate: 30 } })]).then(r => r.map(x => x.supported))`);
  check('v7 decodingInfo: av1 / 2160p unsupported', dec[0] === false && dec[1] === false, JSON.stringify(dec));
  await ev(`TTM.setSetting('codec', 'h264')`);
  const h264 = await ev(`({ vp9: MediaSource.isTypeSupported('video/webm; codecs="vp9"'), vp8: MediaSource.isTypeSupported('video/webm; codecs="vp8"'), avc: MediaSource.isTypeSupported('video/mp4; codecs="avc1.4d401f"') })`);
  check('v7 codec "Ưu tiên H.264": vp9/vp8 ✗, avc1 ✓', !h264.vp9 && !h264.vp8 && h264.avc, JSON.stringify(h264));
  await ev(`TTM.setSetting('codec', 'auto')`);
  check('v7 codec auto + bridge hasHardwareDecoder(vp9)=true (harness stub): vp9 allowed', (await ev(`MediaSource.isTypeSupported('video/webm; codecs="vp9"')`)) === true);
  const light = await ev(`(() => { const e = document.querySelector('.mock-controls button') || document.body; const c = getComputedStyle(e);
    return { cls: document.documentElement.classList.contains('ttm-light'), tr: c.transitionDuration, an: c.animationDuration, sh: c.boxShadow, bf: c.backdropFilter }; })()`);
  check('v7 light CSS: transitions/animations ~0, no box-shadow/backdrop-filter', light.cls && parseFloat(light.tr) <= 0.001 && parseFloat(light.an) <= 0.001 && light.sh === 'none' && (light.bf === 'none' || !light.bf), JSON.stringify(light));
  // Inline preview guard: a feed preview video outside the player must not play.
  const prev = await ev(`(async () => { const tile = document.querySelector('ytm-rich-item-renderer'); const v = document.createElement('video');
    v.muted = true; v.src = document.querySelector('#movie_player video').currentSrc || ''; tile.appendChild(v);
    let err = null; try { await v.play(); } catch (e) { err = e.name; } await new Promise(r => setTimeout(r, 300));
    const r = { err, paused: v.paused, blocked: TTM.light.stats.blockedPlays }; v.remove(); return r; })()`);
  check('v7 inline preview <video> outside the watch player cannot play', prev.err === 'NotAllowedError' && prev.paused, JSON.stringify(prev));
  // Command channel + metadata hook + bridge reports.
  const cmd = await ev(`(async () => { const v = document.querySelector('#movie_player video'); await v.play().catch(()=>{}); await new Promise(r => setTimeout(r, 300));
    const t0 = v.currentTime; window.dispatchEvent(new CustomEvent('ttm-cmd', { detail: 'seek+10' })); await new Promise(r => setTimeout(r, 300));
    const t1 = v.currentTime; window.dispatchEvent(new CustomEvent('ttm-cmd', { detail: 'seek-10' })); await new Promise(r => setTimeout(r, 300));
    const t2 = v.currentTime; window.dispatchEvent(new CustomEvent('ttm-cmd', { detail: 'toggle' })); await new Promise(r => setTimeout(r, 300));
    const paused = v.paused; window.dispatchEvent(new CustomEvent('ttm-cmd', { detail: 'toggle' })); await new Promise(r => setTimeout(r, 300));
    return { fwd: +(t1 - t0).toFixed(1), back: +(t2 - t1).toFixed(1), pausedAfterToggle: paused, playingAfter2nd: !v.paused, log: TTM.background.cmdLog.slice(-4) }; })()`);
  check('v7 ttm-cmd: seek±10, toggle pause/play', cmd.fwd >= 9 && cmd.back <= -9 && cmd.pausedAfterToggle && cmd.playingAfter2nd, JSON.stringify(cmd));
  const meta = await ev(`(() => { if (!navigator.mediaSession) return 'n/a'; navigator.mediaSession.metadata = new MediaMetadata({ title: 'T', artist: 'A', artwork: [{ src: 'https://x/a.png', sizes: '320x180' }] });
    return TizenTubeMobile.__meta; })()`);
  check('v7 mediaSession.metadata setter hooked → bridge.setMetadata', meta && meta.title === 'T' && meta.artist === 'A' && meta.artwork === 'https://x/a.png', JSON.stringify(meta));
  const rep = await ev(`new Promise(r => setTimeout(() => r({ watch: TizenTubeMobile.__watch, rect: TizenTubeMobile.__rect }), 1200))`);
  check('v7 bridge: setWatchPage(true) + setPlayerRect(x,y,w,h,dpr)', rep.watch === true && rep.rect && rep.rect[2] > 0 && rep.rect[3] > 0 && rep.rect[4] > 0, JSON.stringify(rep));

  // ------------------------------------------------------------- v7b checks
  await send('Emulation.setDeviceMetricsOverride', { width: 507, height: 480, deviceScaleFactor: 1.5, mobile: true }); await sleep(1200);
  await ev(`TTM.setSetting('quality', 'auto')`); await sleep(600);
  const qPane = await ev(`({ mode: TTM.layout.mode, range: window.__harnessQuality.range })`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 480, deviceScaleFactor: 1.5, mobile: true }); await sleep(1200);
  // Earlier checks pressed Back to leave fill (opt-out for this video); start a fresh one.
  await ev(`(() => { TTM.layout.state.optedOut = false; const v = document.querySelector('#movie_player video'); v.pause(); return v.play().catch(()=>{}); })()`); await sleep(1500);
  const qWide = await ev(`({ mode: TTM.layout.mode, range: window.__harnessQuality.range })`);
  // 507×480@1.5: player ≈ 285 CSS px → 428 physical → 480p; 1280×480@1.5 fill: 720 physical → 720p (cap 1080).
  check('v7b quality auto: pane → large (480p, cap 720), wide fill → hd720 (cap 1080)', JSON.stringify(qPane.range) === '["large","large"]' && qWide.mode === 'fill' && JSON.stringify(qWide.range) === '["hd720","hd720"]', JSON.stringify({ qPane, qWide }));
  await ev(`TTM.setSetting('quality', '480')`); await sleep(300);
  check('v7b quality 480p fixed → large..large', (await ev(`JSON.stringify(window.__harnessQuality.range)`)) === '["large","large"]');
  await ev(`TTM.setSetting('quality', 'auto')`);
  await send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2.6, mobile: true }); await sleep(900);
  const lazy = await ev(`(() => { const imgs = [...document.querySelectorAll('img')]; return { n: imgs.length, lazy: imgs.filter(i => i.loading === 'lazy' && i.decoding === 'async').length }; })()`);
  check('v7b all <img> loading=lazy decoding=async', lazy.n > 0 && lazy.n === lazy.lazy, JSON.stringify(lazy));
  const rel = await ev(`(() => { const items = [...document.querySelectorAll('#mock-related ytm-video-with-context-renderer')]; const vis = items.filter(e => getComputedStyle(e).display !== 'none').length;
    const more = document.querySelector('#mock-related .ttm-more'); const cont = getComputedStyle(document.querySelector('#mock-related ytm-continuation-item-renderer')).display;
    return { total: items.length, visible: vis, more: !!more && getComputedStyle(more).display !== 'none', moreH: more && more.getBoundingClientRect().height, cont }; })()`);
  check('v7b related list capped at 8, continuation hidden, "Xem thêm" ≥48px', rel.visible === 8 && rel.more && rel.moreH >= 48 && rel.cont === 'none', JSON.stringify(rel));
  await ev(`document.querySelector('#mock-related .ttm-more').click()`); await sleep(300);
  check('v7b "Xem thêm" shows all items', (await ev(`[...document.querySelectorAll('#mock-related ytm-video-with-context-renderer')].filter(e => getComputedStyle(e).display !== 'none').length`)) === 12);

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
