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
    // Contrast (designer v4/v5): 85% opaque black panel, pure white text, bold button.
    // Worst case (white video behind): panel ≈ #262626, text 15:1, button 5.9:1.
    // v5: the panel used to FADE IN (opacity 0→1 over 200 ms). For the first frames the
    // whole toast — panel, text and button — was semi-transparent over the video, which
    // reads as "faint text on a coloured background" (e.g. the teal Despacito frame).
    // Now it appears at full opacity immediately and only fades OUT. !important keeps
    // page CSS from overriding the panel/text colours.
    'html body #ttm-skip-toast{position:fixed!important;left:50%!important;bottom:72px!important;',
    'transform:translateX(-50%)!important;z-index:2147483646!important;display:flex!important;',
    'align-items:center;gap:12px;max-width:90vw;box-sizing:border-box;',
    'padding:6px 6px 6px 18px;border-radius:24px;',
    'background:rgba(0,0,0,.85)!important;background-image:none!important;color:#fff!important;',
    'border:1px solid rgba(255,255,255,.22);',
    'font:500 15px/1.3 Roboto,Arial,sans-serif!important;box-shadow:0 2px 12px rgba(0,0,0,.6);',
    'text-shadow:0 1px 2px rgba(0,0,0,.6);filter:none!important;backdrop-filter:none!important;',
    'mix-blend-mode:normal!important;',
    'opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s,visibility 0s .2s}',
    'html body #ttm-skip-toast.ttm-show{opacity:1!important;visibility:visible!important;',
    'pointer-events:auto;transition:none!important}',
    'html body #ttm-skip-toast .ttm-text{color:#fff!important;opacity:1!important}',
    'html body #ttm-skip-toast button{min-width:48px;min-height:40px;padding:0 16px;border:0;border-radius:20px;',
    'background:rgba(138,196,255,.22)!important;color:#a8d4ff!important;',
    'font:700 15px Roboto,Arial,sans-serif!important;letter-spacing:.2px;cursor:pointer;opacity:1!important}',
    'html body #ttm-skip-toast button:active{background:rgba(138,196,255,.4)!important}'
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
