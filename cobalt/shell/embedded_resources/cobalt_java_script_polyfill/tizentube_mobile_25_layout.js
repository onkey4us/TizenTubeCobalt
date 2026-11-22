/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 25: layout (designer v4).
 *
 * 1. Landscape auto-fullscreen. When a watch-page video starts playing in
 *    landscape, the player fills the screen: no YouTube header, no black side
 *    bars. "Fill" = <html>.ttm-fill pins #player-container-id over the viewport
 *    and sizes the <video> to it (object-fit: cover by default, contain if the
 *    user turns cropping off). No user gesture needed.
 *
 *    The browser Fullscreen API is NOT used by default (USE_FULLSCREEN_API).
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
 * 2. Hide "Mở ứng dụng" / "Open App" in the header and other open-in-app
 *    prompts (mealbar / upsell promos). Always on: inside the app it is useless.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.layout) return;

  var FILL_CLASS = 'ttm-fill';
  var COVER_CLASS = 'ttm-fill-cover';
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
    'width:100%!important;height:100%!important;object-fit:contain!important}',
    'html.' + FILL_CLASS + '.' + COVER_CLASS + ' #player-container-id video{object-fit:cover!important}',
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
  var state = { mode: 'off', videoId: null, optedOut: false, pendingReal: false };
  var landscape = window.matchMedia ? window.matchMedia('(orientation: landscape)') : null;

  function container() { return document.getElementById('player-container-id'); }
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function isLandscape() { return landscape ? landscape.matches : innerWidth > innerHeight; }
  function videoId() { return TTM.player ? TTM.player.currentVideoId() : null; }

  function nudgeLayout() {
    // YouTube re-measures the player on resize.
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
    setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 300);
  }

  function applyCropClass() {
    document.documentElement.classList.toggle(COVER_CLASS, !!TTM.settings.fillCrop);
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
          // Typically "Permissions check failed": no user activation yet.
          state.pendingReal = false;
          TTM.log('layout: requestFullscreen rejected (' + (e && e.name) + '), CSS fill kept');
        });
      }
    } catch (e) {
      state.pendingReal = false;
    }
  }

  function enter(reason) {
    if (!container()) return;
    applyCropClass();
    if (state.mode === 'off') {
      document.documentElement.classList.add(FILL_CLASS);
      state.mode = 'fill';
      window.scrollTo(0, 0);
      TTM.log('layout: fill on (' + reason + ')');
      nudgeLayout();
    }
    requestReal();
  }

  function exit(reason, optOut) {
    if (state.mode === 'off') return false;
    state.mode = 'off';
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
    if (!TTM.settings.autoFullscreen || state.optedOut || !isLandscape() || !videoId()) return;
    if (state.mode === 'off') enter(reason);
  }

  // A watch-page video started playing.
  document.addEventListener('playing', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || !v.closest || !v.closest('#player-container-id')) return;
    maybeEnter('playing');
  }, true);

  // Retry real fullscreen on a real tap in the player (carries user activation).
  document.addEventListener('touchend', function (e) {
    if (!USE_FULLSCREEN_API || state.mode !== 'fill' || fsElement() || state.pendingReal) return;
    var c = container();
    if (c && e.target && c.contains(e.target) && !e.target.closest('#ttm-sheet-backdrop, #ttm-skip-toast')) {
      requestReal();
    }
  }, true);

  // Leaving real fullscreen (Android Back -> WebContents.exitFullscreen(), system
  // gesture, YouTube's own button) means the user wants out: drop fill as well.
  function onFsChange() {
    var f = fsElement();
    if (f && f === fsTarget()) {
      if (state.mode === 'off') { document.documentElement.classList.add(FILL_CLASS); applyCropClass(); }
      state.mode = 'real';
    } else if (!f && state.mode === 'real') {
      exit('fullscreen exited', true);
    }
  }
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  if (landscape && landscape.addEventListener) {
    landscape.addEventListener('change', function () {
      if (!isLandscape()) { exit('portrait', false); return; }
      var v = TTM.player && TTM.player.getVideo();
      if (v && !v.paused) maybeEnter('rotated to landscape');
    });
  }

  // Back in CSS fill mode (no real fullscreen for Android to exit first).
  TTM.backHandlers.push(function () {
    if (state.mode === 'fill') return exit('back', true);
    return false;
  });

  TTM.onSettingsChange(function (s) {
    applyCropClass();
    if (!s.autoFullscreen) exit('setting off', false);
  });

  // New video: reset the opt-out. Left the watch page: exit.
  function tick() {
    var id = videoId();
    if (id === state.videoId) return;
    state.videoId = id;
    state.optedOut = false;
    if (!id) { exit('left watch page', false); return; }
    var v = TTM.player && TTM.player.getVideo();
    if (v && !v.paused && v.currentTime > 0) maybeEnter('navigated');
  }

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
    state: state, enter: enter, exit: exit, hideAppPromos: hideAppPromos,
    get mode() { return state.mode; }
  };
})();
