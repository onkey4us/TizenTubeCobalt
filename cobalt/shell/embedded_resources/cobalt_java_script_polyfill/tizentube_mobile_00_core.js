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
 * only do work in the top frame of m.youtube.com (or in the test harness).
 * See docs/TOUCH_MOBILE.md.
 */
(function () {
  'use strict';
  if (window.top !== window) return;
  var host = location.hostname;
  var isHarness = !!window.__TIZENTUBE_MOBILE_HARNESS__;
  if (host !== 'm.youtube.com' && !isHarness) return;
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
    GESTURE_MIN_DY: 24,
    GESTURE_DIRECTION_RATIO: 1.5,
    GESTURE_EDGE_EXCLUDE: 32,
    GESTURE_BOTTOM_EXCLUDE: 72,
    GESTURE_TOP_EXCLUDE: 48,
    GESTURE_FULL_SWEEP_FRACTION: 0.8,
    INDICATOR_HIDE_MS: 700,
    AD_FAST_FORWARD_RATE: 16
  };

  var DEFAULTS = {
    adblock: true,
    sponsorblock: true,
    sbCategories: { sponsor: true, selfpromo: true, interaction: true, intro: false,
      outro: false, preview: false, music_offtopic: true, filler: false },
    speed: 1,
    gestures: true
  };

  /** Vietnamese UI strings. */
  var STRINGS = {
    menuEntry: 'Cài đặt TizenTube',
    settingsTitle: 'Cài đặt TizenTube',
    adblock: 'Chặn quảng cáo',
    sponsorblock: 'SponsorBlock (tự bỏ qua đoạn)',
    sbCategoriesTitle: 'Loại đoạn được bỏ qua',
    speed: 'Tốc độ phát mặc định',
    speedNormal: 'Bình thường',
    gestures: 'Vuốt dọc chỉnh độ sáng / âm lượng',
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

  function saveSettings() {
    try {
      window.localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.warn('[TizenTube] cannot save settings', e);
    }
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

  function addStyle(css) {
    var el = document.createElement('style');
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
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

  window.TTM = {
    CONFIG: CONFIG, DEFAULTS: DEFAULTS, STRINGS: STRINGS,
    get settings() { return settings; },
    setSetting: setSetting, saveSettings: saveSettings,
    onSettingsChange: function (fn) { listeners.push(fn); },
    onReady: onReady, overlayParent: overlayParent, addStyle: addStyle, log: log,
    el: el, svgIcon: svgIcon,
    // Back handlers registered by modules; see __tizentubeMobileHandleBack.
    backHandlers: []
  };

  // Called by CobaltActivity.handleMobileBack() before history.back().
  // Returns true when a TizenTube overlay consumed the Back press.
  window.__tizentubeMobileHandleBack = function () {
    for (var i = window.TTM.backHandlers.length - 1; i >= 0; i--) {
      try { if (window.TTM.backHandlers[i]() === true) return true; } catch (e) { console.error(e); }
    }
    return false;
  };
})();
