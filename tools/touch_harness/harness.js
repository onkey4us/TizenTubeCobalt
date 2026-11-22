// TizenTube mobile harness: mock m.youtube.com page behaviour.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var logEl = $('log');

  window.harnessLog = function (msg, cls) {
    var d = document.createElement('div');
    d.className = cls || 'page';
    d.textContent = new Date().toISOString().slice(11, 23) + '  ' + msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  };
  (window.__harnessEarlyLog || []).forEach(function (m) { window.harnessLog(m, 'tt'); });
  if (window.__harnessModuleError) window.harnessLog(window.__harnessModuleError, 'err');
  else window.harnessLog('modules loaded from ' + window.__harnessModuleBase, 'page');
  if (!window.TTM) window.harnessLog('window.TTM missing: userscript did not initialise', 'err');

  // ------------------------------------------------------------ mock video
  // 60 s of silent 8 kHz mono WAV: a real <video> with working duration/currentTime/playbackRate.
  function silentWav(seconds) {
    var rate = 8000, n = rate * seconds, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    new Uint8Array(buf, 44).fill(128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  var mainSrc = silentWav(60), adSrc = silentWav(15);
  var player = $('movie_player');
  var video = player.querySelector('video');
  video.src = mainSrc;

  var canvas = $('frame'), ctx = canvas.getContext('2d');
  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + ('0' + t % 60).slice(-2); }
  function draw() {
    var ad = player.classList.contains('ad-showing');
    ctx.fillStyle = ad ? '#5a3a00' : '#123';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText((ad ? 'QUẢNG CÁO ' : 'VIDEO ') + fmt(video.currentTime), 320, 170);
    ctx.font = '20px monospace';
    ctx.fillText('v=' + new URLSearchParams(location.search).get('v') + '  ×' + video.playbackRate, 320, 210);
    $('time').textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    $('rate').textContent = '×' + video.playbackRate;
    $('progress-fill').style.width = (video.duration ? 100 * video.currentTime / video.duration : 0) + '%';
    if (ad) $('ad-left').textContent = fmt(video.duration - video.currentTime);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  function drawSegments() {
    var marks = $('sb-marks');
    while (marks.firstChild) marks.removeChild(marks.firstChild);
    var segs = window.__harnessSegments[new URLSearchParams(location.search).get('v')] || [];
    segs.forEach(function (s) {
      var i = document.createElement('i');
      i.style.left = (100 * s.segment[0] / 60) + '%';
      i.style.width = (100 * (s.segment[1] - s.segment[0]) / 60) + '%';
      i.title = s.category;
      marks.appendChild(i);
    });
  }
  drawSegments();

  // ------------------------------------------------ "native" player taps
  // Stand-in for YouTube's own tap / double-tap handling, so we can see that
  // our vertical swipes do not trigger it.
  var lastTap = 0, tapTimer = 0, controlsTimer = 0, touchStart = null;
  function showControls() {
    player.classList.remove('controls-hidden');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(function () { player.classList.add('controls-hidden'); }, 3000);
  }
  player.addEventListener('touchstart', function (e) {
    var t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  player.addEventListener('touchend', function (e) {
    if (!touchStart || e.target.closest('[data-ttm-no-gesture]')) return;
    var t = e.changedTouches[0];
    var moved = Math.hypot(t.clientX - touchStart.x, t.clientY - touchStart.y);
    touchStart = null;
    if (moved > 10) { window.harnessLog('native: swipe/scroll seen by page (' + Math.round(moved) + 'px)'); return; }
    var now = Date.now(), rect = player.getBoundingClientRect();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer);
      var left = t.clientX < rect.left + rect.width / 2;
      video.currentTime += left ? -10 : 10;
      window.harnessLog('native double-tap seek ' + (left ? '-10s' : '+10s'));
      lastTap = 0;
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(function () {
      window.harnessLog('native tap: toggle controls');
      if (player.classList.contains('controls-hidden')) showControls(); else player.classList.add('controls-hidden');
    }, 300);
  });
  showControls();

  $('play-btn').addEventListener('click', function () {
    if (video.paused) video.play().catch(function (e) { window.harnessLog('play() failed: ' + e, 'err'); });
    else video.pause();
  });
  $('fs-btn').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else player.requestFullscreen().catch(function (e) { window.harnessLog('fullscreen: ' + e, 'err'); });
  });

  // ------------------------------------------------------------ mock ads
  var adActive = false, mainTime = 0;
  $('btn-ad').addEventListener('click', function () {
    if (adActive) return;
    adActive = true;
    mainTime = video.currentTime;
    player.classList.add('ad-showing');
    video.src = adSrc;
    video.play().catch(function () {});
    window.harnessLog('page: ad break started (15 s, Skip button after 2 s)');
    setTimeout(function () {
      if (!adActive) return;
      var skip = document.createElement('button');
      skip.className = 'ytp-ad-skip-button-modern';
      skip.textContent = 'Bỏ qua ›';
      skip.addEventListener('click', endAd);
      player.appendChild(skip);
    }, 2000);
  });
  function endAd() {
    if (!adActive) return;
    adActive = false;
    player.classList.remove('ad-showing');
    var skip = player.querySelector('.ytp-ad-skip-button-modern');
    if (skip) skip.remove();
    video.src = mainSrc;
    video.addEventListener('loadedmetadata', function once() {
      video.removeEventListener('loadedmetadata', once);
      video.currentTime = mainTime;
      video.play().catch(function () {});
    });
    window.harnessLog('page: ad break ended, muted=' + video.muted);
  }
  video.addEventListener('ended', function () { if (adActive) endAd(); });

  $('btn-json').addEventListener('click', function () {
    var raw = JSON.stringify({
      responseContext: {}, playabilityStatus: { status: 'OK' },
      adPlacements: [{ adPlacementRenderer: {} }], playerAds: [{}],
      contents: { items: [{ videoRenderer: { id: 1 } }, { adSlotRenderer: {} },
        { richItemRenderer: { content: { promotedSparklesWebRenderer: {} } } }, { videoRenderer: { id: 2 } }] }
    });
    var parsed = JSON.parse(raw);
    var ok = !parsed.adPlacements && !parsed.playerAds && parsed.contents.items.length === 2;
    window.harnessLog('JSON.parse ad filter: ' + (ok ? 'OK' : 'FAILED') + ' → ' + JSON.stringify(parsed),
      ok ? 'page' : 'err');
  });

  // ------------------------------------------------- mock account menu
  var menu = null;
  $('avatar-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    if (menu) { menu.remove(); menu = null; return; }
    menu = document.createElement('ytm-multi-page-menu-renderer');
    document.body.appendChild(menu);
    // Content arrives a bit later, like YouTube's lazy render.
    setTimeout(function () {
      ['Kênh của bạn', 'Chuyển đổi tài khoản', 'Cài đặt', 'Trợ giúp và phản hồi'].forEach(function (t) {
        var row = document.createElement('ytm-compact-link-renderer');
        row.textContent = t;
        menu && menu.appendChild(row);
      });
    }, 120);
  });
  document.addEventListener('click', function (e) {
    if (menu && !menu.contains(e.target)) { menu.remove(); menu = null; }
  });
  // Fallback location: player overflow bottom sheet (only used when no account menu is open).
  var sheet = null;
  $('overflow-btn').addEventListener('click', function (e) {
    e.stopPropagation();
    if (sheet) { sheet.remove(); sheet = null; return; }
    sheet = document.createElement('ytm-bottom-sheet-renderer');
    ['Chất lượng', 'Phụ đề', 'Tốc độ phát'].forEach(function (t) {
      var row = document.createElement('ytm-menu-service-item-renderer');
      row.textContent = t;
      sheet.appendChild(row);
    });
    (document.fullscreenElement || document.body).appendChild(sheet);
  });
  document.addEventListener('click', function (e) {
    if (sheet && !sheet.contains(e.target) && e.target.id !== 'overflow-btn') { sheet.remove(); sheet = null; }
  });

  $('search-btn').addEventListener('click', function () {
    $('search-bar').hidden = !$('search-bar').hidden;
    if (!$('search-bar').hidden) $('search-input').focus();
  });

  // ------------------------------------------------ bridge / levels
  var dim = $('dim');
  window.harnessBridgeChanged = function (st) {
    $('lv-vol').textContent = Math.round(st.volume * 100) + '%';
    $('lv-bri').textContent = Math.round(st.brightness * 100) + '%';
    dim.style.opacity = String(0.85 * (1 - st.brightness));
    window.harnessLog('bridge: volume=' + st.volume.toFixed(2) + ' brightness=' + st.brightness.toFixed(2), 'bridge');
  };
  $('opt-bridge').addEventListener('change', function () {
    if (this.checked) { window.TizenTubeMobile = window.__harnessMockBridge; dim.style.display = ''; }
    else { delete window.TizenTubeMobile; dim.style.display = 'none'; }
    window.harnessLog('mock bridge ' + (this.checked ? 'on' : 'off (fallback: video.volume + CSS filter)'));
  });
  $('opt-real-sb').addEventListener('change', function () {
    window.__harnessUseRealSponsorBlock = this.checked;
    window.harnessLog('SponsorBlock: ' + (this.checked ? 'real API' : 'mock segments') + ' (applies to next video)');
  });
  video.addEventListener('volumechange', function () {
    if (!window.TizenTubeMobile) $('lv-vol').textContent = Math.round(video.volume * 100) + '% (video)';
  });

  // ------------------------------------------------------- misc buttons
  var ids = ['dQw4w9WgXcQ', 'jNQXAC9IVRw'];
  $('btn-next').addEventListener('click', function () {
    var cur = new URLSearchParams(location.search).get('v');
    var next = ids[(ids.indexOf(cur) + 1) % ids.length];
    history.pushState(null, '', location.pathname + '?v=' + next);
    video.src = mainSrc;
    video.play().catch(function () {});
    drawSegments();
    window.harnessLog('page: SPA navigation to v=' + next);
  });
  $('btn-back').addEventListener('click', function () {
    // Same logic as CobaltActivity.handleMobileBack().
    var consumed = typeof window.__tizentubeMobileHandleBack === 'function' && window.__tizentubeMobileHandleBack();
    if (consumed) { window.harnessLog('Back: consumed by TizenTube overlay'); return; }
    if (document.fullscreenElement) { document.exitFullscreen(); window.harnessLog('Back: exit fullscreen'); return; }
    window.harnessLog('Back: history.back()');
    history.back();
  });
  window.addEventListener('popstate', function () {
    video.src = mainSrc;
    drawSegments();
    window.harnessLog('page: popstate → v=' + new URLSearchParams(location.search).get('v'));
  });
  $('btn-seek').addEventListener('click', function () {
    video.currentTime = 4;
    if (video.paused) video.play().catch(function () {});
  });
  $('btn-reset').addEventListener('click', function () {
    localStorage.removeItem('tizentube_mobile_settings_v1');
    window.harnessLog('settings cleared; reload the page');
  });

  if (window.TizenTubeMobile) window.harnessBridgeChanged({
    volume: window.TizenTubeMobile.getVolume(), brightness: window.TizenTubeMobile.getBrightness() });
})();
