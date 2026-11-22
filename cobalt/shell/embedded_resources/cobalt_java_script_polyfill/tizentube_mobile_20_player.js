/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 20: SponsorBlock auto-skip with an
 * "Hoàn tác" (undo) toast, and the default playback speed.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.player) return;
  var CONFIG = TTM.CONFIG, S = TTM.STRINGS;

  /** The main video element of m.youtube.com's HTML5 player. */
  function getVideo() {
    return document.querySelector('#movie_player video, .html5-video-player video, video.html5-main-video') ||
      document.querySelector('video');
  }

  function isAdShowing() {
    var p = document.querySelector('.html5-video-player');
    return !!(p && p.classList.contains('ad-showing'));
  }

  function currentVideoId() {
    var m = location.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/);
    if (m) return m[1];
    var v = new URLSearchParams(location.search).get('v');
    return v && /^[\w-]{11}$/.test(v) ? v : null;
  }

  // ---------------------------------------------------------------- toast
  TTM.addStyle([
    '#ttm-skip-toast{position:fixed;left:50%;bottom:72px;transform:translateX(-50%);',
    'z-index:2147483646;display:flex;align-items:center;gap:12px;max-width:90vw;',
    'padding:6px 6px 6px 16px;border-radius:24px;background:rgba(28,28,28,.92);color:#fff;',
    'font:500 14px/1.3 Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);',
    'opacity:0;pointer-events:none;transition:opacity .2s}',
    '#ttm-skip-toast.ttm-show{opacity:1;pointer-events:auto}',
    '#ttm-skip-toast button{min-width:48px;min-height:40px;padding:0 14px;border:0;border-radius:20px;',
    'background:transparent;color:#3ea6ff;font:600 14px Roboto,Arial,sans-serif;cursor:pointer}',
    '#ttm-skip-toast button:active{background:rgba(255,255,255,.12)}'
  ].join(''));

  var toastEl = null, toastTimer = 0, toastUndo = null;
  function showSkipToast(segment, onUndo) {
    if (!toastEl) {
      toastEl = TTM.el('div', { id: 'ttm-skip-toast', role: 'status' }, [
        TTM.el('span', { 'class': 'ttm-text' }),
        TTM.el('button', { type: 'button' }, [S.undo])
      ]);
      toastEl.querySelector('button').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var fn = toastUndo;
        hideToast();
        if (fn) fn();
      });
    }
    var parent = TTM.overlayParent();
    if (toastEl.parentNode !== parent) parent.appendChild(toastEl);
    toastEl.querySelector('.ttm-text').textContent = S.skipped[segment.category] || S.skipped._default;
    toastUndo = onUndo;
    toastEl.classList.add('ttm-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, CONFIG.SKIP_TOAST_MS);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    toastUndo = null;
    if (toastEl) toastEl.classList.remove('ttm-show');
  }

  // --------------------------------------------------------- SponsorBlock
  var sb = {
    videoId: null,
    segments: [],
    // UUIDs undone by the user: not skipped again until playback leaves them.
    suppressed: {},
    fetchFn: function (url) { return fetch(url, { credentials: 'omit' }); }
  };

  function enabledCategories() {
    return CONFIG.SPONSORBLOCK_CATEGORIES.filter(function (c) { return TTM.settings.sbCategories[c]; });
  }

  function loadSegments(videoId) {
    sb.videoId = videoId;
    sb.segments = [];
    sb.suppressed = {};
    hideToast();
    if (!videoId || !TTM.settings.sponsorblock) return Promise.resolve([]);
    var url = CONFIG.SPONSORBLOCK_API + '?videoID=' + encodeURIComponent(videoId) +
      '&categories=' + encodeURIComponent(JSON.stringify(CONFIG.SPONSORBLOCK_CATEGORIES)) +
      '&actionTypes=' + encodeURIComponent(JSON.stringify(['skip', 'mute']));
    return sb.fetchFn(url).then(function (r) {
      if (r.status === 404) return [];  // No segments for this video.
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (list) {
      if (sb.videoId !== videoId) return [];  // Navigated away meanwhile.
      sb.segments = (Array.isArray(list) ? list : []).filter(function (s) {
        return s && Array.isArray(s.segment) && s.segment[1] > s.segment[0] &&
          (!s.actionType || s.actionType === 'skip' || s.actionType === 'mute');
      }).sort(function (a, b) { return a.segment[0] - b.segment[0]; });
      TTM.log('sponsorblock: ' + sb.segments.length + ' segment(s) for ' + videoId);
      return sb.segments;
    }).catch(function (e) {
      console.warn('[TizenTube] SponsorBlock request failed', e);
      return [];
    });
  }

  var mutedSegment = null;
  function checkSegments() {
    var video = getVideo();
    if (!video || !TTM.settings.sponsorblock || isAdShowing() || !sb.segments.length) return;
    var t = video.currentTime;
    var cats = enabledCategories();
    var inMute = null;
    for (var i = 0; i < sb.segments.length; i++) {
      var s = sb.segments[i];
      var start = s.segment[0], end = s.segment[1];
      var inside = t >= start && t < end - CONFIG.SKIP_EPSILON_S;
      if (!inside) {
        delete sb.suppressed[s.UUID];
        continue;
      }
      if (cats.indexOf(s.category) < 0 || sb.suppressed[s.UUID]) continue;
      if (s.actionType === 'mute') { inMute = s; continue; }
      skipSegment(video, s);
      return;
    }
    // "mute" segments: mute while inside, restore afterwards.
    if (inMute && !mutedSegment) { mutedSegment = inMute; video.muted = true; }
    if (!inMute && mutedSegment) { mutedSegment = null; video.muted = false; }
  }

  function skipSegment(video, s) {
    var start = s.segment[0], end = s.segment[1];
    if (isFinite(video.duration) && end >= video.duration - 0.5) end = video.duration;
    video.currentTime = end;
    TTM.log('sponsorblock: skipped ' + s.category + ' ' + start.toFixed(1) + '→' + end.toFixed(1));
    showSkipToast(s, function () {
      sb.suppressed[s.UUID] = true;  // Undo once: do not re-skip this segment right away.
      video.currentTime = start;
      if (video.paused) video.play().catch(function () {});
      TTM.log('sponsorblock: undo ' + s.category);
    });
  }

  // ------------------------------------------------------------- speed
  function applySpeed(video) {
    video = video || getVideo();
    if (!video || isAdShowing()) return;
    var rate = TTM.settings.speed;
    if (video.playbackRate !== rate) video.playbackRate = rate;
  }

  // Media events do not bubble; capture them on the document for any <video>.
  document.addEventListener('loadedmetadata', function (e) {
    if (e.target && e.target.tagName === 'VIDEO') {
      applySpeed(e.target);
      // The player may reset the rate right after load; apply once more.
      setTimeout(function () { applySpeed(e.target); }, 800);
    }
  }, true);
  TTM.onSettingsChange(function () { applySpeed(); });

  // --------------------------------------------------- navigation watch
  var lastVideoId = null;
  function tick() {
    var id = currentVideoId();
    if (id !== lastVideoId) {
      lastVideoId = id;
      loadSegments(id);
    }
    checkSegments();
  }
  TTM.onReady(function () {
    tick();
    setInterval(tick, 250);
    document.addEventListener('timeupdate', function (e) {
      if (e.target && e.target.tagName === 'VIDEO') checkSegments();
    }, true);
  });
  TTM.onSettingsChange(function () {
    // Re-fetch when SponsorBlock is turned on for the current video.
    if (TTM.settings.sponsorblock && sb.videoId && !sb.segments.length) loadSegments(sb.videoId);
  });

  TTM.player = {
    getVideo: getVideo, currentVideoId: currentVideoId, sponsorblock: sb, loadSegments: loadSegments,
    checkSegments: checkSegments, showSkipToast: showSkipToast, applySpeed: applySpeed
  };
})();
