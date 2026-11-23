/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 40: background playback glue.
 *
 * Keeps Java informed about whether the main <video> is playing, through
 * window.TizenTubeMobile.setPlaying(boolean). CobaltActivity combines this with the
 * Chromium MediaSession state (CobaltMediaSession) to decide, when the user leaves
 * the app ("Khi chuyển app"):
 *   - 'audio': keep the renderer visible + start MediaPlaybackService (foreground
 *     notification, play/pause) so audio continues; no PiP window;
 *   - 'pip':   enter picture-in-picture (falls back to 'audio' if unsupported,
 *     in multi-window, or on API < 26);
 *   - 'stop':  stock Cobalt behaviour (WebContents hidden, media pauses).
 * The page side of "keep playing" (no pause on visibilitychange/blur) is module 05.
 *
 * Replaces the v5 module 40 (vertical volume/brightness swipes), which was
 * removed in v6 together with its HUD and the 32 px edge exclusion.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.background) return;

  var last = null;
  function report(playing, why) {
    if (playing === last) return;
    last = playing;
    try {
      var b = TTM.bridge();
      if (b && typeof b.setPlaying === 'function') b.setPlaying(playing);
    } catch (e) { /* bridge missing (desktop) */ }
    TTM.log('background: playing=' + playing + ' (' + why + ')');
  }

  function isMain(v) { return v && v.tagName === 'VIDEO' && v.closest && v.closest('#player-container-id'); }
  ['playing', 'play'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (isMain(e.target)) report(true, t); }, true);
  });
  ['pause', 'ended', 'emptied', 'abort', 'error'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (isMain(e.target)) report(false, t); }, true);
  });
  // Left the watch page (SPA navigation) while the player element stays around.
  setInterval(function () {
    var v = TTM.player && TTM.player.getVideo();
    var playing = !!(v && isMain(v) && !v.paused && !v.ended && TTM.player.currentVideoId());
    report(playing, 'poll');
  }, 1000);

  TTM.background = { report: report, get playing() { return last; } };
})();
