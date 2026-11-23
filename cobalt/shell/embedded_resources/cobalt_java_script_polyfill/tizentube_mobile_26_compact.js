/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 26 (v7e): compact video lists in narrow windows.
 *
 * In the car's middle pane (near-square, ~900x700) m.youtube.com renders search
 * results and feeds as full-width cards with a 16:9 thumbnail as wide as the window,
 * so only one video fits per screen. When the window is narrow or near-square
 * (innerWidth / innerHeight < 1.6, or innerWidth <= 1000 CSS px) <html>.ttm-compact turns
 * every list item into a row: thumbnail 160x90 CSS (16:9) on the left, title (2 lines)
 * + channel / meta on the right, the item's ⋮ menu button kept on the right edge.
 * The whole row stays one link (YouTube's own <a> elements), rows are >= 90 px tall,
 * the ⋮ button keeps its 48x48 box. Wide windows (1280x480 full screen) keep YouTube's
 * layout. Re-evaluated on resize (debounced).
 *
 * Markup (real site, v7e): ytm-video-with-context-renderer > ytm-media-item >
 *   a.media-item-thumbnail-container > ytm-thumbnail-cover
 *   div.media-item-details > div.media-channel (avatar) + div.media-item-info >
 *     div.media-item-metadata > a > h3.media-item-headline + div (byline)
 *     ytm-bottom-sheet-renderer.media-item-menu (⋮)
 * Applies to search results, the home feed (ytm-rich-item-renderer wraps the same
 * ytm-media-item) and the watch page's related list. Shorts shelves are left alone.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.compact) return;

  var CLS = 'ttm-compact';
  var THUMB_W = 160, THUMB_H = 90;
  var H = 'html.' + CLS + ' ';
  var ITEM = 'ytm-media-item';
  TTM.addStyle([
    // Feed grids (home): one column of rows.
    H + 'ytm-rich-grid-renderer .rich-grid-renderer-contents,' + H + '.rich-grid-renderer-contents,',
    H + 'ytm-rich-section-renderer{display:block!important;grid-template-columns:none!important}',
    H + 'ytm-rich-item-renderer{width:auto!important;max-width:none!important;margin:0!important;padding:0!important}',
    // Row layout.
    H + ITEM + '{display:grid!important;grid-template-columns:' + THUMB_W + 'px minmax(0,1fr);',
    'column-gap:12px;align-items:start;padding:6px 12px!important;margin:0!important;min-height:' + (THUMB_H + 12) + 'px;',
    'box-sizing:border-box}',
    H + ITEM + ' > a.media-item-thumbnail-container{grid-column:1;grid-row:1;width:' + THUMB_W + 'px!important;',
    'height:' + THUMB_H + 'px!important;margin:0!important;padding:0!important;border-radius:8px;overflow:hidden}',
    H + ITEM + ' > a.media-item-thumbnail-container ytm-thumbnail-cover,',
    H + ITEM + ' > a.media-item-thumbnail-container .video-thumbnail-container-large{width:' + THUMB_W + 'px!important;',
    'height:' + THUMB_H + 'px!important;padding:0!important;aspect-ratio:auto!important}',
    H + ITEM + ' > a.media-item-thumbnail-container img{width:100%!important;height:100%!important;object-fit:cover!important}',
    H + ITEM + ' > .media-item-details{grid-column:2;grid-row:1;margin:0!important;padding:0!important;min-width:0}',
    // Avatar takes room in a narrow column: drop it, the channel name stays in the byline.
    H + ITEM + ' .media-channel{display:none!important}',
    H + ITEM + ' .media-item-info{min-width:0;align-items:flex-start}',
    H + ITEM + ' .media-item-metadata{min-width:0}',
    H + ITEM + ' h3.media-item-headline{display:-webkit-box!important;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
    'overflow:hidden;margin:0 0 4px!important;font-size:14px!important;line-height:18px!important;max-height:36px}',
    H + ITEM + ' .media-item-metadata > a > div{font-size:12px!important;line-height:16px!important}',
    H + ITEM + ' ytm-bottom-sheet-renderer.media-item-menu{flex:none}',
    // Badges / extra rows under the details eat height in a row layout.
    H + ITEM + ' ytm-badge-and-byline-renderer .ytm-badge,' + H + ITEM + ' .media-item-thumbnail-overlay-bottom{display:none!important}'
  ].join(''));

  var on = null, timer = 0;
  function want() {
    var a = innerHeight > 0 ? innerWidth / innerHeight : 2;
    return a < 1.6 || innerWidth <= 1000;
  }
  function apply(reason) {
    var w = want();
    if (w === on) return;
    on = w;
    if (document.documentElement) document.documentElement.classList.toggle(CLS, w);
    TTM.log('compact: ' + (w ? 'on' : 'off') + ' (' + reason + ', ' + innerWidth + 'x' + innerHeight + ')');
  }
  function soon(reason) { clearTimeout(timer); timer = setTimeout(function () { apply(reason); }, 200); }
  window.addEventListener('resize', function () { soon('resize'); });
  window.addEventListener('orientationchange', function () { soon('orientation'); });
  if (document.documentElement) apply('start');
  else TTM.onReady(function () { apply('ready'); });

  TTM.compact = { apply: apply, want: want, get on() { return on; } };
})();
