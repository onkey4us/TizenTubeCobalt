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

package dev.cobalt.media;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.media.session.MediaSession;
import android.os.Build;
import android.os.IBinder;
import android.support.v4.media.session.MediaSessionCompat;
import androidx.annotation.Nullable;
import dev.cobalt.util.Log;

/**
 * TizenTube background audio: foreground service (type mediaPlayback) that keeps the process
 * alive and in the foreground priority class while the activity is stopped and a video's audio
 * keeps playing ("Khi chuyển app" = "Chỉ phát âm thanh", or the PiP fallback).
 *
 * <p>Shows a MediaStyle notification bound to the existing Cobalt MediaSession (token from
 * dev.cobalt.coat.CobaltMediaSession), with a play/pause action. The action goes back to the app
 * through {@link Controller#playPause()}, which uses the same Chromium MediaSession path as
 * hardware media keys. Tapping the notification reopens the activity.
 *
 * <p>Started by CobaltActivity.onStop() when audio should continue and stopped in onStart(),
 * onDestroy(), or when playback stops. Works on API 24+: NotificationChannel and
 * startForegroundService() are API 26+, startForeground(id, n, type) is API 29+.
 *
 * <p>Uses the framework android.app.Notification.MediaStyle with the framework MediaSession
 * token (MediaSessionCompat.Token#getToken(); MediaSessionCompat comes from androidx.media, already
 * a dependency of //cobalt/android:cobalt_main_java). Icons are framework drawables and strings
 * are inline, so no new resources are needed.
 */
public class MediaPlaybackService extends Service {
  private static final String TAG = "TizenTubeMedia";
  private static final String CHANNEL_ID = "tizentube_playback";
  private static final int NOTIFICATION_ID = 0x7175;
  private static final String ACTION_UPDATE = "dev.cobalt.media.TIZENTUBE_UPDATE";
  private static final String ACTION_PLAY_PAUSE = "dev.cobalt.media.TIZENTUBE_PLAY_PAUSE";

  /** Implemented by CobaltActivity; process-wide because there is one activity. */
  public interface Controller {
    @Nullable
    MediaSessionCompat.Token getSessionToken();

    boolean isPlaying();

    @Nullable
    String getTitle();

    @Nullable
    String getArtist();

    @Nullable
    Bitmap getArtwork();

    void playPause();

    Intent getLaunchIntent();
  }

  private static volatile Controller sController;
  private static volatile boolean sRunning;

  public static void setController(@Nullable Controller controller) {
    sController = controller;
  }

  public static boolean isRunning() {
    return sRunning;
  }

  /** Starts (or refreshes) the foreground service. Safe to call repeatedly. */
  public static void start(Context context) {
    Intent intent = new Intent(context, MediaPlaybackService.class).setAction(ACTION_UPDATE);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent);
      } else {
        context.startService(intent);
      }
    } catch (RuntimeException e) {
      // IllegalStateException / ForegroundServiceStartNotAllowedException (API 31+) when
      // the app is already in the background.
      Log.w(TAG, "Cannot start MediaPlaybackService: " + e);
    }
  }

  /** Refreshes the notification if the service runs (playing state / metadata changed). */
  public static void update(Context context) {
    if (sRunning) {
      start(context);
    }
  }

  public static void stop(Context context) {
    if (!sRunning) {
      return;
    }
    context.stopService(new Intent(context, MediaPlaybackService.class));
  }

  @Override
  public void onCreate() {
    super.onCreate();
    sRunning = true;
    createChannel();
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    Controller controller = sController;
    if (intent != null && ACTION_PLAY_PAUSE.equals(intent.getAction()) && controller != null) {
      controller.playPause();
    }
    // Always call startForeground() promptly after startForegroundService().
    Notification notification = buildNotification(controller);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
          NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
    } else {
      startForeground(NOTIFICATION_ID, notification);
    }
    if (controller == null) {
      Log.w(TAG, "No controller (activity gone); stopping.");
      stopSelf();
    }
    return START_NOT_STICKY;
  }

  @Override
  public void onDestroy() {
    sRunning = false;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(Service.STOP_FOREGROUND_REMOVE);
    } else {
      stopForeground(true);
    }
    super.onDestroy();
  }

  @Override
  public void onTaskRemoved(Intent rootIntent) {
    // App swiped away from recents: stop playing in the background.
    stopSelf();
    super.onTaskRemoved(rootIntent);
  }

  @Nullable
  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  @SuppressWarnings("deprecation")
  private Notification.Builder createLegacyBuilder() {
    // API 24/25: no channels; PRIORITY_LOW keeps it quiet.
    return new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return;
    }
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) {
      return;
    }
    NotificationChannel channel =
        new NotificationChannel(CHANNEL_ID, "Đang phát", NotificationManager.IMPORTANCE_LOW);
    channel.setDescription("Phát âm thanh TizenTube khi chuyển app");
    channel.setShowBadge(false);
    nm.createNotificationChannel(channel);
  }

  private static int immutableFlag() {
    // FLAG_IMMUTABLE exists since API 23; required on API 31+.
    return PendingIntent.FLAG_IMMUTABLE;
  }

  private Notification buildNotification(@Nullable Controller controller) {
    boolean playing = controller != null && controller.isPlaying();
    String title = controller != null ? controller.getTitle() : null;
    String artist = controller != null ? controller.getArtist() : null;

    Intent launch =
        controller != null
            ? controller.getLaunchIntent()
            : getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent content =
        PendingIntent.getActivity(
            this,
            0,
            launch != null ? launch : new Intent(),
            PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
    PendingIntent playPause =
        PendingIntent.getService(
            this,
            1,
            new Intent(this, MediaPlaybackService.class).setAction(ACTION_PLAY_PAUSE),
            PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());

    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      b = new Notification.Builder(this, CHANNEL_ID);
    } else {
      b = createLegacyBuilder();
    }
    b.setSmallIcon(playing ? android.R.drawable.ic_media_play : android.R.drawable.ic_media_pause)
        .setContentTitle(title != null && !title.isEmpty() ? title : "TizenTube")
        .setContentText(artist != null && !artist.isEmpty() ? artist : "Đang phát âm thanh")
        .setContentIntent(content)
        .setOngoing(playing)
        .setShowWhen(false)
        .setOnlyAlertOnce(true)
        .setVisibility(Notification.VISIBILITY_PUBLIC)
        .setCategory(Notification.CATEGORY_TRANSPORT)
        .addAction(
            new Notification.Action.Builder(
                    playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                    playing ? "Tạm dừng" : "Phát",
                    playPause)
                .build());
    Bitmap art = controller != null ? controller.getArtwork() : null;
    if (art != null) {
      b.setLargeIcon(art);
    }
    Notification.MediaStyle style = new Notification.MediaStyle().setShowActionsInCompactView(0);
    MediaSessionCompat.Token token = controller != null ? controller.getSessionToken() : null;
    Object platformToken = token != null ? token.getToken() : null;
    if (platformToken instanceof MediaSession.Token) {
      style.setMediaSession((MediaSession.Token) platformToken);
    }
    b.setStyle(style);
    return b.build();
  }
}
