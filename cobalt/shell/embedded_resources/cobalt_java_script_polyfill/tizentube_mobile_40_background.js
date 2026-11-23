/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 40: native glue (background playback, native
 * overlay, media keys).
 *
 * Page -> Java (window.TizenTubeMobile, dev.cobalt.coat.javabridge.TizenTubeMobileBridge):
 *   setPlaying(bool)               main <video> playing (leave modes, PiP, notification)
 *   setWatchPage(bool)             on a watch page (native overlay only shows there)
 *   setPlayerRect(x, y, w, h, dpr) visible player box in CSS px (overlay placement and
 *                                  "tap on the video" detection), only when it changes
 *   setMetadata(title, artist, artworkUrl, durationMs)
 *                                  from navigator.mediaSession.metadata (hooked setter);
 *                                  Java uses it only as a fallback, Chromium's MediaSession
 *                                  already forwards metadata + artwork to CobaltMediaSession.
 *
 * Java -> page: window 'ttm-cmd' CustomEvent, detail = one of
 *   play | pause | toggle | next | prev | seek+10 | seek-10 | search | back
 * dispatched by CobaltActivity.sendPageCommand() (native overlay buttons, media keys,
 * steering-wheel keys via the MediaSession, DPAD). Commands use m.youtube.com's
 * #movie_player API (playVideo/pauseVideo/nextVideo/previousVideo/seekBy, verified on
 * the real site) with <video> fallbacks.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.background) return;

  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    try {
      var b = TTM.bridge();
      if (b && typeof b[name] === 'function') return b[name].apply(b, args);
    } catch (e) { /* bridge missing (desktop) */ }
    return undefined;
  }

  // ----------------------------------------------------------- playing
  var last = null;
  function report(playing, why) {
    if (playing === last) return;
    last = playing;
    call('setPlaying', playing);
    TTM.log('background: playing=' + playing + ' (' + why + ')');
  }
  function isMain(v) { return v && v.tagName === 'VIDEO' && v.closest && v.closest('#player-container-id'); }
  ['playing', 'play'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (isMain(e.target) && TTM.player.currentVideoId()) report(true, t); }, true);
  });
  ['pause', 'ended', 'emptied', 'abort', 'error'].forEach(function (t) {
    document.addEventListener(t, function (e) { if (isMain(e.target)) report(false, t); }, true);
  });

  // ------------------------------------------------ watch page + rect
  var lastWatch = null, lastRect = '';
  function playerRect() {
    var c = document.getElementById('player-container-id');
    if (!c) return null;
    var r = c.getBoundingClientRect();
    var x = Math.max(0, r.left), y = Math.max(0, r.top);
    var w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
    if (w < 40 || h < 40) return null;
    return [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
  }
  function poll() {
    var watch = !!TTM.player.currentVideoId();
    if (watch !== lastWatch) {
      lastWatch = watch;
      call('setWatchPage', watch);
      TTM.log('background: watchPage=' + watch);
    }
    var v = TTM.player.getVideo();
    report(!!(watch && v && isMain(v) && !v.paused && !v.ended), 'poll');
    if (!watch) { lastRect = ''; return; }
    var r = playerRect();
    var key = r ? r.join(',') : 'none';
    if (key !== lastRect) {
      lastRect = key;
      if (r) call('setPlayerRect', r[0], r[1], r[2], r[3], window.devicePixelRatio || 1);
      else call('setPlayerRect', 0, 0, 0, 0, window.devicePixelRatio || 1);
    }
  }
  setInterval(poll, 500);
  window.addEventListener('scroll', function () { lastRect = lastRect && lastRect + '?'; }, { passive: true });

  // ------------------------------------------- mediaSession metadata hook
  var meta = null;
  function publishMeta(md) {
    if (!md) return;
    var art = '';
    try {
      var list = (md.artwork || []).slice().sort(function (a, b) {
        return (parseInt(a.sizes, 10) || 0) - (parseInt(b.sizes, 10) || 0);
      });
      // Smallest artwork >= 96 px wide (car widgets are small); else the first.
      var pick = list.filter(function (a) { return (parseInt(a.sizes, 10) || 0) >= 96; })[0] || list[0];
      art = pick ? pick.src : '';
    } catch (e) { /* ignore */ }
    var p = document.getElementById('movie_player');
    var dur = 0;
    try { dur = Math.round(((p && p.getDuration && p.getDuration()) || 0) * 1000); } catch (e) {}
    meta = { title: md.title || '', artist: md.artist || '', artwork: art, durationMs: dur };
    call('setMetadata', meta.title, meta.artist, meta.artwork, meta.durationMs);
    TTM.log('background: metadata "' + meta.title + '" / ' + meta.artist);
  }
  (function hookMediaSession() {
    var proto = window.MediaSession && MediaSession.prototype;
    var d = proto && Object.getOwnPropertyDescriptor(proto, 'metadata');
    if (!d || !d.set || !d.configurable) return;
    Object.defineProperty(proto, 'metadata', {
      configurable: true, enumerable: d.enumerable,
      get: d.get,
      set: function (v) {
        d.set.call(this, v);
        try { publishMeta(v); } catch (e) { /* never break the page */ }
      }
    });
  })();

  // --------------------------------------------------- command channel
  function player() { return document.getElementById('movie_player'); }
  function video() { return TTM.player.getVideo(); }
  function isPlaying() {
    var p = player();
    try { if (p && p.getPlayerState) return p.getPlayerState() === 1; } catch (e) {}
    var v = video();
    return !!(v && !v.paused);
  }
  function seekBy(sec) {
    var p = player();
    if (p && typeof p.seekBy === 'function') { p.seekBy(sec); return 'seekBy'; }
    var v = video();
    if (v) { v.currentTime = Math.max(0, v.currentTime + sec); return 'currentTime'; }
    return 'none';
  }
  var COMMANDS = {
    play: function () { var p = player(); if (p && p.playVideo) p.playVideo(); else if (video()) video().play(); },
    pause: function () { var p = player(); if (p && p.pauseVideo) p.pauseVideo(); else if (video()) video().pause(); },
    toggle: function () { (isPlaying() ? COMMANDS.pause : COMMANDS.play)(); },
    next: function () { var p = player(); if (p && p.nextVideo) p.nextVideo(); },
    prev: function () {
      var p = player(), v = video();
      // YouTube semantics: restart if > 3 s in, else previous video (or back). Use the
      // player's clock: right after a SponsorBlock skip / during buffering video.currentTime
      // and YouTube's time can disagree.
      var t = 0;
      try { t = p && p.getCurrentTime ? p.getCurrentTime() : (v ? v.currentTime : 0); } catch (e) { t = v ? v.currentTime : 0; }
      if (t > 3) { if (p && p.seekTo) p.seekTo(0, true); else if (v) v.currentTime = 0; return 'restart'; }
      var hasPlaylist = false;
      try { hasPlaylist = !!(p && p.getPlaylist && p.getPlaylist() && p.getPlaylist().length); } catch (e) {}
      if (hasPlaylist && p.previousVideo) { p.previousVideo(); return 'previousVideo'; }
      history.back();
      return 'history';
    },
    'seek+10': function () { return seekBy(10); },
    'seek-10': function () { return seekBy(-10); },
    search: function () {
      if (TTM.layout && TTM.layout.mode !== 'off') TTM.layout.exit('search', true);
      var btn = document.querySelector('ytm-mobile-topbar-renderer button[aria-label="Tìm trên YouTube"],' +
        ' ytm-mobile-topbar-renderer .topbar-button-search-button, ytm-mobile-topbar-renderer button.icon-button[aria-label*="Tìm"],' +
        ' ytm-mobile-topbar-renderer button[aria-label*="Search"]');
      if (btn) { btn.click(); return 'button'; }
      location.href = '/results?search_query=';
      return 'navigate';
    },
    back: function () {
      var h = window.__tizentubeMobileHandleBack;
      if (typeof h === 'function' && h() === true) return 'overlay';
      history.back();
      return 'history';
    }
  };
  var cmdLog = [];
  window.addEventListener('ttm-cmd', function (e) {
    var name = e.detail && (typeof e.detail === 'string' ? e.detail : e.detail.cmd);
    var fn = COMMANDS[name];
    if (!fn) { TTM.log('cmd: unknown ' + name); return; }
    var how;
    try { how = fn(); } catch (err) { TTM.log('cmd: ' + name + ' failed ' + err); return; }
    cmdLog.push(name);
    TTM.log('cmd: ' + name + (how ? ' (' + how + ')' : ''));
  });

  TTM.background = {
    report: report, poll: poll, commands: COMMANDS, cmdLog: cmdLog,
    get playing() { return last; }, get meta() { return meta; }, playerRect: playerRect
  };
})();
