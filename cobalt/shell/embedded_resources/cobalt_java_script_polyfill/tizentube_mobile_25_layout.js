/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 25: layout.
 *
 * 1. Wide-window auto fill (v6: aspect-gated, not "landscape"). When a watch-page
 *    video plays and the window is WIDE (innerWidth/innerHeight > FILL_ASPECT_ENTER,
 *    1.6 ≈ 16:10), <html>.ttm-fill pins #player-container-id over the viewport and
 *    hides the YouTube header. In a near-square pane (the car launcher's middle
 *    split pane, ~1:1 .. 1.3:1) m.youtube.com's normal watch layout is kept (video
 *    on top, title and related list below/beside). Re-evaluated on resize /
 *    orientationchange (debounced, hysteresis ENTER 1.6 / EXIT 1.5) without reload.
 *    A pinch on the video in the normal layout enters fill manually.
 *
 * 2. Video framing (v6): default 'fit' = object-fit: contain (whole frame, black
 *    bars); 'fill' = cover. Setting "Khung video"; a two-finger pinch on the player
 *    toggles it (pinch out -> Phủ kín, pinch in -> Vừa khung) with a short toast.
 *    Only touches with 2 fingers are looked at, so single taps and YouTube's native
 *    double-tap ±10 s seek are untouched (nothing of ours listens to 1-finger touches
 *    on the player any more; the v5 volume/brightness swipes are removed).
 *
 * 3. Picture-in-picture: CobaltActivity.onPictureInPictureModeChanged() sets
 *    <html>.ttm-pip and dispatches a 'tizentube-pip' CustomEvent; we then show only
 *    the video (fill layout, no header, no TizenTube overlays) and restore on exit.
 *
 *    The browser Fullscreen API is NOT used (USE_FULLSCREEN_API).
 *    Tested on the real m.youtube.com: in every true/faux fullscreen layout
 *    (requestFullscreen on the container or on <html>, and YouTube's own
 *    body[faux-fullscreen]) YouTube stretches #player-control-container over
 *    the player and its native double-tap ±10 s seek stops working. The app
 *    already hides the Android status/navigation bars itself (immersive mode
 *    in CobaltActivity), so CSS fill gives the same picture.
 *    Layout rules learned on the real site (do not "simplify"):
 *     - Only the outer #player-container-id is pinned. #player / #movie_player
 *       stay in normal flow with explicit sizes: making #player absolute pulls
 *       the in-flow #player-control-container (YouTube's tap / double-tap seek
 *       surface) to the top and native double-tap seek stops working.
 *     - Fullscreen the document, never #player-container-id: YouTube's own
 *       :fullscreen rules for the container collapse the control container to
 *       0 px height, which also kills double-tap seek.
 *    Back (or leaving fullscreen) exits and opts this video out until the next
 *    one. Registered before the settings sheet, so Back closes the sheet first.
 *
 * 4. Hide "Mở ứng dụng" / "Open App" in the header and other open-in-app
 *    prompts (mealbar / upsell promos). Always on: inside the app it is useless.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.layout) return;

  var FILL_CLASS = 'ttm-fill';
  var COVER_CLASS = 'ttm-fill-cover';  // <html> class: video object-fit cover ("Phủ kín").
  var PIP_CLASS = 'ttm-pip';
  var CONFIG = TTM.CONFIG, S = TTM.STRINGS;
  var Z_PLAYER = 2147483000;  // Below our toast/indicator/sheet (2147483646+).
  // See header: true/faux fullscreen breaks YouTube's native double-tap seek.
  var USE_FULLSCREEN_API = false;

  TTM.addStyle([
    // ------------------------------------------------------------ fill mode
    'html.' + FILL_CLASS + ',html.' + FILL_CLASS + ' body{overflow:hidden!important}',
    'html.' + FILL_CLASS + ' ytm-mobile-topbar-renderer,html.' + FILL_CLASS + ' #header-bar,',
    'html.' + FILL_CLASS + ' ytm-pivot-bar-renderer{display:none!important}',
    'html.' + FILL_CLASS + ' #player-container-id{position:fixed!important;inset:0!important;',
    'width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;',
    'margin:0!important;padding:0!important;transform:none!important;z-index:' + Z_PLAYER + '!important;',
    'background:#000!important}',
    // In-flow sizing only (see header comment).
    'html.' + FILL_CLASS + ' #player-container-id #player,',
    'html.' + FILL_CLASS + ' #player-container-id #player-cinematics-container{',
    'width:100vw!important;height:100vh!important;height:100dvh!important;max-height:none!important;',
    'padding:0!important;margin:0!important}',
    'html.' + FILL_CLASS + ' #player-container-id #movie_player{width:100%!important;height:100%!important}',
    'html.' + FILL_CLASS + ' #player-container-id .html5-video-container{width:100%!important;',
    'height:100%!important}',
    'html.' + FILL_CLASS + ' #player-container-id video{left:0!important;top:0!important;',
    'width:100%!important;height:100%!important}',
    // Framing applies in BOTH layouts (normal watch page and fill): contain by default.
    'html #player-container-id video{object-fit:contain!important}',
    'html.' + COVER_CLASS + ' #player-container-id video{object-fit:cover!important}',
    // Picture-in-picture: only the video (fill layout), none of our overlays.
    'html.' + PIP_CLASS + ' #ttm-skip-toast,html.' + PIP_CLASS + ' #ttm-sheet-backdrop,',
    'html.' + PIP_CLASS + ' #ttm-mode-toast,html.' + PIP_CLASS + ' .ttm-entry{display:none!important}',
    'html.' + PIP_CLASS + ' #player-control-container,html.' + PIP_CLASS + ' .ytp-chrome-top,',
    'html.' + PIP_CLASS + ' .ytp-chrome-bottom,html.' + PIP_CLASS + ' .ytp-unmute{display:none!important}',
    // Fit/fill mode toast (pinch).
    '#ttm-mode-toast{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483646;',
    'padding:10px 18px;border-radius:20px;background:rgba(0,0,0,.85);color:#fff;',
    'font:500 15px/1.3 Roboto,Arial,sans-serif;pointer-events:none;opacity:0;transition:opacity .2s}',
    '#ttm-mode-toast.ttm-show{opacity:1;transition:none}',
    'html.' + FILL_CLASS + ':fullscreen{background:#000}',
    // Never let YouTube's own faux-fullscreen layout kick in under fill (it moves
    // #player-control-container over the video, see header).
    'html.' + FILL_CLASS + ' body[faux-fullscreen] #player-control-container{position:static!important;',
    'height:0!important;inset:auto!important}',
    // ------------------------------------------------------- open-in-app
    '.ttm-app-promo,ytm-mealbar-promo-renderer,ytm-app-promo-renderer,ytm-upsell-dialog-renderer,',
    'ytm-open-app-promo-renderer,.mealbar-promo-renderer,.open-app-button{display:none!important}'
  ].join(''));

  // ------------------------------------------------------------ open-in-app
  var APP_TEXT = /^(Mở ứng dụng|Mở trong ứng dụng|Open App|Open in app|Open the app|Get the app|Tải ứng dụng)$/i;
  var APP_HREF = /(^intent:|^vnd\.youtube:|youtube\.app\.goo\.gl|app=desktop.*open|\/app_install|play\.google\.com\/store\/apps\/details\?id=com\.google\.android\.youtube)/i;
  var PROMO_SCOPE = 'ytm-mobile-topbar-renderer, header, ytm-mealbar-promo-renderer, ytm-promoted-item-renderer,' +
    ' ytm-statement-banner-renderer, ytm-single-column-watch-next-results-renderer';

  function hideAppPromos() {
    var hidden = 0;
    document.querySelectorAll(PROMO_SCOPE).forEach(function (scope) {
      scope.querySelectorAll('a, button, [role="button"]').forEach(function (el) {
        if (el.closest('.ttm-app-promo')) return;
        var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        var label = (el.getAttribute('aria-label') || '').trim();
        var href = el.getAttribute('href') || '';
        if (!APP_TEXT.test(text) && !APP_TEXT.test(label) && !APP_HREF.test(href)) return;
        // Hide the renderer that wraps the button, not the whole header.
        var box = el.closest('ytm-button-renderer, ytm-mealbar-promo-renderer, ytm-promoted-item-renderer') || el;
        box.classList.add('ttm-app-promo');
        hidden++;
      });
    });
    if (hidden) TTM.log('layout: hid ' + hidden + ' open-in-app prompt(s)');
    return hidden;
  }

  // ---------------------------------------------------------------- fill
  var state = { mode: 'off', videoId: null, optedOut: false, pendingReal: false, manual: false,
    fit: TTM.settings.videoFit, wide: null, pip: false };

  function container() { return document.getElementById('player-container-id'); }
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function aspect() { return innerHeight > 0 ? innerWidth / innerHeight : 0; }
  // Hysteresis: enter above FILL_ASPECT_ENTER, leave below FILL_ASPECT_EXIT.
  function isWide() {
    var a = aspect();
    if (state.wide === null) state.wide = a > CONFIG.FILL_ASPECT_ENTER;
    else if (state.wide && a < CONFIG.FILL_ASPECT_EXIT) state.wide = false;
    else if (!state.wide && a > CONFIG.FILL_ASPECT_ENTER) state.wide = true;
    return state.wide;
  }
  function videoId() { return TTM.player ? TTM.player.currentVideoId() : null; }
  function playingVideo() {
    var v = TTM.player && TTM.player.getVideo();
    return v && !v.paused && !v.ended ? v : null;
  }

  function nudgeLayout() {
    // YouTube re-measures the player on resize.
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 300);
  }

  // Document-start scripts run before <html> exists (see TTM.addStyle): wait for it.
  function whenRoot(fn) {
    if (document.documentElement) { fn(); return; }
    var mo = new MutationObserver(function () {
      if (!document.documentElement) return;
      mo.disconnect();
      fn();
    });
    mo.observe(document, { childList: true });
  }

  function applyFitClass() {
    if (!document.documentElement) return;
    document.documentElement.classList.toggle(COVER_CLASS, state.fit === 'fill');
  }

  function fsTarget() { return document.documentElement; }

  function requestReal() {
    if (!USE_FULLSCREEN_API) return;
    var c = fsTarget();
    if (!container() || fsElement()) return;
    var req = c.requestFullscreen || c.webkitRequestFullscreen;
    if (!req) return;
    try {
      var p = req.call(c, { navigationUI: 'hide' });
      state.pendingReal = true;
      if (p && p.then) {
        p.then(function () {
          state.pendingReal = false;
          if (state.mode !== 'off') state.mode = 'real';
          TTM.log('layout: real fullscreen');
          nudgeLayout();
        }, function (e) {
          state.pendingReal = false;
          TTM.log('layout: requestFullscreen rejected (' + (e && e.name) + '), CSS fill kept');
        });
      }
    } catch (e) {
      state.pendingReal = false;
    }
  }

  function enter(reason, manual) {
    if (!container()) return;
    applyFitClass();
    if (manual) state.manual = true;
    if (state.mode === 'off') {
      document.documentElement.classList.add(FILL_CLASS);
      state.mode = 'fill';
      window.scrollTo(0, 0);
      TTM.log('layout: fill on (' + reason + ', aspect ' + aspect().toFixed(2) + ')');
      nudgeLayout();
    }
    requestReal();
  }

  function exit(reason, optOut) {
    if (state.mode === 'off') return false;
    state.mode = 'off';
    state.manual = false;
    if (optOut) state.optedOut = true;
    document.documentElement.classList.remove(FILL_CLASS);
    if (fsElement() && fsElement() === fsTarget()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    }
    TTM.log('layout: fill off (' + reason + ')');
    nudgeLayout();
    return true;
  }

  function maybeEnter(reason) {
    if (!TTM.settings.autoFullscreen || state.optedOut || !isWide() || !videoId()) return;
    if (state.mode === 'off') enter(reason, false);
  }

  // A watch-page video started playing.
  document.addEventListener('playing', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || !v.closest || !v.closest('#player-container-id')) return;
    maybeEnter('playing');
  }, true);

  // Leaving real fullscreen means the user wants out: drop fill as well.
  function onFsChange() {
    var f = fsElement();
    if (f && f === fsTarget()) {
      if (state.mode === 'off') { document.documentElement.classList.add(FILL_CLASS); applyFitClass(); }
      state.mode = 'real';
    } else if (!f && state.mode === 'real') {
      exit('fullscreen exited', true);
    }
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  // Window size changes: split-screen pane resize, multi-window on/off, rotation.
  // Debounced; auto fill follows the aspect gate, manual (pinch) fill is kept.
  var resizeTimer = 0;
  function onResize(e) {
    if (e && e.isTrusted === false) return;  // our own nudgeLayout() resize events
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      var wide = isWide();
      if (state.pip) return;
      if (!wide && state.mode === 'fill' && !state.manual) exit('narrow window ' + aspect().toFixed(2), false);
      else if (wide && state.mode === 'off' && playingVideo()) maybeEnter('wide window ' + aspect().toFixed(2));
    }, CONFIG.RESIZE_DEBOUNCE_MS);
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // ------------------------------------------------------------ fit / fill
  var modeToast = null, modeToastTimer = 0;
  function showModeToast(text) {
    if (!modeToast) modeToast = TTM.el('div', { id: 'ttm-mode-toast', role: 'status' });
    var parent = TTM.overlayParent();
    if (modeToast.parentNode !== parent) parent.appendChild(modeToast);
    modeToast.textContent = text;
    modeToast.classList.add('ttm-show');
    clearTimeout(modeToastTimer);
    modeToastTimer = setTimeout(function () { modeToast.classList.remove('ttm-show'); }, CONFIG.MODE_TOAST_MS);
  }
  function setFit(fit, reason) {
    if (TTM.ENUMS.videoFit.indexOf(fit) < 0) return;
    state.fit = fit;
    applyFitClass();
    TTM.log('layout: video ' + fit + ' (' + reason + ')');
  }

  // Two-finger pinch on the player. Only multi-touch is inspected; 1-finger
  // touches pass through untouched (taps, YouTube double-tap seek, scrolling).
  var pinch = null;
  function dist(t) {
    var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function onPinchStart(e) {
    if (e.touches.length !== 2) { if (e.touches.length > 2) pinch = null; return; }
    var c = container();
    if (!c || !videoId() || !c.contains(e.target)) return;
    pinch = { d0: dist(e.touches), done: false };
  }
  function onPinchMove(e) {
    if (!pinch || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();  // no page zoom while pinching the video
    if (pinch.done) return;
    var d = dist(e.touches), r = d / pinch.d0;
    if (Math.abs(d - pinch.d0) < CONFIG.PINCH_MIN_PX) return;
    if (r >= CONFIG.PINCH_RATIO) {
      pinch.done = true;
      // Pinch out in the normal watch layout first goes full-window.
      if (state.mode === 'off') enter('pinch', true);
      setFit('fill', 'pinch out');
      showModeToast(S.videoFitOptions.fill);
    } else if (r <= 1 / CONFIG.PINCH_RATIO) {
      pinch.done = true;
      setFit('fit', 'pinch in');
      showModeToast(S.videoFitOptions.fit);
    }
  }
  function onPinchEnd(e) { if (pinch && e.touches.length < 2) pinch = null; }
  window.addEventListener('touchstart', onPinchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', onPinchMove, { capture: true, passive: false });
  window.addEventListener('touchend', onPinchEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', onPinchEnd, { capture: true, passive: true });

  // ---------------------------------------------------------- PiP (native)
  // CobaltActivity.onPictureInPictureModeChanged() evaluates
  //   document.documentElement.classList.toggle('ttm-pip', on);
  //   window.dispatchEvent(new CustomEvent('tizentube-pip', {detail: {active: on}}))
  var preState = null;
  function setPip(on) {
    on = !!on;
    if (on === state.pip) return;
    state.pip = on;
    document.documentElement.classList.toggle(PIP_CLASS, on);
    if (on) {
      preState = { mode: state.mode, manual: state.manual };
      if (state.mode === 'off') enter('pip', true);
      if (TTM.settingsUi) TTM.settingsUi.close();
    } else if (preState) {
      if (preState.mode === 'off') exit('pip ended', false);
      preState = null;
    }
    TTM.log('layout: pip ' + (on ? 'on' : 'off'));
  }
  window.addEventListener('tizentube-pip', function (e) { setPip(e.detail && e.detail.active); });
  whenRoot(function () {
    new MutationObserver(function () {
      setPip(document.documentElement.classList.contains(PIP_CLASS));
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });

  // Back in CSS fill mode (no real fullscreen for Android to exit first).
  TTM.backHandlers.push(function () {
    if (state.mode === 'fill' && !state.pip) return exit('back', true);
    return false;
  });

  TTM.onSettingsChange(function (s) {
    if (s.videoFit !== state.lastSettingFit) { state.lastSettingFit = s.videoFit; setFit(s.videoFit, 'setting'); }
    if (!s.autoFullscreen && !state.manual) exit('setting off', false);
  });
  state.lastSettingFit = TTM.settings.videoFit;

  // New video: reset opt-out and framing to the default. Left the watch page: exit.
  function tick() {
    var id = videoId();
    if (id === state.videoId) return;
    state.videoId = id;
    state.optedOut = false;
    setFit(TTM.settings.videoFit, 'new video');
    if (!id) { exit('left watch page', false); return; }
    if (playingVideo() && playingVideo().currentTime > 0) maybeEnter('navigated');
  }
  whenRoot(applyFitClass);

  var promoQueued = false;
  TTM.onReady(function () {
    hideAppPromos();
    new MutationObserver(function () {
      if (promoQueued) return;
      promoQueued = true;
      requestAnimationFrame(function () { promoQueued = false; hideAppPromos(); });
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    setInterval(tick, 400);
  });

  TTM.layout = {
    state: state, enter: enter, exit: exit, hideAppPromos: hideAppPromos, setFit: setFit, setPip: setPip,
    isWide: isWide, aspect: aspect,
    get mode() { return state.mode; }, get fit() { return state.fit; }
  };
})();
