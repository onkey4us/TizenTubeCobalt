/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 08: lighter page (v7).
 *
 * 1. No inline feed previews ("Phát tự động trong nguồn cấp dữ liệu" / muted
 *    autoplay on thumbnails, hover/scroll previews, inline search playback):
 *     a. experiment flags seen on m.youtube.com (enable_inline_muted_playback_*,
 *        mweb_mixes_inline_playback, ...) are forced off when YouTube writes its
 *        config (ytcfg.set / yt.config_), so preview players are not created;
 *     b. the preview containers (ytm-video-preview-portal, ytm-inline-playback-*,
 *        inline player containers inside feed items) are display:none;
 *     c. a guard: any <video> outside the watch/shorts player is paused, emptied and
 *        its play() rejected, so nothing can play in the feed even if a. and b. miss.
 * 2. No transitions / animations / box-shadow / backdrop-filter page-wide, and no
 *    "cinematic" ambient glow behind the player (a blurred canvas redrawn every
 *    frame). Durations are set to ~0 (1 ms) instead of `none` so YouTube's
 *    transitionend / animationend handlers still fire (sheets and menus close).
 *    Infinite animations (spinners) run once and stop. Our own toast and sheet use
 *    solid backgrounds and stay readable.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.light) return;
  var stats = { flagsOff: 0, killedVideos: 0, blockedPlays: 0 };

  // ----------------------------------------------------------- 1a. flags
  var FLAG_RE = /(^|_)inline(_|$)|inline_muted|inline_playback|muted_autoplay|video_preview|hover_preview|feed_autoplay|mixes_inline/i;
  function scrubFlags(flags) {
    if (!flags || typeof flags !== 'object') return flags;
    Object.keys(flags).forEach(function (k) {
      if (FLAG_RE.test(k) && flags[k] === true) { flags[k] = false; stats.flagsOff++; }
    });
    return flags;
  }
  function scrubConfig(obj) {
    if (obj && typeof obj === 'object') {
      if (obj.EXPERIMENT_FLAGS) scrubFlags(obj.EXPERIMENT_FLAGS);
      if (obj.WEB_PLAYER_CONTEXT_CONFIGS) {
        Object.keys(obj.WEB_PLAYER_CONTEXT_CONFIGS).forEach(function (k) {
          if (/INLINE|PREVIEW/i.test(k)) delete obj.WEB_PLAYER_CONTEXT_CONFIGS[k];
        });
      }
    }
    return obj;
  }
  function hookYtcfg(ytcfg) {
    if (!ytcfg || ytcfg.__ttmHooked || typeof ytcfg.set !== 'function') return;
    var origSet = ytcfg.set;
    ytcfg.set = function (a, b) {
      if (a && typeof a === 'object') scrubConfig(a);
      else if (a === 'EXPERIMENT_FLAGS') scrubFlags(b);
      return origSet.apply(this, arguments);
    };
    ytcfg.__ttmHooked = true;
    if (ytcfg.data_) scrubConfig(ytcfg.data_);
  }
  // window.ytcfg is created by an inline script; catch the assignment.
  (function () {
    var value = window.ytcfg;
    try {
      Object.defineProperty(window, 'ytcfg', {
        configurable: true,
        get: function () { return value; },
        set: function (v) { value = v; try { hookYtcfg(v); } catch (e) { /* ignore */ } }
      });
    } catch (e) { /* non-configurable */ }
    if (value) hookYtcfg(value);
  })();
  TTM.onReady(function () {
    try { hookYtcfg(window.ytcfg); } catch (e) {}
    try { if (window.yt && yt.config_) scrubConfig(yt.config_); } catch (e) {}
  });

  // --------------------------------------------- 1b + 2. CSS (one sheet)
  TTM.addStyle([
    'ytm-video-preview-portal,ytm-inline-playback-renderer,ytm-inline-player-renderer,',
    '.inline-player-container,ytm-rich-item-renderer .player-container,',
    'ytm-video-with-context-renderer .player-container,ytm-compact-video-renderer .player-container,',
    '.media-item-inline-player,#inline-preview-player{display:none!important}',
    // Ambient "cinematic" glow behind the player.
    'ytm-cinematic-container-renderer,#player-cinematics-container,.cinematic-container{display:none!important}',
    // Page-wide: near-zero transition/animation time, no shadows / backdrop blur.
    'html.ttm-light *,html.ttm-light *::before,html.ttm-light *::after{',
    'transition-duration:1ms!important;transition-delay:0s!important;',
    'animation-duration:1ms!important;animation-delay:0s!important;animation-iteration-count:1!important;',
    'box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;',
    'scroll-behavior:auto!important}',
    // Our overlays: solid, readable without shadows.
    'html.ttm-light #ttm-skip-toast{border:1px solid rgba(255,255,255,.35)!important}',
    'html.ttm-light #ttm-sheet{border:1px solid rgba(255,255,255,.18)!important}'
  ].join(''));
  (function addLightClass() {
    if (document.documentElement) { document.documentElement.classList.add('ttm-light'); return; }
    var mo = new MutationObserver(function () {
      if (!document.documentElement) return;
      mo.disconnect();
      document.documentElement.classList.add('ttm-light');
    });
    mo.observe(document, { childList: true });
  })();

  // ------------------------------------------------- 1c. preview guard
  function isMainPlayerVideo(v) {
    if (!v || !v.closest) return false;
    if (v.closest('#ttm-allow-video')) return true;
    var path = location.pathname;
    if (/^\/shorts\//.test(path) && v.closest('#player-shorts-container, ytm-shorts-player, ytm-reel-player-overlay-renderer, ytm-reel-video-renderer')) return true;
    var inMain = v.closest('#player-container-id');
    if (!inMain) return false;
    // The main player element is reused by m.youtube.com; outside a watch page a
    // playing main player is a feed preview (or a miniplayer we do not want either).
    return /^\/(watch|shorts|live|embed)\b/.test(path) || /[?&]v=/.test(location.search);
  }
  function kill(v, why) {
    try {
      v.pause();
      if (!v.closest('#player-container-id')) {
        v.removeAttribute('src');
        v.load();
      }
    } catch (e) { /* ignore */ }
    stats.killedVideos++;
    TTM.log('light: stopped preview video (' + why + ')');
  }
  var origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.tagName === 'VIDEO' && !isMainPlayerVideo(this)) {
      stats.blockedPlays++;
      try { this.pause(); } catch (e) {}
      return Promise.reject(new DOMException('Inline previews are disabled by TizenTube', 'NotAllowedError'));
    }
    return origPlay.apply(this, arguments);
  };
  // Autoplay attribute / play triggered internally (not via play()).
  document.addEventListener('playing', function (e) {
    var v = e.target;
    if (v && v.tagName === 'VIDEO' && !isMainPlayerVideo(v)) kill(v, 'playing outside watch player');
  }, true);

  TTM.light = { stats: stats, isMainPlayerVideo: isMainPlayerVideo, scrubFlags: scrubFlags };
})();
