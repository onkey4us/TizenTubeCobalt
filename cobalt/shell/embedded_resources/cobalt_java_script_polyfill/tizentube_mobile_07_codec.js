/**
 * @license
 * Copyright 2026 Reis Can (reisxd). All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 *
 * TizenTube mobile userscript, module 07: codec gate (v7, lighter playback).
 *
 * YouTube picks its video format by probing MediaSource.isTypeSupported() and
 * navigator.mediaCapabilities.decodingInfo() (seen on m.youtube.com: e.g.
 * 'video/webm; codecs="vp9"; width=3840; height=2160', decodingInfo with
 * video.width/height/framerate). On the car head unit we steer it away from formats
 * that are expensive or software-decoded:
 *   - AV1 (av01) is always rejected;
 *   - anything above 1920x1080 or above 60 fps is rejected;
 *   - setting "Codec" = 'h264' additionally rejects VP9/VP8 video (vp09, vp9, vp8,
 *     and video/webm in general), so YouTube serves H.264 (avc1);
 *   - 'auto' also rejects VP9 when the device has no HARDWARE VP9 decoder
 *     (window.TizenTubeMobile.hasHardwareDecoder('video/x-vnd.on2.vp9'), Android
 *     MediaCodecList). The X7's NXP i.MX8QM VPU (Amphion Malone) decodes H.264/HEVC but
 *     not VP9, so there auto behaves like H.264. On desktop (no bridge) VP9 is allowed.
 * Audio types are never touched. Installed at document start (before YouTube's player
 * code runs) on MediaSource, ManagedMediaSource (if present), HTMLMediaElement
 * canPlayType and navigator.mediaCapabilities.decodingInfo.
 */
(function () {
  'use strict';
  var TTM = window.TTM;
  if (!TTM || TTM.codec) return;

  var MAX_W = 1920, MAX_H = 1080, MAX_FPS = 60;
  var hwVp9 = null;  // lazily asked once
  function hasHwVp9() {
    if (hwVp9 !== null) return hwVp9;
    hwVp9 = true;  // no bridge / unknown: allow
    try {
      var b = TTM.bridge();
      if (b && typeof b.hasHardwareDecoder === 'function') hwVp9 = !!b.hasHardwareDecoder('video/x-vnd.on2.vp9');
    } catch (e) { /* keep true */ }
    TTM.log('codec: hardware VP9 decoder: ' + hwVp9);
    return hwVp9;
  }
  var stats = { rejected: 0, checked: 0, lastRejected: null };

  function param(type, name) {
    var m = new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*"?([\\d.]+)', 'i').exec(type);
    return m ? parseFloat(m[1]) : null;
  }

  /** @return {string|null} reason to reject, or null to let the browser decide. */
  function rejectReason(type, w, h, fps) {
    if (typeof type !== 'string') return null;
    var t = type.toLowerCase();
    var isVideo = /^\s*video\//.test(t);
    if (!isVideo) return null;
    if (/av01|av1\b/.test(t)) return 'av1';
    if (w == null) w = param(t, 'width');
    if (h == null) h = param(t, 'height');
    if (fps == null) fps = param(t, 'framerate');
    if ((w && w > MAX_W) || (h && h > MAX_H)) return 'size>' + MAX_W + 'x' + MAX_H;
    if (fps && fps > MAX_FPS) return 'fps>' + MAX_FPS;
    var isVpx = /vp0?9|vp8|vp09/.test(t) || /^\s*video\/webm/.test(t);
    if (TTM.settings.codec === 'h264' && isVpx) return 'h264-only';
    if (isVpx && !hasHwVp9()) return 'no-hw-vp9';
    return null;
  }

  function note(type, reason) {
    stats.checked++;
    if (reason) {
      stats.rejected++;
      stats.lastRejected = type + ' (' + reason + ')';
    }
  }

  function wrapIsTypeSupported(Ctor, name) {
    if (!Ctor || typeof Ctor.isTypeSupported !== 'function') return false;
    var orig = Ctor.isTypeSupported;
    Ctor.isTypeSupported = function isTypeSupported(type) {
      var reason = rejectReason(type);
      note(type, reason);
      return reason ? false : orig.call(this, type);
    };
    return name;
  }
  var wrapped = [wrapIsTypeSupported(window.MediaSource, 'MediaSource'),
    wrapIsTypeSupported(window.ManagedMediaSource, 'ManagedMediaSource'),
    wrapIsTypeSupported(window.WebKitMediaSource, 'WebKitMediaSource')].filter(Boolean);

  if (window.HTMLMediaElement && HTMLMediaElement.prototype.canPlayType) {
    var origCpt = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function canPlayType(type) {
      var reason = rejectReason(type);
      note(type, reason);
      return reason ? '' : origCpt.call(this, type);
    };
    wrapped.push('canPlayType');
  }

  var mc = navigator.mediaCapabilities;
  if (mc && typeof mc.decodingInfo === 'function') {
    var origDec = mc.decodingInfo;
    mc.decodingInfo = function decodingInfo(config) {
      var v = config && config.video;
      var reason = v ? rejectReason(v.contentType, v.width, v.height, v.framerate) : null;
      note(v && v.contentType, reason);
      if (reason) {
        return Promise.resolve({ supported: false, smooth: false, powerEfficient: false, configuration: config });
      }
      return origDec.call(this, config);
    };
    wrapped.push('decodingInfo');
  }

  TTM.codec = { rejectReason: rejectReason, stats: stats, wrapped: wrapped, hasHwVp9: hasHwVp9 };
  TTM.log('codec: gate on ' + wrapped.join(',') + ' (mode ' + TTM.settings.codec + ')');
})();
