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

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.provider.Settings;
import android.view.WindowManager;
import java.lang.ref.WeakReference;

/**
 * JavaScript bridge used by the bundled TizenTube mobile userscript
 * (assets/tizentube_mobile/tizentube_mobile.js) for the player swipe gestures.
 *
 * <p>Exposed to JS as {@code window.TizenTubeMobile}. Only injected when the app runs in mobile
 * UI mode, and restricted to YouTube origins (see CobaltActivity#initializeJavaBridge).
 *
 * <p>All levels are floats in [0, 1].
 */
public class TizenTubeMobileBridge implements CobaltJavaScriptAndroidObject {
  private final WeakReference<Activity> mActivity;
  private final AudioManager mAudioManager;

  // Last brightness requested by JS. -1 means "follow system brightness".
  private volatile float mWindowBrightness = -1f;

  public TizenTubeMobileBridge(Activity activity) {
    mActivity = new WeakReference<>(activity);
    mAudioManager =
        (AudioManager) activity.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
  }

  @Override
  public String getJavaScriptInterfaceName() {
    return "TizenTubeMobile";
  }

  private static float clamp01(float v) {
    if (Float.isNaN(v)) {
      return 0f;
    }
    return Math.max(0f, Math.min(1f, v));
  }

  /** Returns the current window brightness, or the system brightness if not overridden. */
  @CobaltJavaScriptInterface
  public float getBrightness() {
    if (mWindowBrightness >= 0f) {
      return mWindowBrightness;
    }
    Activity activity = mActivity.get();
    if (activity == null) {
      return 0.5f;
    }
    try {
      int sys =
          Settings.System.getInt(
              activity.getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
      return clamp01(sys / 255f);
    } catch (Settings.SettingNotFoundException e) {
      return 0.5f;
    }
  }

  /**
   * Sets this window's brightness (WindowManager.LayoutParams#screenBrightness). Does not change
   * the system setting, so no WRITE_SETTINGS permission is needed and leaving the app restores
   * the user's brightness.
   */
  @CobaltJavaScriptInterface
  public void setBrightness(float level) {
    final float value = Math.max(0.01f, clamp01(level));
    mWindowBrightness = value;
    final Activity activity = mActivity.get();
    if (activity == null) {
      return;
    }
    activity.runOnUiThread(
        () -> {
          if (activity.isFinishing() || activity.isDestroyed()) {
            return;
          }
          WindowManager.LayoutParams lp = activity.getWindow().getAttributes();
          lp.screenBrightness = value;
          activity.getWindow().setAttributes(lp);
        });
  }

  /** Returns STREAM_MUSIC volume in [0, 1]. */
  @CobaltJavaScriptInterface
  public float getVolume() {
    if (mAudioManager == null) {
      return -1f;
    }
    int max = mAudioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
    if (max <= 0) {
      return -1f;
    }
    return clamp01(mAudioManager.getStreamVolume(AudioManager.STREAM_MUSIC) / (float) max);
  }

  /** Sets STREAM_MUSIC volume without showing the system volume UI. Returns the applied level. */
  @CobaltJavaScriptInterface
  public float setVolume(float level) {
    if (mAudioManager == null) {
      return -1f;
    }
    int max = mAudioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
    if (max <= 0) {
      return -1f;
    }
    int index = Math.round(clamp01(level) * max);
    try {
      mAudioManager.setStreamVolume(AudioManager.STREAM_MUSIC, index, /* flags= */ 0);
    } catch (SecurityException e) {
      // Do Not Disturb policy can reject volume changes.
      return -1f;
    }
    return index / (float) max;
  }

  /** Version of this bridge so the userscript can feature-detect. */
  @CobaltJavaScriptInterface
  public int getBridgeVersion() {
    return 1;
  }
}
