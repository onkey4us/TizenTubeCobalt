/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 30: "Cài đặt TizenTube" entry inside
 * m.youtube.com's account menu, and the settings sheet. No floating buttons.
 *
 * Selector strategy (m.youtube.com markup changes over time, so we only rely
 * on stable custom-element tag names, never on generated class names):
 *  - Primary: the account menu opened from the avatar / account icon.
 *    Containers: ytm-multi-page-menu-renderer, ytm-account-section-list-renderer,
 *    ytm-account-menu (older). We add our row before the first
 *    ytm-compact-link-renderer of the container (or append it).
 *  - Signed out there is no avatar/account menu. The account section is then
 *    the "Bạn" (You) tab, /feed/library, which shows
 *    ytm-sign-in-promo-with-background-renderer; we add the row as a list
 *    item above that promo (inline, scrolls with the page, not floating).
 *  - Fallback: the player settings / overflow bottom sheet
 *    (ytm-bottom-sheet-renderer, ytm-menu-popup-renderer, .player-settings-menu).
 *  A MutationObserver on <body> re-injects whenever YouTube re-renders a menu.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.settingsUi) return;
  var S = TTM.STRINGS, CONFIG = TTM.CONFIG;

  var ACCOUNT_MENU_SELECTORS = ['ytm-multi-page-menu-renderer', 'ytm-account-section-list-renderer',
    'ytm-account-menu'];
  var FALLBACK_MENU_SELECTORS = ['ytm-bottom-sheet-renderer', 'ytm-menu-popup-renderer',
    '.player-settings-menu'];
  // Signed-out "Bạn" tab (/feed/library): insert before the sign-in promo.
  var SIGNED_OUT_ANCHORS = ['ytm-sign-in-promo-with-background-renderer', 'ytm-sign-in-promo-renderer'];
  var ROW_ATTR = 'data-ttm-entry';

  TTM.addStyle([
    '.ttm-entry{display:flex;align-items:center;gap:24px;width:100%;min-height:48px;padding:0 16px;',
    'box-sizing:border-box;border:0;background:transparent;color:inherit;text-align:left;',
    'font:400 14px/1.4 Roboto,Arial,sans-serif;cursor:pointer}',
    '.ttm-entry:active{background:rgba(127,127,127,.2)}',
    '.ttm-entry svg{width:24px;height:24px;flex:none;fill:currentColor}',
    '#ttm-sheet-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);',
    'display:flex;align-items:center;justify-content:center}',
    // Landscape phones are ~360-412 CSS px tall: cap at 85% of the viewport, keep the
    // header (title + ✕) fixed and scroll only the body (designer v4).
    '#ttm-sheet{display:flex;flex-direction:column;width:min(520px,92vw);max-height:85vh;',
    'max-height:85dvh;overflow:hidden;border-radius:12px;',
    'background:#212121;color:#f1f1f1;font:400 14px/1.4 Roboto,Arial,sans-serif;',
    'box-shadow:0 4px 24px rgba(0,0,0,.5)}',
    '#ttm-sheet .ttm-head{flex:none;display:flex;align-items:center;justify-content:space-between;',
    'gap:8px;padding:0 4px 0 16px;min-height:52px;border-bottom:1px solid rgba(255,255,255,.1)}',
    '#ttm-sheet h2{margin:0;font-size:18px;font-weight:500}',
    '#ttm-sheet .ttm-x{flex:none;width:48px;height:48px;border:0;border-radius:24px;background:transparent;',
    'color:#fff;font:400 22px/48px Roboto,Arial,sans-serif;cursor:pointer;padding:0}',
    '#ttm-sheet .ttm-x:active{background:rgba(255,255,255,.15)}',
    '#ttm-sheet .ttm-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
    '-webkit-overflow-scrolling:touch;touch-action:pan-y}',
    '#ttm-sheet h3{margin:8px 0 0;padding:8px 16px 4px;font-size:13px;font-weight:500;color:#aaa}',
    '#ttm-sheet label{display:flex;align-items:center;justify-content:space-between;gap:16px;',
    'min-height:48px;padding:0 16px;cursor:pointer}',
    '#ttm-sheet label.ttm-sub{padding-left:32px}',
    '#ttm-sheet label.ttm-disabled{opacity:.45}',
    '#ttm-sheet input[type=checkbox],#ttm-sheet input[type=radio]{width:22px;height:22px;',
    'accent-color:#3ea6ff;flex:none;margin:0}',
    '#ttm-sheet fieldset.ttm-group{border:0;margin:0;padding:0;min-width:0}',
    '#ttm-sheet fieldset.ttm-group legend{padding:8px 16px 4px;font-size:13px;font-weight:500;color:#aaa}',
    '#ttm-sheet .ttm-note{margin:0;padding:0 16px 8px;font-size:12px;color:#aaa}',
    '#ttm-sheet .ttm-info{margin:4px 0 0;padding:8px 16px;font-size:12px;color:#aaa;',
    'font-variant-numeric:tabular-nums;border-top:1px solid rgba(255,255,255,.1)}',
    '#ttm-sheet select{min-height:40px;min-width:140px;border-radius:8px;background:#333;color:#fff;',
    'border:1px solid #555;font-size:14px;padding:0 8px}',
    '#ttm-sheet .ttm-body{padding-bottom:8px}'
  ].join(''));

  var GEAR_PATH = 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9' +
    'a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1' +
    'L11 21h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z';

  function makeEntry() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ttm-entry';
    b.setAttribute(ROW_ATTR, '1');
    b.setAttribute('aria-label', S.menuEntry);
    b.appendChild(TTM.svgIcon(GEAR_PATH));
    b.appendChild(TTM.el('span', null, [S.menuEntry]));
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openSheet();
    });
    return b;
  }

  function injectInto(container) {
    if (!container || container.querySelector('[' + ROW_ATTR + ']')) return false;
    var anchor = container.querySelector('ytm-compact-link-renderer, ytm-menu-service-item-renderer,' +
      ' ytm-menu-navigation-item-renderer, .menu-item');
    var row = makeEntry();
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor);
    else container.appendChild(row);
    TTM.log('settings: entry added to <' + container.tagName.toLowerCase() + '>');
    return true;
  }

  function scan() {
    var found = false;
    ACCOUNT_MENU_SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) { found = injectInto(el) || found; });
    });
    // Fallback only where the account menu is not available (e.g. inside the
    // fullscreen player, where the avatar is not reachable).
    SIGNED_OUT_ANCHORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (promo) {
        var parent = promo.parentNode;
        if (!parent || parent.querySelector(':scope > [' + ROW_ATTR + ']')) return;
        parent.insertBefore(makeEntry(), promo);
        TTM.log('settings: entry added before <' + promo.tagName.toLowerCase() + '> (signed out)');
        found = true;
      });
    });
    var accountPresent = ACCOUNT_MENU_SELECTORS.some(function (sel) { return document.querySelector(sel); });
    if (!accountPresent) {
      FALLBACK_MENU_SELECTORS.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { found = injectInto(el) || found; });
      });
    }
    return found;
  }

  var scanQueued = false;
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(function () { scanQueued = false; scan(); });
  }

  // ---------------------------------------------------------------- sheet
  var backdrop = null;
  function closeSheet() {
    if (!backdrop) return false;
    if (infoCleanup) { infoCleanup(); infoCleanup = null; }
    backdrop.remove();
    backdrop = null;
    return true;
  }
  TTM.backHandlers.push(closeSheet);

  function checkbox(label, checked, onChange, extraClass) {
    var l = document.createElement('label');
    if (extraClass) l.className = extraClass;
    var span = document.createElement('span');
    span.textContent = label;
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    l.appendChild(span);
    l.appendChild(input);
    return l;
  }

  var infoCleanup = null;

  /** One labelled group of radio rows (each row ≥ 48 px). */
  function radioGroup(key, title, options, current) {
    var fs = TTM.el('fieldset', { 'class': 'ttm-group', 'data-ttm-setting': key });
    fs.appendChild(TTM.el('legend', null, [title]));
    Object.keys(options).forEach(function (value) {
      var input = TTM.el('input', { type: 'radio', name: 'ttm-' + key, value: value });
      input.checked = value === current;
      input.addEventListener('change', function () { if (input.checked) TTM.setSetting(key, value); });
      fs.appendChild(TTM.el('label', { 'class': 'ttm-sub' }, [TTM.el('span', null, [options[value]]), input]));
    });
    return fs;
  }

  function openSheet() {
    closeSheet();
    var st = TTM.settings;
    backdrop = document.createElement('div');
    backdrop.id = 'ttm-sheet-backdrop';
    var sheet = document.createElement('div');
    sheet.id = 'ttm-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', S.settingsTitle);
    var x = TTM.el('button', { type: 'button', 'class': 'ttm-x', 'aria-label': S.close, title: S.close }, ['✕']);
    x.addEventListener('click', function (e) { e.preventDefault(); closeSheet(); });
    sheet.appendChild(TTM.el('div', { 'class': 'ttm-head' }, [TTM.el('h2', null, [S.settingsTitle]), x]));
    var body = TTM.el('div', { 'class': 'ttm-body' });
    sheet.appendChild(body);
    // All rows go into the scrollable body.
    var sheetRoot = sheet;
    sheet = body;

    sheet.appendChild(checkbox(S.adblock, st.adblock, function (v) { TTM.setSetting('adblock', v); }));

    var catLabels = [];
    function refreshCats() {
      catLabels.forEach(function (l) {
        l.classList.toggle('ttm-disabled', !TTM.settings.sponsorblock);
        l.querySelector('input').disabled = !TTM.settings.sponsorblock;
      });
    }
    sheet.appendChild(checkbox(S.sponsorblock, st.sponsorblock, function (v) {
      TTM.setSetting('sponsorblock', v);
      refreshCats();
    }));
    var h3 = document.createElement('h3');
    h3.textContent = S.sbCategoriesTitle;
    sheet.appendChild(h3);
    CONFIG.SPONSORBLOCK_CATEGORIES.forEach(function (c) {
      var l = checkbox(S.categories[c] || c, !!st.sbCategories[c], function (v) {
        TTM.settings.sbCategories[c] = v;
        TTM.saveSettings();
      }, 'ttm-sub');
      catLabels.push(l);
      sheet.appendChild(l);
    });
    refreshCats();

    var speedLabel = document.createElement('label');
    var speedText = document.createElement('span');
    speedText.textContent = S.speed;
    var select = document.createElement('select');
    CONFIG.SPEEDS.forEach(function (v) {
      var o = document.createElement('option');
      o.value = String(v);
      o.textContent = v === 1 ? S.speedNormal : (String(v).replace('.', ',') + '×');
      if (v === st.speed) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () { TTM.setSetting('speed', parseFloat(select.value)); });
    speedLabel.appendChild(speedText);
    speedLabel.appendChild(select);
    sheet.appendChild(speedLabel);

    sheet.appendChild(radioGroup('videoFit', S.videoFit, S.videoFitOptions, st.videoFit));
    sheet.appendChild(checkbox(S.autoFullscreen, st.autoFullscreen,
      function (v) { TTM.setSetting('autoFullscreen', v); }));
    sheet.appendChild(radioGroup('onLeave', S.onLeave, S.onLeaveOptions, st.onLeave));
    var codecGroup = radioGroup('codec', S.codec, S.codecOptions, st.codec);
    codecGroup.appendChild(TTM.el('p', { 'class': 'ttm-note' }, [S.codecNote]));
    sheet.appendChild(codecGroup);
    var info = TTM.el('p', { 'class': 'ttm-info', 'aria-live': 'polite' });
    function updateInfo() {
      var dpr = Math.round((window.devicePixelRatio || 1) * 1000) / 1000;
      info.textContent = S.screenInfo(dpr, screen.width, screen.height, innerWidth, innerHeight);
    }
    updateInfo();
    window.addEventListener('resize', updateInfo);
    infoCleanup = function () { window.removeEventListener('resize', updateInfo); };
    sheet.appendChild(info);
    sheet = sheetRoot;

    // No bottom "Đóng" button (designer v5): ✕ in the header, Android Back and a tap
    // on the backdrop close the sheet, and the rows get the vertical space.

    backdrop.appendChild(sheet);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeSheet(); });
    // Keep YouTube from reacting to taps inside the sheet.
    ['touchstart', 'touchend', 'mousedown', 'mouseup'].forEach(function (t) {
      sheet.addEventListener(t, function (e) { e.stopPropagation(); });
    });
    TTM.overlayParent().appendChild(backdrop);
  }

  TTM.onReady(function () {
    scan();
    new MutationObserver(queueScan).observe(document.body || document.documentElement,
      { childList: true, subtree: true });
  });

  TTM.settingsUi = { open: openSheet, close: closeSheet, scan: scan };
})();
