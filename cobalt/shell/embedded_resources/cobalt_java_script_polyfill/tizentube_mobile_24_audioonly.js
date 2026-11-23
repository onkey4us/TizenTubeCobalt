/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 24 (v7c): "Chỉ nghe" (audio only) and comments.
 *
 * Chỉ nghe (settings.audioOnly):
 *   - video quality pinned to the lowest level (144p 'tiny', else the lowest available)
 *     through movie_player.setPlaybackQualityRange (module 22 yields while this is on);
 *   - the <video> pixels are hidden with opacity:0 (NOT paused, NOT display:none, so
 *     playback, audio and YouTube's controls keep working) and the current video's
 *     artwork (i.ytimg.com hqdefault, maxres when available) + title are shown in the
 *     player area instead;
 *   - persists across videos (re-applied on every new video id);
 *   - turning it off restores the "Chất lượng" behaviour (module 22) and the picture.
 * Quick toggle: a 48 px row "Chỉ nghe" / "Hiện hình" placed directly UNDER the player in
 * the normal watch layout (car split pane). m.youtube.com keeps #player-container-id
 * position:fixed under the header and reserves its space with an in-flow placeholder; the
 * row goes at the top of `.watch-below-the-player` (the in-flow block right after that
 * placeholder), so it is below the player and never overlaps the native overlay
 * (TizenTubeOverlay, sized to the player box) or YouTube's seek bar. In wide fill mode
 * there is no space under the player; use the settings sheet.
 *
 * Comments (settings.comments, default false): m.youtube.com's watch page shows a
 * "Bình luận" card under the action row: a yt-video-metadata-carousel-view-model whose
 * item is a yt-comment-teaser-carousel-item-view-model (seen on the real site, v7d), or
 * on other layouts comments-entry-point-teaser-view-model / ytm-comment-section-renderer.
 * They load the first comments with an extra request. We hide the comments section with CSS (no
 * layout) and remove its renderer subtree when YouTube inserts it, so its lazy loader
 * never becomes visible and never fires. A "Bình luận" row shows them on demand for the
 * current video.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.audioOnly) return;
  var S = TTM.STRINGS;

  var COMMENT_SEL = [
    'comments-entry-point-teaser-view-model', 'yt-comment-teaser-carousel-item-view-model',
    'yt-video-metadata-carousel-view-model[data-ttm-comments]',
    'ytm-comments-entry-point-header-renderer', 'ytm-comment-section-renderer',
    'ytm-item-section-renderer[section-identifier="comment-item-section"]',
    'ytm-comment-thread-renderer', 'ytm-comments-header-renderer',
    'ytm-engagement-panel-section-list-renderer[panel-target-id*="comment"]'
  ];
  TTM.addStyle([
    // Audio only: hide the pixels, keep the element playing.
    'html.ttm-audio-only #player-container-id video{opacity:0!important}',
    '#ttm-artwork{display:none;position:absolute;inset:0;z-index:1;pointer-events:none;',
    'background:#000 center/contain no-repeat;align-items:flex-end;justify-content:center}',
    'html.ttm-audio-only #ttm-artwork{display:flex}',
    '#ttm-artwork span{margin:0 0 56px;padding:6px 12px;max-width:90%;border-radius:8px;',
    'background:rgba(0,0,0,.85);color:#fff;font:500 15px/1.3 Roboto,Arial,sans-serif;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // Quick toggle row under the player.
    '.ttm-row{display:flex;align-items:center;gap:8px;padding:4px 12px}',
    '.ttm-chip{min-height:48px;min-width:48px;padding:0 16px;border-radius:24px;',
    'border:1px solid rgba(127,127,127,.45);background:transparent;color:inherit;',
    'font:500 14px Roboto,Arial,sans-serif;cursor:pointer}',
    '.ttm-chip[aria-pressed="true"]{background:#3ea6ff;border-color:#3ea6ff;color:#0f0f0f}',
    'html.ttm-fill .ttm-row{display:none!important}',
    // Comments: hidden unless shown for this video.
    'html:not(.ttm-comments) ' + COMMENT_SEL.join(',html:not(.ttm-comments) ') + '{display:none!important}',
    'html.ttm-comments .ttm-comments-row{display:none}'
  ].join(''));

  var stats = { removedComments: 0, applied: 0 };
  function player() { return document.getElementById('movie_player'); }
  function videoId() { return TTM.player && TTM.player.currentVideoId(); }

  // -------------------------------------------------------------- audio only
  var art = null;
  function ensureArtwork() {
    var p = player();
    if (!p || !videoId()) return;
    if (!art || !p.contains(art)) {
      art = TTM.el('div', { id: 'ttm-artwork', 'aria-hidden': 'true' }, [TTM.el('span')]);
      p.appendChild(art);
    }
    var id = videoId();
    if (art.getAttribute('data-vid') !== id) {
      art.setAttribute('data-vid', id);
      var base = 'https://i.ytimg.com/vi/' + id + '/';
      // hqdefault always exists; try maxres first and fall back.
      art.style.backgroundImage = 'url("' + base + 'maxresdefault.jpg"), url("' + base + 'hqdefault.jpg")';
      var title = '';
      try { var d = p.getVideoData && p.getVideoData(); title = (d && d.title) || ''; } catch (e) {}
      if (!title && navigator.mediaSession && navigator.mediaSession.metadata) title = navigator.mediaSession.metadata.title || '';
      art.firstChild.textContent = title;
    }
  }
  function lowest(p) {
    var levels = [];
    try { levels = p.getAvailableQualityLevels() || []; } catch (e) {}
    var order = ['tiny', 'small', 'medium', 'large', 'hd720', 'hd1080'];
    for (var i = 0; i < order.length; i++) if (levels.indexOf(order[i]) >= 0) return order[i];
    return null;
  }
  var lastKey = '';
  function applyAudioOnly(reason) {
    var on = !!TTM.settings.audioOnly;
    document.documentElement.classList.toggle('ttm-audio-only', on && !!videoId());
    if (!on || !videoId()) { lastKey = ''; return; }
    ensureArtwork();
    var p = player();
    if (!p || typeof p.setPlaybackQualityRange !== 'function') return;
    var q = lowest(p);
    if (!q) return;
    var cur = null;
    try { cur = p.getPlaybackQuality(); } catch (e) {}
    var key = videoId() + '|' + q;
    if (key === lastKey && cur === q) return;
    try { p.setPlaybackQualityRange(q, q); } catch (e) { return; }
    lastKey = key;
    stats.applied++;
    TTM.log('audioOnly: quality ' + q + ' (' + reason + ')');
  }
  function setAudioOnly(on) {
    TTM.setSetting('audioOnly', !!on);
    if (!on && TTM.quality) TTM.quality.apply('audio only off', true);
  }

  // ------------------------------------------------------------- comments
  var commentsVid = null;
  function commentsAllowed() { return TTM.settings.comments || (commentsVid && commentsVid === videoId()); }
  // The metadata carousel is generic: mark only the one that holds a comment teaser.
  function markCommentCarousels(root) {
    var teasers = (root || document).querySelectorAll('yt-comment-teaser-carousel-item-view-model');
    for (var i = 0; i < teasers.length; i++) {
      var host = teasers[i].closest('yt-video-metadata-carousel-view-model');
      if (host && !host.hasAttribute('data-ttm-comments')) host.setAttribute('data-ttm-comments', '');
    }
  }
  function stripComments(root) {
    markCommentCarousels(root);
    if (commentsAllowed()) return;
    for (var i = 0; i < COMMENT_SEL.length; i++) {
      var list = (root || document).querySelectorAll(COMMENT_SEL[i]);
      for (var j = 0; j < list.length; j++) {
        // Empty the subtree so its lazy loader (IntersectionObserver / continuation) has
        // nothing to observe; keep the host element so YouTube's own code does not throw.
        if (list[j].firstChild) { while (list[j].firstChild) list[j].removeChild(list[j].firstChild); stats.removedComments++; }
      }
    }
  }

  // ------------------------------------------------------- quick toggles
  var row = null, chip = null, commentsChip = null;
  function ensureRow() {
    var c = document.getElementById('player-container-id');
    if (!c || !videoId()) { if (row) row.remove(); return; }
    if (!row) {
      chip = TTM.el('button', { type: 'button', 'class': 'ttm-chip', 'data-ttm-audio-toggle': '' });
      chip.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); setAudioOnly(!TTM.settings.audioOnly); });
      commentsChip = TTM.el('button', { type: 'button', 'class': 'ttm-chip ttm-comments-row' }, [S.commentsShow]);
      commentsChip.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        commentsVid = videoId();
        document.documentElement.classList.add('ttm-comments');
        TTM.log('comments: shown for ' + commentsVid + ' (YouTube may need a scroll to load them)');
      });
      row = TTM.el('div', { 'class': 'ttm-row', role: 'toolbar' }, [chip, commentsChip]);
    }
    // First thing in the in-flow block below the player (the player itself is fixed).
    var below = document.querySelector('.watch-below-the-player');
    if (below) {
      if (below.firstElementChild !== row) below.insertBefore(row, below.firstChild);
    } else if (row.previousElementSibling !== c) {
      c.insertAdjacentElement('afterend', row);  // harness / other layouts
    }
    var on = !!TTM.settings.audioOnly;
    chip.textContent = on ? S.audioOnlyOff : S.audioOnlyShort;
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  var lastVid = null;
  function tick(reason) {
    var id = videoId();
    if (id !== lastVid) {
      lastVid = id;
      if (commentsVid !== id) document.documentElement.classList.toggle('ttm-comments', !!TTM.settings.comments);
    }
    applyAudioOnly(reason);
    ensureRow();
    stripComments();
  }
  document.addEventListener('loadedmetadata', function (e) {
    if (e.target && e.target.tagName === 'VIDEO') setTimeout(function () { tick('loadedmetadata'); }, 300);
  }, true);
  TTM.onSettingsChange(function () { tick('setting'); });
  var queued = false;
  TTM.onReady(function () {
    tick('ready');
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; stripComments(); ensureRow(); });
    }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    setInterval(function () { tick('poll'); }, 1500);
  });

  TTM.audioOnly = { set: setAudioOnly, apply: applyAudioOnly, stats: stats, get active() { return !!TTM.settings.audioOnly; } };
})();
