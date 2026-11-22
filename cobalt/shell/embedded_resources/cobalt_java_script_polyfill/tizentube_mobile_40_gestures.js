/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 40: player swipe gestures.
 *  - Vertical swipe on the LEFT half of the player  = screen brightness.
 *  - Vertical swipe on the RIGHT half of the player = volume.
 * A small indicator (icon + bar + %) is shown in the centre while adjusting.
 *
 * Does NOT add taps, double-taps, play/pause or seek handling: YouTube's own
 * double-tap seek and tap-to-toggle-controls keep working. We only claim a
 * touch once it has moved GESTURE_MIN_DY px mostly vertically; from then on
 * its touchmove/touchend events are hidden from YouTube so it does not also
 * treat the swipe as a tap or a scroll.
 *
 * Native side: window.TizenTubeMobile (dev.cobalt.coat.javabridge.TizenTubeMobileBridge)
 *  - brightness: Window.LayoutParams.screenBrightness (app window only).
 *  - volume: AudioManager STREAM_MUSIC (same stream as the hardware keys).
 * Fallbacks without the bridge (desktop harness): video.volume and a CSS
 * brightness() filter on the player.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.gestures) return;
  var CONFIG = TTM.CONFIG, S = TTM.STRINGS;

  function bridge() {
    var b = window.TizenTubeMobile;
    return b && typeof b.setVolume === 'function' ? b : null;
  }
  var warned = false;
  function warnNoBridge() {
    if (!warned) {
      warned = true;
      console.warn('[TizenTube] native bridge window.TizenTubeMobile missing; using web fallbacks');
    }
  }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  // ------------------------------------------------------------ levels
  var cssBrightness = 1;
  var levels = {
    getVolume: function (video) {
      var b = bridge();
      if (b) { var v = b.getVolume(); if (v >= 0) return v; }
      warnNoBridge();
      return video ? video.volume : 1;
    },
    setVolume: function (level, video) {
      var b = bridge();
      if (b && b.setVolume(level) >= 0) {
        if (video && video.muted && level > 0) video.muted = false;
        return;
      }
      warnNoBridge();
      if (video) { video.volume = level; video.muted = level === 0; }
    },
    getBrightness: function () {
      var b = bridge();
      if (b) return b.getBrightness();
      warnNoBridge();
      return cssBrightness;
    },
    setBrightness: function (level, player) {
      var b = bridge();
      if (b) { b.setBrightness(level); return; }
      warnNoBridge();
      cssBrightness = level;
      // CSS fallback: can only dim, so map 0..1 to 0.2..1.
      if (player) player.style.filter = level >= 0.999 ? '' : 'brightness(' + (0.2 + 0.8 * level) + ')';
    }
  };

  // --------------------------------------------------------- indicator
  TTM.addStyle([
    '#ttm-level{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483646;',
    'display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;',
    'background:rgba(0,0,0,.72);color:#fff;font:500 14px Roboto,Arial,sans-serif;',
    'pointer-events:none;opacity:0;transition:opacity .15s}',
    '#ttm-level.ttm-show{opacity:1}',
    '#ttm-level svg{width:24px;height:24px;fill:#fff;flex:none}',
    '#ttm-level .ttm-bar{width:140px;height:4px;border-radius:2px;background:rgba(255,255,255,.3);overflow:hidden}',
    '#ttm-level .ttm-fill{height:100%;background:#fff}',
    '#ttm-level .ttm-pct{min-width:40px;text-align:right;font-variant-numeric:tabular-nums}'
  ].join(''));
  var ICON_PATHS = {
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z' +
      'M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
    mute: 'M3 9v6h4l5 5V4L7 9H3zm13.6 3 2.7-2.7-1.4-1.4-2.7 2.7-2.7-2.7-1.4 1.4' +
      ' 2.7 2.7-2.7 2.7 1.4 1.4 2.7-2.7 2.7 2.7 1.4-1.4z',
    brightness: 'M20 8.7V4h-4.7L12 .7 8.7 4H4v4.7L.7 12 4 15.3V20h4.7l3.3 3.3' +
      ' 3.3-3.3H20v-4.7l3.3-3.3L20 8.7zM12 18a6 6 0 1 1 0-12 6 6 0 0 1 0 12z'
  };
  var indicator = null, hideTimer = 0;
  function showIndicator(kind, level) {
    if (!indicator) {
      indicator = TTM.el('div', { id: 'ttm-level', role: 'status' }, [
        TTM.el('span', { 'class': 'ttm-icon' }),
        TTM.el('div', { 'class': 'ttm-bar' }, [TTM.el('div', { 'class': 'ttm-fill' })]),
        TTM.el('span', { 'class': 'ttm-pct' })
      ]);
    }
    var parent = TTM.overlayParent();
    if (indicator.parentNode !== parent) parent.appendChild(indicator);
    var icon = kind === 'brightness' ? 'brightness' : (level <= 0 ? 'mute' : 'volume');
    if (indicator.getAttribute('data-icon') !== icon) {
      var slot = indicator.querySelector('.ttm-icon');
      while (slot.firstChild) slot.removeChild(slot.firstChild);
      slot.appendChild(TTM.svgIcon(ICON_PATHS[icon]));
      indicator.setAttribute('data-icon', icon);
    }
    indicator.setAttribute('aria-label', (kind === 'brightness' ? S.brightness : S.volume) + ' ' +
      Math.round(level * 100) + '%');
    indicator.querySelector('.ttm-fill').style.width = Math.round(level * 100) + '%';
    indicator.querySelector('.ttm-pct').textContent = Math.round(level * 100) + '%';
    indicator.classList.add('ttm-show');
    clearTimeout(hideTimer);
  }
  function scheduleHideIndicator() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (indicator) indicator.classList.remove('ttm-show'); },
      CONFIG.INDICATOR_HIDE_MS);
  }

  // ------------------------------------------------------- recognizer
  var PLAYER_SELECTOR = '#player-container-id, #movie_player, .html5-video-player, ' +
    '[data-ttm-player]';
  var CONTROL_SELECTOR = '.ytp-progress-bar, .ytp-chrome-bottom, .ytm-progress-bar, ' +
    'ytm-progress-bar, .player-controls-bottom, .ytm-autonav-bar, [data-ttm-no-gesture]';
  var g = null;  // Active touch: {id, x0, y0, rect, kind, start, claimed, player, video}.
  var pending = null, rafQueued = false;

  function findPlayer(target) {
    return target && target.closest ? target.closest(PLAYER_SELECTOR) : null;
  }

  function onTouchStart(e) {
    g = null;
    if (!TTM.settings.gestures || e.touches.length !== 1) return;
    var t = e.touches[0];
    var player = findPlayer(e.target);
    if (!player || (e.target.closest && e.target.closest(CONTROL_SELECTOR))) return;
    var video = player.querySelector('video');
    if (!video) return;
    var rect = player.getBoundingClientRect();
    if (rect.height < 120 || rect.width < 200) return;  // Miniplayer.
    var x = t.clientX - rect.left, y = t.clientY - rect.top;
    if (x < CONFIG.GESTURE_EDGE_EXCLUDE || x > rect.width - CONFIG.GESTURE_EDGE_EXCLUDE ||
        y < CONFIG.GESTURE_TOP_EXCLUDE || y > rect.height - CONFIG.GESTURE_BOTTOM_EXCLUDE) {
      return;  // Android back/notification edges, top bar and progress bar.
    }
    g = { id: t.identifier, x0: t.clientX, y0: t.clientY, rect: rect, player: player, video: video,
      kind: x < rect.width / 2 ? 'brightness' : 'volume', claimed: false, start: 0 };
  }

  function findTouch(list) {
    for (var i = 0; i < list.length; i++) if (list[i].identifier === g.id) return list[i];
    return null;
  }

  function onTouchMove(e) {
    if (!g) return;
    var t = findTouch(e.changedTouches);
    if (!t) return;
    var dx = t.clientX - g.x0, dy = t.clientY - g.y0;
    if (!g.claimed) {
      if (Math.abs(dx) > CONFIG.GESTURE_MIN_DY && Math.abs(dx) * CONFIG.GESTURE_DIRECTION_RATIO > Math.abs(dy)) {
        g = null;  // Horizontal: leave it to YouTube (seek scrubbing etc.).
        return;
      }
      if (Math.abs(dy) < CONFIG.GESTURE_MIN_DY || Math.abs(dy) < Math.abs(dx) * CONFIG.GESTURE_DIRECTION_RATIO) {
        return;  // Not decided yet; YouTube still sees the events.
      }
      g.claimed = true;
      g.y0 = t.clientY;  // Start adjusting from here so there is no jump.
      g.start = g.kind === 'volume' ? levels.getVolume(g.video) : levels.getBrightness();
      TTM.log('gesture: ' + g.kind + ' start ' + Math.round(g.start * 100) + '%');
    }
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    var span = g.rect.height * CONFIG.GESTURE_FULL_SWEEP_FRACTION;
    var level = clamp01(g.start - (t.clientY - g.y0) / span);
    pending = { kind: g.kind, level: level, video: g.video, player: g.player };
    showIndicator(g.kind, level);
    if (!rafQueued) {
      rafQueued = true;
      requestAnimationFrame(flush);
    }
  }

  // Bridge calls are synchronous IPC; apply at most once per frame.
  function flush() {
    rafQueued = false;
    if (!pending) return;
    var p = pending;
    pending = null;
    if (p.kind === 'volume') levels.setVolume(p.level, p.video);
    else levels.setBrightness(p.level, p.player);
  }

  function onTouchEnd(e) {
    if (!g) return;
    if (!findTouch(e.changedTouches)) return;
    var claimed = g.claimed, kind = g.kind;
    g = null;
    if (!claimed) return;
    // Hide the end of our swipe from YouTube so it is not taken as a tap.
    if (e.cancelable) e.preventDefault();
    e.stopImmediatePropagation();
    flush();
    TTM.log('gesture: ' + kind + ' end');
    scheduleHideIndicator();
  }

  // Capture on window so we run before YouTube's own listeners.
  window.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  window.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: false });

  TTM.gestures = { levels: levels, showIndicator: showIndicator };
})();
