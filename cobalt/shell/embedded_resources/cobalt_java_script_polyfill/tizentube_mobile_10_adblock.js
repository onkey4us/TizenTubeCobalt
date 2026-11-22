/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 10: ad blocking for m.youtube.com.
 *
 * Layers (each one is a fallback for the previous):
 *  1. Data: strip ad fields from player/browse responses before YouTube reads
 *     them (ytInitialPlayerResponse / ytInitialData globals, JSON.parse,
 *     Response.prototype.json). No ad data means no ad break is scheduled.
 *  2. CSS: hide feed / companion / overlay ad renderers.
 *  3. Player: if an ad still plays (.ad-showing), click Skip when present,
 *     otherwise mute and jump to the end of the ad.
 * Must run at document start so the hooks exist before YouTube's own scripts.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.adblock) return;

  var PLAYER_AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  var AD_ITEM_KEYS = ['adSlotRenderer', 'promotedSparklesWebRenderer', 'promotedVideoRenderer',
    'compactPromotedVideoRenderer', 'searchPyvRenderer', 'bannerPromoRenderer',
    'statementBannerRenderer', 'brandVideoSingletonRenderer', 'brandVideoShelfRenderer',
    'adBreakServiceRenderer', 'inFeedAdLayoutRenderer'];
  var stats = { pruned: 0, skipped: 0 };

  function enabled() { return TTM.settings.adblock; }

  function isAdItem(item) {
    if (!item || typeof item !== 'object') return false;
    for (var i = 0; i < AD_ITEM_KEYS.length; i++) {
      if (AD_ITEM_KEYS[i] in item) return true;
    }
    // richItemRenderer / itemSectionRenderer wrappers around an ad.
    var inner = item.richItemRenderer && item.richItemRenderer.content;
    if (inner && isAdItem(inner)) return true;
    var sec = item.itemSectionRenderer && item.itemSectionRenderer.contents;
    return !!(sec && sec.length === 1 && isAdItem(sec[0]));
  }

  /** Recursively removes ad fields. Depth-limited (16 covers m.youtube.com browse/search responses). */
  function prune(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 16) return obj;
    if (Array.isArray(obj)) {
      for (var i = obj.length - 1; i >= 0; i--) {
        if (isAdItem(obj[i])) { obj.splice(i, 1); stats.pruned++; } else prune(obj[i], depth + 1);
      }
      return obj;
    }
    for (var k = 0; k < PLAYER_AD_KEYS.length; k++) {
      if (PLAYER_AD_KEYS[k] in obj) { delete obj[PLAYER_AD_KEYS[k]]; stats.pruned++; }
    }
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        var v = obj[key];
        if (v && typeof v === 'object') prune(v, depth + 1);
      }
    }
    return obj;
  }

  function looksLikeYouTubeData(o) {
    return o && typeof o === 'object' && !Array.isArray(o) &&
      ('playabilityStatus' in o || 'playerResponse' in o || 'contents' in o ||
       'onResponseReceivedActions' in o || 'onResponseReceivedEndpoints' in o ||
       'adPlacements' in o || 'playerAds' in o || 'responseContext' in o);
  }

  function maybePrune(o) {
    if (enabled() && looksLikeYouTubeData(o)) {
      try { prune(o, 0); } catch (e) { console.warn('[TizenTube] prune failed', e); }
    }
    return o;
  }

  // 1a. Inline page data: `var ytInitialPlayerResponse = {...}` assigns through our setter.
  ['ytInitialPlayerResponse', 'ytInitialData'].forEach(function (name) {
    var value = window[name];
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: function () { return value; },
        set: function (v) { value = maybePrune(v); }
      });
    } catch (e) { /* already non-configurable */ }
  });

  // 1b. JSON.parse (XHR / text responses and the ytcfg payloads).
  var origParse = JSON.parse;
  JSON.parse = function () {
    return maybePrune(origParse.apply(this, arguments));
  };

  // 1c. fetch(): Response.json() does not go through JSON.parse.
  if (window.Response && Response.prototype.json) {
    var origJson = Response.prototype.json;
    Response.prototype.json = function () {
      return origJson.apply(this, arguments).then(maybePrune);
    };
  }

  // 2. Cosmetic hiding.
  var CSS_SELECTORS = [
    'ytm-promoted-sparkles-web-renderer', 'ytm-promoted-sparkles-text-search-renderer',
    'ytm-promoted-video-renderer', 'ytm-companion-ad-renderer', 'ytm-companion-slot',
    'ad-slot-renderer', 'ytm-ad-slot-renderer', 'ytm-in-feed-ad-layout-renderer',
    'ytm-statement-banner-renderer', 'ytm-banner-promo-renderer', 'ytm-brand-video-singleton-renderer',
    'ytm-rich-item-renderer:has(> ad-slot-renderer)', 'ytm-item-section-renderer:has(ad-slot-renderer)',
    '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot', '.ytp-ad-image-overlay',
    '.ytp-featured-product', '.ytp-suggested-action', '#player-ads', '.masthead-ad'
  ];
  var styleEl = null;
  function applyCss() {
    if (enabled() && !styleEl) {
      styleEl = TTM.addStyle(CSS_SELECTORS.join(',\n') + ' { display: none !important; }');
    } else if (!enabled() && styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  }

  // 3. Ads that still play.
  var SKIP_SELECTORS = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button,' +
    ' .ytp-ad-skip-button-container button, .videoAdUiSkipButton, button[class*="skip-ad"]';
  var mutedByUs = false;
  var rateByUs = false;
  function handlePlayingAd() {
    if (!enabled()) return;
    var player = document.querySelector('.html5-video-player');
    var adShowing = !!(player && (player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')));
    var video = player && player.querySelector('video');
    if (!adShowing) {
      if (mutedByUs && video) { video.muted = false; mutedByUs = false; }
      if (rateByUs && video) { video.playbackRate = TTM.settings.speed; rateByUs = false; }
      return;
    }
    var skip = document.querySelector(SKIP_SELECTORS);
    if (skip) { skip.click(); stats.skipped++; TTM.log('ad: clicked skip'); return; }
    if (video) {
      if (!video.muted) { video.muted = true; mutedByUs = true; }
      if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.2) {
        video.currentTime = video.duration - 0.1;
        stats.skipped++;
        TTM.log('ad: jumped to end');
      } else {
        try {
          video.playbackRate = TTM.CONFIG.AD_FAST_FORWARD_RATE;
          rateByUs = true;
        } catch (e) { /* ignore */ }
      }
    }
  }

  TTM.onReady(function () {
    applyCss();
    setInterval(handlePlayingAd, TTM.CONFIG.POLL_MS);
  });
  TTM.onSettingsChange(applyCss);

  TTM.adblock = { prune: prune, isAdItem: isAdItem, stats: stats, handlePlayingAd: handlePlayingAd };
})();
