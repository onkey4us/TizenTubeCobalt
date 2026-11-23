/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 22: video quality cap (v7b).
 *
 * Setting "Chất lượng": 'auto' (default) | '480' | '720' | '1080'.
 *   auto: normal watch layout (car split pane, phone portrait, any non-fill view)
 *         -> 480p, or 720p only when the player is taller than ~600 physical px
 *         (never above 720p); wide auto-fill / fullscreen -> 720p, 1080p when the
 *         player is taller than ~900 physical px (never above 1080p). The target is
 *         the smallest standard height >= ~0.9 x the player's physical height.
 *   480 / 720 / 1080: fixed target and cap.
 * Implemented with m.youtube.com's player API (verified on the real site):
 *   movie_player.setPlaybackQualityRange(target, target) with YouTube quality names
 *   (a [480, 720] range lets YouTube's ABR jump straight to 720p, seen on the site)
 *   (tiny 144, small 240, medium 360, large 480, hd720, hd1080). setPlaybackQuality()
 *   alone is ignored by the mweb player; setPlaybackQualityRange switches within a few
 *   seconds (video.videoHeight follows). Re-applied on every new video, on
 *   'resize' (split pane / multi-window changes), on fill / fullscreen changes and
 *   after quality changes YouTube makes on its own (ABR).
 * The MediaSource / decodingInfo gate (module 07) keeps rejecting > 1080p / > 60 fps
 * statically; YouTube probes once, so dynamic caps go through the player API.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.quality) return;

  var NAME = { 144: 'tiny', 240: 'small', 360: 'medium', 480: 'large', 720: 'hd720', 1080: 'hd1080' };
  var stats = { applied: 0, last: null };

  function player() { return document.getElementById('movie_player'); }
  function isBig() {
    var fill = TTM.layout && TTM.layout.mode !== 'off';
    return !!(fill || document.fullscreenElement || document.webkitFullscreenElement);
  }
  function playerPhysicalHeight() {
    var c = document.getElementById('player-container-id');
    var h = c ? c.getBoundingClientRect().height : innerHeight;
    return Math.round(Math.min(h, innerHeight) * (window.devicePixelRatio || 1));
  }
  /** { target, max } heights in px for the current setting and layout. */
  function wanted() {
    var q = TTM.settings.quality;
    if (q === '480' || q === '720' || q === '1080') { var h = +q; return { target: h, max: h }; }
    var big = isBig(), lo = big ? 720 : 480, cap = big ? 1080 : 720;
    var need = playerPhysicalHeight() * 0.9, target = lo;
    [480, 720, 1080].forEach(function (s) { if (s <= cap && need > s * 0.85 && s > target) target = s; });
    return { target: target, max: cap, playerPx: playerPhysicalHeight() };
  }
  // Highest available quality <= h (YouTube's available levels for this video). With fps
  // capped at 30 (module 07), 60 fps-only levels are not offered by the player at all.
  function bestAtMost(p, h) {
    var levels = [];
    try { levels = p.getAvailableQualityLevels() || []; } catch (e) {}
    var heights = Object.keys(NAME).map(Number).filter(function (x) { return x <= h && levels.indexOf(NAME[x]) >= 0; });
    return heights.length ? NAME[Math.max.apply(null, heights)] : null;
  }

  var lastKey = '';
  function apply(reason, force) {
    if (TTM.settings.audioOnly) { lastKey = ''; return false; }  // module 24 owns quality then
    var p = player();
    if (!p || typeof p.setPlaybackQualityRange !== 'function' || !TTM.player.currentVideoId()) return false;
    var w = wanted();
    var target = bestAtMost(p, w.target), max = bestAtMost(p, w.max);
    if (!target || !max) return false;  // levels not known yet (player still loading)
    var key = TTM.player.currentVideoId() + '|' + target;
    var cur = null;
    try { cur = p.getPlaybackQuality(); } catch (e) {}
    if (!force && key === lastKey && cur === target) return false;
    try {
      // Pin to the target (<= cap). YouTube still drops lower on its own if the
      // network cannot sustain it.
      p.setPlaybackQualityRange(target, target);
    } catch (e) { TTM.log('quality: setPlaybackQualityRange failed ' + e); return false; }
    lastKey = key;
    stats.applied++;
    stats.last = { reason: reason, target: target, max: max, wanted: w };
    TTM.log('quality: ' + target + ' (cap ' + max + ', ' + reason + (isBig() ? ', fill' : ', normal') + ')');
    return true;
  }

  // New video / quality changed by YouTube / layout changes.
  var resizeTimer = 0;
  function soon(reason) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { apply(reason, false); }, 400);
  }
  document.addEventListener('loadedmetadata', function (e) {
    if (e.target && e.target.tagName === 'VIDEO' && e.target.closest && e.target.closest('#player-container-id')) soon('loadedmetadata');
  }, true);
  window.addEventListener('resize', function () { soon('resize'); });
  document.addEventListener('fullscreenchange', function () { soon('fullscreen'); });
  if (document.documentElement) {
    new MutationObserver(function () { soon('layout'); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  } else {
    TTM.onReady(function () {
      new MutationObserver(function () { soon('layout'); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    });
  }
  TTM.onSettingsChange(function () { apply('setting', true); });
  // Cheap safety net: YouTube may reset the range when it rebuilds the player.
  setInterval(function () { apply('poll', false); }, 3000);

  TTM.quality = { apply: apply, wanted: wanted, stats: stats, isBig: isBig };
})();
