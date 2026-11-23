/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 00: core (config, settings, i18n, utils).
 *
 * All tizentube_mobile_*.js files in this directory are embedded into the APK
 * by //cobalt/shell:embed_polyfilled_javascript and injected at document start
 * (all frames, all origins) by Shell::RegisterInjectedJavaScript() in
 * cobalt/shell/browser/shell.cc. They run in file-name order (std::map), and
 * only do work in the top frame of an allowed YouTube host (see isAllowedLocation).
 * See docs/TOUCH_MOBILE.md.
 */
(function () {
  'use strict';
  /**
   * Host guard. The polyfill directory is injected into EVERY document and frame
   * (AddDocumentStartJavaScript with origin "*"), including accounts.google.com and
   * other Google sign-in / consent pages reached from m.youtube.com. This userscript
   * must be a no-op there: no hooks (JSON.parse, fetch), no DOM, no styles.
   *  - Only the youtube.com web hosts below. music.youtube.com, studio, *.google.com,
   *    accounts.*, consent.* are all rejected.
   *  - Not under /tv: the leanback app has its own (jsdelivr) userscript.
   *  - The harness flag is honoured only on a local origin, so a page cannot opt in.
   */
  var ALLOWED_HOSTS = { 'm.youtube.com': 1, 'www.youtube.com': 1, 'youtube.com': 1 };
  function isAllowedLocation(loc, harnessFlag) {
    if (!loc || /^\/tv(\/|$)/.test(loc.pathname || '')) return false;
    if (Object.prototype.hasOwnProperty.call(ALLOWED_HOSTS, loc.hostname)) {
      return loc.protocol === 'https:';
    }
    return !!harnessFlag && (loc.protocol === 'file:' || loc.hostname === 'localhost' ||
      loc.hostname === '127.0.0.1');
  }
  if (window.top !== window) return;
  if (!isAllowedLocation(location, window.__TIZENTUBE_MOBILE_HARNESS__)) return;
  if (window.TTM) return;

  /** Tunables. Times in ms, distances in CSS px. */
  var CONFIG = {
    STORAGE_KEY: 'tizentube_mobile_settings_v1',
    SPONSORBLOCK_API: 'https://sponsor.ajay.app/api/skipSegments',
    SPONSORBLOCK_CATEGORIES: ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro',
      'preview', 'music_offtopic', 'filler'],
    SKIP_TOAST_MS: 4000,
    SKIP_EPSILON_S: 0.3,
    POLL_MS: 500,
    SPEEDS: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3],
    // Two-finger pinch on the player toggles fit <-> fill once the finger distance
    // changes by this factor (and at least PINCH_MIN_PX).
    PINCH_RATIO: 1.25,
    PINCH_MIN_PX: 40,
    MODE_TOAST_MS: 1200,
    // Auto landscape fill only when innerWidth/innerHeight is above ENTER and leaves it
    // below EXIT (hysteresis), re-evaluated after RESIZE_DEBOUNCE_MS without changes.
    FILL_ASPECT_ENTER: 1.6,
    FILL_ASPECT_EXIT: 1.5,
    RESIZE_DEBOUNCE_MS: 250,
    AD_FAST_FORWARD_RATE: 16
  };

  var DEFAULTS = {
    adblock: true,
    sponsorblock: true,
    sbCategories: { sponsor: true, selfpromo: true, interaction: true, intro: false,
      outro: false, preview: false, music_offtopic: true, filler: false },
    speed: 1,
    // Wide window (aspect > FILL_ASPECT_ENTER): fill the window when a video plays.
    autoFullscreen: true,
    // Default video framing: 'fit' = object-fit: contain (whole frame, black bars),
    // 'fill' = cover (crop to the window). Pinch toggles it per video.
    videoFit: 'fit',
    // "Khi chuyển app": 'audio' = keep playing audio in the background (default, no PiP
    // window over the car map), 'pip' = picture-in-picture, 'stop' = pause as before.
    // Mirrored to Java (SharedPreferences) through window.TizenTubeMobile.
    onLeave: 'audio',
    // v7 codec gate (module 07): 'auto' = reject AV1, >1080p, >60 fps; 'h264' = also VP9/VP8.
    codec: 'auto',
    // v7b quality cap (module 22): 'auto' = 480p target / 720p cap in the normal layout,
    // up to 1080p in wide fill / fullscreen; or a fixed cap.
    quality: 'auto',
    // v7c: allow 60 fps formats (default off: <= 30 fps, see module 07).
    fps60: false,
    // v7c "Chỉ nghe": audio only, lowest video quality, video pixels hidden.
    audioOnly: false,
    // v7c: comments are not loaded on watch pages unless tapped.
    comments: false
  };
  var ENUMS = { videoFit: ['fit', 'fill'], onLeave: ['audio', 'pip', 'stop'], codec: ['auto', 'h264'],
    quality: ['auto', '480', '720', '1080'] };

  /** Vietnamese UI strings. */
  var STRINGS = {
    menuEntry: 'Cài đặt TizenTube',
    settingsTitle: 'Cài đặt TizenTube',
    adblock: 'Chặn quảng cáo',
    sponsorblock: 'SponsorBlock (tự bỏ qua đoạn)',
    sbCategoriesTitle: 'Loại đoạn được bỏ qua',
    speed: 'Tốc độ phát mặc định',
    speedNormal: 'Bình thường',
    autoFullscreen: 'Tự động toàn màn hình khi xem (màn rộng)',
    videoFit: 'Khung video',
    videoFitOptions: { fit: 'Vừa khung', fill: 'Phủ kín' },
    onLeave: 'Khi chuyển app',
    onLeaveOptions: { audio: 'Chỉ phát âm thanh', pip: 'Cửa sổ nổi (PiP)', stop: 'Dừng phát' },
    quality: 'Chất lượng',
    qualityOptions: { auto: 'Tự động', '480': '480p', '720': '720p', '1080': '1080p' },
    qualityNote: 'Tự động: 480p trong khung nhỏ (tối đa 720p), tới 1080p khi toàn màn hình.',
    fps60: 'Cho phép 60fps',
    fps60Note: 'Mặc định tối đa 30fps (màn xe 50Hz). Có hiệu lực từ video tiếp theo.',
    audioOnly: 'Chỉ nghe (ẩn hình, 144p)',
    audioOnlyShort: 'Chỉ nghe',
    audioOnlyOff: 'Hiện hình',
    comments: 'Bình luận',
    commentsShow: 'Hiện bình luận',
    codec: 'Codec',
    codecOptions: { auto: 'Tự động (chặn AV1)', h264: 'Ưu tiên H.264' },
    codecNote: 'Đổi codec có hiệu lực từ video tiếp theo.',
    screenInfo: function (dpr, sw, sh, iw, ih) {
      return 'DPR ' + dpr + ' · màn ' + sw + '×' + sh + ' · khung ' + iw + '×' + ih;
    },
    close: 'Đóng',
    undo: 'Hoàn tác',
    volume: 'Âm lượng',
    brightness: 'Độ sáng',
    skipped: {
      sponsor: 'Đã bỏ qua đoạn tài trợ',
      selfpromo: 'Đã bỏ qua đoạn tự quảng bá',
      interaction: 'Đã bỏ qua lời nhắc tương tác',
      intro: 'Đã bỏ qua đoạn mở đầu',
      outro: 'Đã bỏ qua đoạn kết',
      preview: 'Đã bỏ qua đoạn xem trước / tóm tắt',
      music_offtopic: 'Đã bỏ qua đoạn không phải nhạc',
      filler: 'Đã bỏ qua đoạn lan man',
      _default: 'Đã bỏ qua một đoạn'
    },
    categories: {
      sponsor: 'Tài trợ', selfpromo: 'Tự quảng bá', interaction: 'Nhắc tương tác',
      intro: 'Mở đầu', outro: 'Kết thúc', preview: 'Xem trước / tóm tắt',
      music_offtopic: 'Không phải nhạc', filler: 'Lan man'
    }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function loadSettings() {
    var s = clone(DEFAULTS);
    try {
      var raw = window.localStorage.getItem(CONFIG.STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (!(k in saved)) return;
          if (k === 'sbCategories') {
            Object.keys(DEFAULTS.sbCategories).forEach(function (c) {
              if (typeof saved.sbCategories[c] === 'boolean') s.sbCategories[c] = saved.sbCategories[c];
            });
          } else if (ENUMS[k]) {
            if (ENUMS[k].indexOf(saved[k]) >= 0) s[k] = saved[k];
          } else if (typeof saved[k] === typeof DEFAULTS[k]) {
            s[k] = saved[k];
          }
        });
      }
    } catch (e) {
      console.warn('[TizenTube] cannot read settings', e);
    }
    return s;
  }

  var settings = loadSettings();
  var listeners = [];

  /**
   * Native bridge (dev.cobalt.coat.javabridge.TizenTubeMobileBridge, exposed as
   * window.TizenTubeMobile by Cobalt's JavascriptInjector, YouTube origins only).
   * Java keeps "onLeave" in SharedPreferences so it is known before any page loads
   * (onUserLeaveHint / onStop). Java is the source of truth for onLeave: if the page's
   * localStorage disagrees (e.g. it was cleared), take the Java value.
   */
  function bridge() {
    var b = window.TizenTubeMobile;
    return b && typeof b.getBridgeVersion === 'function' ? b : null;
  }
  try {
    var b0 = bridge();
    if (b0 && typeof b0.getLeaveMode === 'function') {
      var javaMode = b0.getLeaveMode();
      if (ENUMS.onLeave.indexOf(javaMode) >= 0) settings.onLeave = javaMode;
    }
  } catch (e) { /* bridge not ready */ }
  function pushLeaveModeToJava() {
    try {
      var b = bridge();
      if (b && typeof b.setLeaveMode === 'function') b.setLeaveMode(settings.onLeave);
    } catch (e) { console.warn('[TizenTube] setLeaveMode failed', e); }
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[TizenTube] cannot save settings', e);
    }
    pushLeaveModeToJava();
    listeners.forEach(function (fn) { try { fn(settings); } catch (e) { console.error(e); } });
  }

  function setSetting(key, value) {
    settings[key] = value;
    saveSettings();
  }

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  /** Root for our overlays; must live inside the fullscreen element to be visible. */
  function overlayParent() {
    return document.fullscreenElement || document.webkitFullscreenElement || document.body ||
      document.documentElement;
  }

  /**
   * Adds a <style>. Document-start scripts (AddDocumentStartJavaScript) run
   * before <html> exists, so attach as soon as there is a root element.
   */
  function addStyle(css) {
    var el = document.createElement('style');
    el.textContent = css;
    var root = document.head || document.documentElement;
    if (root) {
      root.appendChild(el);
    } else {
      var mo = new MutationObserver(function () {
        var r = document.head || document.documentElement;
        if (!r) return;
        mo.disconnect();
        if (!el.isConnected) r.appendChild(el);
      });
      mo.observe(document, { childList: true, subtree: true });
    }
    return el;
  }

  /**
   * DOM helpers. m.youtube.com enforces Trusted Types
   * (Content-Security-Policy: require-trusted-types-for 'script'), so string
   * assignment to innerHTML throws. Build every node explicitly instead.
   */
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (children || []).forEach(function (c) {
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  /** 24x24 single-path icon. */
  function svgIcon(pathD) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  function log() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[TizenTube]');
    console.log.apply(console, args);
    if (typeof window.__TIZENTUBE_MOBILE_LOG__ === 'function') {
      try { window.__TIZENTUBE_MOBILE_LOG__(args.slice(1).join(' ')); } catch (e) { /* ignore */ }
    }
  }

  // The Cobalt app expects the web app to report that it is up (Kabuki does this on
  // youtube.com/tv). It keeps platform-error handling and StartupGuard consistent.
  onReady(function () {
    try {
      if (window.h5vcc && h5vcc.system && h5vcc.system.hideSplashScreen) h5vcc.system.hideSplashScreen();
    } catch (e) { /* not running in Cobalt */ }
  });

  var TTM_OBJ = {
    CONFIG: CONFIG, DEFAULTS: DEFAULTS, STRINGS: STRINGS,
    get settings() { return settings; },
    setSetting: setSetting, saveSettings: saveSettings,
    onSettingsChange: function (fn) { listeners.push(fn); },
    onReady: onReady, overlayParent: overlayParent, addStyle: addStyle, log: log,
    el: el, svgIcon: svgIcon, bridge: bridge, ENUMS: ENUMS,
    // Back handlers registered by modules; see __tizentubeMobileHandleBack.
    // The LAST registered runs FIRST (settings sheet before layout fill).
    backHandlers: [],
    isAllowedLocation: isAllowedLocation
  };
  // Pin the binding so page scripts cannot swap it out (the object stays extensible
  // because later modules attach TTM.adblock, TTM.player, ...).
  Object.defineProperty(window, 'TTM', { value: TTM_OBJ, writable: false, configurable: false });

  // Called by CobaltActivity.handleMobileBack() before history.back().
  // Returns true when a TizenTube overlay consumed the Back press.
  window.__tizentubeMobileHandleBack = function () {
    for (var i = window.TTM.backHandlers.length - 1; i >= 0; i--) {
      try { if (window.TTM.backHandlers[i]() === true) return true; } catch (e) { console.error(e); }
    }
    return false;
  };
})();
