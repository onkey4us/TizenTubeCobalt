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
import android.os.Handler;
import android.os.Looper;

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

  /** Version of this bridge so the userscript can feature-detect. 2 = v6 (leave mode). */
  @CobaltJavaScriptInterface
  public int getBridgeVersion() {
    return 2;
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
}
