// Copyright 2026 Reis Can (reisxd). All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package dev.cobalt.coat.javabridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.os.Handler;
import android.os.Looper;
import dev.cobalt.media.MediaCodecUtil;
import java.util.HashMap;
import java.util.Map;

/**
 * JavaScript bridge used by the bundled TizenTube mobile userscript
 * (cobalt/shell/embedded_resources/cobalt_java_script_polyfill/tizentube_mobile_*.js).
 *
 * <p>Exposed to JS as {@code window.TizenTubeMobile} by Cobalt's JavaBridge
 * (CobaltActivity#initializeJavaBridge, JavascriptInjector.addPossiblyUnsafeInterface), only in
 * mobile UI mode and only for YouTube origins. Methods annotated with
 * {@link CobaltJavaScriptInterface} are callable from JS; they run on a binder/background thread,
 * so state changes are posted to the main thread.
 *
 * <p>v6: carries the "Khi chuyển app" (leave) mode and the page's playing state to Java. The
 * mode is persisted in SharedPreferences so CobaltActivity knows it in onUserLeaveHint / onStop
 * even before (or without) a page being loaded. The v5 volume/brightness methods are gone.
 */
public class TizenTubeMobileBridge implements CobaltJavaScriptAndroidObject {
  /** Keep audio playing in the background (default). */
  public static final String LEAVE_AUDIO = "audio";
  /** Enter picture-in-picture (falls back to LEAVE_AUDIO when unavailable). */
  public static final String LEAVE_PIP = "pip";
  /** Stock behaviour: page hidden, media pauses. */
  public static final String LEAVE_STOP = "stop";

  private static final String PREFS = "tizentube_mobile";
  private static final String KEY_LEAVE_MODE = "leave_mode";

  /** Main-thread callbacks into CobaltActivity. */
  public interface Listener {
    void onLeaveModeChanged(String mode);

    void onPagePlayingChanged(boolean playing);

    /** v7: page is (not) a watch page; the native overlay only shows on watch pages. */
    void onWatchPageChanged(boolean watchPage);

    /** v7: visible player box in CSS px (all 0 = none) and devicePixelRatio. */
    void onPlayerRectChanged(float x, float y, float w, float h, float dpr);

    /** v7: navigator.mediaSession.metadata from the page (fallback for the MediaSession). */
    void onPageMetadata(String title, String artist, String artworkUrl, long durationMs);
  }

  private final SharedPreferences mPrefs;
  private final Handler mMainHandler = new Handler(Looper.getMainLooper());
  private final Listener mListener;
  private volatile boolean mPagePlaying;

  public TizenTubeMobileBridge(Context context, Listener listener) {
    mPrefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    mListener = listener;
  }

  /** Reads the persisted leave mode; usable before any page has loaded. */
  public static String readLeaveMode(Context context) {
    String mode =
        context
            .getApplicationContext()
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LEAVE_MODE, LEAVE_AUDIO);
    return sanitize(mode);
  }

  private static String sanitize(String mode) {
    if (LEAVE_PIP.equals(mode) || LEAVE_STOP.equals(mode)) {
      return mode;
    }
    return LEAVE_AUDIO;
  }

  @Override
  public String getJavaScriptInterfaceName() {
    return "TizenTubeMobile";
  }

  /** Version of this bridge so the userscript can feature-detect. 3 = v7 (overlay glue). */
  @CobaltJavaScriptInterface
  public int getBridgeVersion() {
    return 3;
  }

  @CobaltJavaScriptInterface
  public String getLeaveMode() {
    return sanitize(mPrefs.getString(KEY_LEAVE_MODE, LEAVE_AUDIO));
  }

  /** Called by the userscript whenever the "Khi chuyển app" setting is saved. */
  @CobaltJavaScriptInterface
  public void setLeaveMode(String mode) {
    final String value = sanitize(mode);
    if (value.equals(getLeaveMode())) {
      return;
    }
    mPrefs.edit().putString(KEY_LEAVE_MODE, value).apply();
    mMainHandler.post(() -> mListener.onLeaveModeChanged(value));
  }

  /** Called by the userscript when the main watch-page video starts/stops playing. */
  @CobaltJavaScriptInterface
  public void setPlaying(boolean playing) {
    if (mPagePlaying == playing) {
      return;
    }
    mPagePlaying = playing;
    mMainHandler.post(() -> mListener.onPagePlayingChanged(playing));
  }

  public boolean isPagePlaying() {
    return mPagePlaying;
  }

  private final Map<String, Boolean> mHwDecoderCache = new HashMap<>();

  /**
   * v7: whether a hardware (non-software) decoder exists for a video MIME type, e.g.
   * "video/x-vnd.on2.vp9", "video/avc", "video/av01". Used by the userscript's codec gate:
   * in "Tự động" mode VP9 is only allowed when the device decodes it in hardware (the X7's
   * i.MX8QM VPU has no VP9), so YouTube falls back to H.264 instead of software VP9.
   */
  @CobaltJavaScriptInterface
  public boolean hasHardwareDecoder(String mime) {
    if (mime == null || !mime.startsWith("video/")) {
      return false;
    }
    synchronized (mHwDecoderCache) {
      Boolean cached = mHwDecoderCache.get(mime);
      if (cached != null) {
        return cached;
      }
    }
    boolean found = false;
    try {
      for (MediaCodecInfo info : new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos()) {
        if (info.isEncoder() || MediaCodecUtil.isSoftwareDecoder(info)) {
          continue;
        }
        for (String type : info.getSupportedTypes()) {
          if (type.equalsIgnoreCase(mime)) {
            found = true;
            break;
          }
        }
        if (found) {
          break;
        }
      }
    } catch (RuntimeException e) {
      found = true;  // unknown: do not restrict
    }
    synchronized (mHwDecoderCache) {
      mHwDecoderCache.put(mime, found);
    }
    return found;
  }

  @CobaltJavaScriptInterface
  public void setWatchPage(boolean watchPage) {
    mMainHandler.post(() -> mListener.onWatchPageChanged(watchPage));
  }

  @CobaltJavaScriptInterface
  public void setPlayerRect(float x, float y, float w, float h, float dpr) {
    if (!(dpr > 0) || Float.isNaN(x + y + w + h)) {
      return;
    }
    mMainHandler.post(() -> mListener.onPlayerRectChanged(x, y, w, h, dpr));
  }

  @CobaltJavaScriptInterface
  public void setMetadata(String title, String artist, String artworkUrl, double durationMs) {
    final String t = title != null ? title : "";
    final String a = artist != null ? artist : "";
    final String u = artworkUrl != null ? artworkUrl : "";
    final long d = Double.isNaN(durationMs) ? 0 : (long) durationMs;
    mMainHandler.post(() -> mListener.onPageMetadata(t, a, u, d));
  }
}
