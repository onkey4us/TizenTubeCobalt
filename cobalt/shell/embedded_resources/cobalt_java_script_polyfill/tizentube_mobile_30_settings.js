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
  var ROW_ATTR = 'data-ttm-entry';

  TTM.addStyle([
    '.ttm-entry{display:flex;align-items:center;gap:24px;width:100%;min-height:48px;padding:0 16px;',
    'box-sizing:border-box;border:0;background:transparent;color:inherit;text-align:left;',
    'font:400 14px/1.4 Roboto,Arial,sans-serif;cursor:pointer}',
    '.ttm-entry:active{background:rgba(127,127,127,.2)}',
    '.ttm-entry svg{width:24px;height:24px;flex:none;fill:currentColor}',
    '#ttm-sheet-backdrop{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);',
    'display:flex;align-items:center;justify-content:center}',
    '#ttm-sheet{width:min(520px,92vw);max-height:88vh;overflow:auto;border-radius:12px;',
    'background:#212121;color:#f1f1f1;font:400 14px/1.4 Roboto,Arial,sans-serif;',
    'box-shadow:0 4px 24px rgba(0,0,0,.5)}',
    '#ttm-sheet h2{margin:0;padding:16px 16px 8px;font-size:18px;font-weight:500}',
    '#ttm-sheet h3{margin:8px 0 0;padding:8px 16px 4px;font-size:13px;font-weight:500;color:#aaa}',
    '#ttm-sheet label{display:flex;align-items:center;justify-content:space-between;gap:16px;',
    'min-height:48px;padding:0 16px;cursor:pointer}',
    '#ttm-sheet label.ttm-sub{padding-left:32px}',
    '#ttm-sheet label.ttm-disabled{opacity:.45}',
    '#ttm-sheet input[type=checkbox]{width:22px;height:22px;accent-color:#3ea6ff;flex:none}',
    '#ttm-sheet select{min-height:40px;min-width:140px;border-radius:8px;background:#333;color:#fff;',
    'border:1px solid #555;font-size:14px;padding:0 8px}',
    '#ttm-sheet .ttm-actions{display:flex;justify-content:flex-end;padding:8px}',
    '#ttm-sheet .ttm-actions button{min-height:48px;min-width:96px;border:0;border-radius:24px;',
    'background:#3ea6ff;color:#0f0f0f;font:500 14px Roboto,Arial,sans-serif;cursor:pointer}'
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
    var h = document.createElement('h2');
    h.textContent = S.settingsTitle;
    sheet.appendChild(h);

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

    sheet.appendChild(checkbox(S.gestures, st.gestures, function (v) { TTM.setSetting('gestures', v); }));

    var actions = document.createElement('div');
    actions.className = 'ttm-actions';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = S.close;
    close.addEventListener('click', closeSheet);
    actions.appendChild(close);
    sheet.appendChild(actions);

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
