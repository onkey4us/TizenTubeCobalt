/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 05: page visibility / focus spoof.
 *
 * m.youtube.com pauses (or stops autoplay) when the page becomes hidden or loses
 * focus. On the car head unit that happens all the time while the app is still
 * on screen: in the launcher's 3-pane split, touching the map pane blurs our
 * window (Activity.onPause), and with "Khi chuyển app" = audio/PiP we keep the
 * media playing after onStop too. So, while settings.onLeave is 'audio' or 'pip':
 *  - document.hidden === false, document.visibilityState === 'visible'
 *    (and the webkit-prefixed variants), document.hasFocus() === true;
 *  - visibilitychange / webkitvisibilitychange / pagehide / freeze / resume /
 *    window blur (and document-level focusout to nowhere) are stopped in the
 *    capture phase on window, so page listeners never see them.
 * With onLeave === 'stop' nothing is touched (stock behaviour).
 *
 * Runs right after 00_core at document start, i.e. before any YouTube script, so
 * the getters are in place before the page reads them. Native counterpart: the
 * renderer keeps running because CobaltActivity skips WebContents HIDDEN in
 * audio/PiP mode and passes --disable-background-media-suspend (see
 * docs/TOUCH_MOBILE.md, "Phát nền").
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.visibility) return;

  var stats = { blocked: {}, getterReads: 0 };
  function active() { return TTM.settings.onLeave !== 'stop'; }

  // ------------------------------------------------------------- getters
  function wrapGetter(proto, prop, spoofed) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.get || !d.configurable) return false;
    var orig = d.get;
    Object.defineProperty(proto, prop, {
      configurable: true, enumerable: d.enumerable,
      get: function () {
        if (!active()) return orig.call(this);
        stats.getterReads++;
        return spoofed;
      }
    });
    return true;
  }
  var DP = Document.prototype;
  var wrapped = [
    wrapGetter(DP, 'hidden', false) && 'hidden',
    wrapGetter(DP, 'visibilityState', 'visible') && 'visibilityState',
    wrapGetter(DP, 'webkitHidden', false) && 'webkitHidden',
    wrapGetter(DP, 'webkitVisibilityState', 'visible') && 'webkitVisibilityState'
  ].filter(Boolean);

  var origHasFocus = DP.hasFocus;
  DP.hasFocus = function hasFocus() {
    return active() ? true : origHasFocus.call(this);
  };

  // -------------------------------------------------------------- events
  // Registered first (document start) and in the capture phase on window, which
  // is the very first listener for events dispatched at document or window.
  var BLOCK = ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze', 'resume', 'blur'];
  function blocker(e) {
    if (!active()) return;
    // Window blur only; element blur/focus (inputs, buttons) must keep working.
    if (e.type === 'blur' && e.target !== window && e.target !== document) return;
    // pagehide of a real unload/navigation (we flag beforeunload): let it through.
    if (e.type === 'pagehide' && unloading) return;
    stats.blocked[e.type] = (stats.blocked[e.type] || 0) + 1;
    e.stopImmediatePropagation();
  }
  var unloading = false;
  window.addEventListener('beforeunload', function () { unloading = true; }, true);
  BLOCK.forEach(function (t) {
    window.addEventListener(t, blocker, true);
    document.addEventListener(t, blocker, true);
  });

  // on* handler properties (document.onvisibilitychange = fn, window.onblur = fn) are
  // ordinary listeners too, so the capture-phase blocker above already covers them.

  TTM.visibility = { stats: stats, active: active, wrapped: wrapped };
  TTM.log('visibility: spoof ready (' + wrapped.join(',') + '), mode=' + TTM.settings.onLeave);
})();
