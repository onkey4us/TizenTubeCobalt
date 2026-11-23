// Copyright 2017 The Cobalt Authors. All Rights Reserved.
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

package dev.cobalt.coat;

import static dev.cobalt.util.Log.TAG;

import android.app.Activity;
import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import dev.cobalt.util.Holder;
import dev.cobalt.util.Log;
import java.util.List;
import java.util.Set;
import org.chromium.content_public.browser.MediaSession;
import org.chromium.content_public.browser.MediaSessionObserver;
import org.chromium.content_public.browser.WebContents;
import org.chromium.content_public.browser.WebContentsObserver;
import org.chromium.media_session.mojom.MediaSessionAction;
import org.chromium.services.media_session.MediaImage;
import org.chromium.services.media_session.MediaMetadata;
import org.chromium.services.media_session.MediaPosition;

/**
 * Cobalt MediaSession glue, as well as collection of state and logic to switch on/off Android OS
 * features used in media playback, such as audio focus, "KEEP_SCREEN_ON" mode, and "visible
 * behind".
 */
public class CobaltMediaSession implements ArtworkLoader.Callback {
  // We do handle transport controls and set this flag on all API levels, even though it's
  // deprecated and unnecessary on API 26+.
  @SuppressWarnings("deprecation")
  private static final int MEDIA_SESSION_FLAG_HANDLES_TRANSPORT_CONTROLS =
      MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS;

  private final Handler mMainHandler = new Handler(Looper.getMainLooper());
  private final Context mContext;
  private final ArtworkLoader mArtworkLoader;
  private final Holder<Activity> mActivityHolder;
  private WebContents mWebContents;
  private WebContentsObserver mWebContentsObserver;
  private MediaSessionCompat mMediaSession;
  private MediaSessionObserver mMediaSessionObserver;
  private boolean mIsControllable;
  private boolean mIsPaused;
  private MediaMetadata mMetadata;
  private Set<Integer> mActions;
  private MediaPosition mPosition;
  private Bitmap mArtworkImage;
  private final MediaSessionCompat.Callback mMediaSessionCallback;
  private LifecycleCallback mLifecycleCallback = null;
  // TizenTube v6 background playback: when true, onActivityStop() keeps the session.
  private boolean mKeepActiveInBackground;
  private PlaybackListener mPlaybackListener;

  /** TizenTube: notified on the main thread when the playing state/metadata changes. */
  public interface PlaybackListener {
    void onPlaybackChanged(boolean playing);
  }

  public void setPlaybackListener(PlaybackListener listener) {
    mPlaybackListener = listener;
  }

  /**
   * TizenTube v7: page command channel for transport actions. m.youtube.com does not register
   * nexttrack/previoustrack/seek MediaSession handlers, so Chromium's didReceiveAction() would be
   * a no-op for them; with a sink set they go to the page instead ('next', 'prev', 'seek+10',
   * 'seek-10'). Play/pause keep the Chromium path (it plays/pauses the media element itself).
   */
  public interface CommandSink {
    void onCommand(String command);
  }

  private CommandSink mCommandSink;
  private String mFallbackTitle;
  private String mFallbackArtist;
  private long mFallbackDurationMs;

  public void setCommandSink(CommandSink sink) {
    mCommandSink = sink;
    updatePlaybackState();
  }

  /** TizenTube v7: metadata from the page, used only while Chromium has not provided any. */
  public void setFallbackMetadata(String title, String artist, long durationMs) {
    mFallbackTitle = title;
    mFallbackArtist = artist;
    mFallbackDurationMs = durationMs;
    if (mMetadata == null) {
      updateMetadata();
    }
  }

  private boolean sendCommand(String command) {
    CommandSink sink = mCommandSink;
    if (sink == null) {
      return false;
    }
    mMainHandler.post(() -> sink.onCommand(command));
    return true;
  }

  /**
   * TizenTube background playback: keep the MediaSession active while the activity is
   * stopped (audio continues, notification and media keys keep working).
   */
  public void setKeepActiveInBackground(boolean keep) {
    mKeepActiveInBackground = keep;
  }

  /** True when the page's MediaSession reports controllable, unpaused playback. */
  public boolean isPlaying() {
    return mIsControllable && !mIsPaused && (mMetadata != null || mFallbackTitle != null);
  }

  @Nullable
  public MediaSessionCompat.Token getSessionToken() {
    return mMediaSession != null ? mMediaSession.getSessionToken() : null;
  }

  @Nullable
  public String getTitle() {
    return mMetadata != null ? mMetadata.getTitle() : mFallbackTitle;
  }

  @Nullable
  public String getArtist() {
    return mMetadata != null ? mMetadata.getArtist() : mFallbackArtist;
  }

  @Nullable
  public Bitmap getArtwork() {
    return mArtworkImage;
  }

  /** Play/pause from the background notification, same path as media keys. */
  public void sendPlayPause() {
    mMainHandler.post(
        () -> {
          if (mMediaSessionObserver == null) {
            return;
          }
          mMediaSessionObserver
              .getMediaSession()
              .didReceiveAction(mIsPaused ? MediaSessionAction.PLAY : MediaSessionAction.PAUSE);
        });
  }

  // TODO: decouple LifecycleCallback and CobaltMediaSession implementation.
  /** LifecycleCallback to notify listeners when |mediaSession| becomes active or inactive. */
  public interface LifecycleCallback {
    void onMediaSessionLifecycle(boolean isActive, MediaSessionCompat.Token token);
  }

  public void setLifecycleCallback(LifecycleCallback lifecycleCallback) {
    mLifecycleCallback = lifecycleCallback;
    if (mLifecycleCallback != null && mMediaSession != null) {
      mLifecycleCallback.onMediaSessionLifecycle(true, mMediaSession.getSessionToken());
    }
  }

  public CobaltMediaSession(
      Context context, Holder<Activity> activityHolder, ArtworkDownloader artworkDownloader) {
    mContext = context;
    mActivityHolder = activityHolder;
    mArtworkLoader = new ArtworkLoader(this, artworkDownloader);
    mMediaSessionCallback =
        new MediaSessionCompat.Callback() {
          private void onReceiveAction(int action) {
            // To be cautious, explicitly run the code on main loop .
            mMainHandler.post(
                new Runnable() {
                  @Override
                  public void run() {
                    if (mMediaSessionObserver == null) {
                      return;
                    }
                    Log.i(TAG, "MediaSession didReceiveAction: %d", action);
                    mMediaSessionObserver.getMediaSession().didReceiveAction(action);
                  }
                });
          }

          @Override
          public void onPlay() {
            onReceiveAction(MediaSessionAction.PLAY);
          }

          @Override
          public void onPause() {
            onReceiveAction(MediaSessionAction.PAUSE);
          }

          @Override
          public void onSkipToPrevious() {
            if (!sendCommand("prev")) {
              onReceiveAction(MediaSessionAction.PREVIOUS_TRACK);
            }
          }

          @Override
          public void onSkipToNext() {
            if (!sendCommand("next")) {
              onReceiveAction(MediaSessionAction.NEXT_TRACK);
            }
          }

          @Override
          public void onFastForward() {
            if (!sendCommand("seek+10")) {
              onReceiveAction(MediaSessionAction.SEEK_FORWARD);
            }
          }

          @Override
          public void onRewind() {
            if (!sendCommand("seek-10")) {
              onReceiveAction(MediaSessionAction.SEEK_BACKWARD);
            }
          }

          @Override
          public void onSeekTo(long pos) {
            // To be cautious, explicitly run the code on main loop .
            mMainHandler.post(
                new Runnable() {
                  @Override
                  public void run() {
                    if (mMediaSessionObserver == null) {
                      return;
                    }
                    mMediaSessionObserver.getMediaSession().seekTo(pos);
                  }
                });
          }

          @Override
          public void onStop() {
            onReceiveAction(MediaSessionAction.STOP);
          }
        };
  }

  public void setWebContents(WebContents webContents) {
    if (mWebContents == webContents) {
      return;
    }

    if (mWebContentsObserver != null) {
      mWebContentsObserver.observe(null);
      mWebContentsObserver = null;
    }

    if (webContents == null) {
      cleanupMediaSessionObserver();
      mWebContents = null;
      return;
    }

    mWebContents = webContents;
    mWebContentsObserver =
        new WebContentsObserver(mWebContents) {
          @Override
          public void mediaSessionCreated(MediaSession mediaSession) {
            setupMediaSessionObserver(mediaSession);
          }

          @Override
          public void webContentsDestroyed() {
            setWebContents(null);
          }
        };
    setupMediaSessionObserver(MediaSession.fromWebContents(mWebContents));
  }

  public void onActivityStop() {
    if (mKeepActiveInBackground) {
      // TizenTube background audio: the session must stay active for the foreground
      // service notification and media keys.
      Log.i(TAG, "MediaSession kept active in background (TizenTube background playback).");
      return;
    }
    // A workaround to deactivate media session before the app enters background to avoid
    // b/424538093.
    deactivateMediaSession();
  }

  private void activateMediaSession() {
    mMediaSession = new MediaSessionCompat(mContext, TAG);
    mMediaSession.setFlags(MEDIA_SESSION_FLAG_HANDLES_TRANSPORT_CONTROLS);
    mMediaSession.setCallback(mMediaSessionCallback);
    mMediaSession.setActive(true);

    if (mLifecycleCallback != null) {
      mLifecycleCallback.onMediaSessionLifecycle(true, mMediaSession.getSessionToken());
    }

    Log.i(TAG, "MediaSession is activated.");
  }

  private void deactivateMediaSession() {
    if (mMediaSession == null) {
      return;
    }

    if (mLifecycleCallback != null) {
      mLifecycleCallback.onMediaSessionLifecycle(false, null);
    }

    mMediaSession.setCallback(null);
    mMediaSession.setActive(false);
    mMediaSession.release();
    mMediaSession = null;

    Log.i(TAG, "MediaSession has been deactivated.");
  }

  private MediaSessionObserver createMediaSessionObserver(MediaSession mediaSession) {
    return new MediaSessionObserver(mediaSession) {
      @Override
      public void mediaSessionDestroyed() {
        // We always keep a MediaSession, so nothing to destroy here.
        mMetadata = null;
        mActions = null;
        mPosition = null;
        mArtworkImage = null;
      }

      @Override
      public void mediaSessionStateChanged(boolean isControllable, boolean isPaused) {
        mIsControllable = isControllable;
        mIsPaused = isPaused;
        updatePlaybackState();
      }

      @Override
      public void mediaSessionMetadataChanged(MediaMetadata metadata) {
        mMetadata = metadata;
        updateMetadata();
      }

      @Override
      public void mediaSessionActionsChanged(Set<Integer> actions) {
        mActions = actions;
        updatePlaybackState();
      }

      @Override
      public void mediaSessionArtworkChanged(List<MediaImage> images) {
        if (!images.isEmpty()) {
          Bitmap bitmap = mArtworkLoader.getOrLoadArtwork(images);
          if (bitmap != null) {
            onArtworkLoaded(bitmap);
          }
        }
      }

      @Override
      public void mediaSessionPositionChanged(@Nullable MediaPosition position) {
        mPosition = position;
        updateMetadata();
        updatePlaybackState();
      }
    };
  }

  private void cleanupMediaSessionObserver() {
    if (mMediaSessionObserver == null) {
      return;
    }
    mMediaSessionObserver.stopObserving();
    mMediaSessionObserver = null;
  }

  private void setupMediaSessionObserver(MediaSession mediaSession) {
    if (mMediaSessionObserver != null && mMediaSessionObserver.getMediaSession() == mediaSession) {
      return;
    }

    cleanupMediaSessionObserver();
    if (mediaSession != null) {
      mMediaSessionObserver = createMediaSessionObserver(mediaSession);
    }
  }

  private void toggleKeepScreenOn(boolean keepScreenOn) {
    CobaltActivity activity = (CobaltActivity) mActivityHolder.get();
    if (activity != null) {
      activity.toggleKeepScreenOn(keepScreenOn);
    }
  }

  private void updatePlaybackState() {
    if (!mIsControllable) {
      deactivateMediaSession();
      toggleKeepScreenOn(false);
      if (mPlaybackListener != null) {
        mPlaybackListener.onPlaybackChanged(false);
      }
      return;
    }

    if (mIsControllable && mMediaSession == null) {
      activateMediaSession();
    }

    PlaybackStateCompat.Builder playbackStateBuilder =
        new PlaybackStateCompat.Builder().setActions(computeMediaSessionActions());

    int state = PlaybackStateCompat.STATE_NONE;
    if (mMetadata != null || (mCommandSink != null && mFallbackTitle != null)) {
      state = mIsPaused ? PlaybackStateCompat.STATE_PAUSED : PlaybackStateCompat.STATE_PLAYING;
    }

    toggleKeepScreenOn(state == PlaybackStateCompat.STATE_PLAYING);

    if (mPosition != null) {
      playbackStateBuilder.setState(
          state,
          mPosition.getPosition(),
          mPosition.getPlaybackRate(),
          mPosition.getLastUpdatedTime());
    } else {
      playbackStateBuilder.setState(state, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1.0f);
    }

    PlaybackStateCompat playbackState = playbackStateBuilder.build();
    mMediaSession.setPlaybackState(playbackState);
    if (mPlaybackListener != null) {
      mPlaybackListener.onPlaybackChanged(state == PlaybackStateCompat.STATE_PLAYING);
    }

    Log.i(
        TAG,
        "MediaSession setPlaybackState: %d, actions: %d, position: %d ms, speed: %f x, last"
            + " updated: %d.",
        playbackState.getState(),
        playbackState.getActions(),
        playbackState.getPosition(),
        playbackState.getPlaybackSpeed(),
        playbackState.getLastPositionUpdateTime());
  }

  private void resetMetaData() {
    if (mMediaSession == null) {
      return;
    }

    MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder();
    mMediaSession.setMetadata(metadataBuilder.build());
  }

  private void updateMetadata() {
    if (mMediaSession == null) {
      return;
    }

    if (mMetadata == null) {
      if (mFallbackTitle != null && !mFallbackTitle.isEmpty()) {
        MediaMetadataCompat.Builder fb = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, mFallbackTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, mFallbackArtist);
        if (mArtworkImage != null) {
          fb.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, mArtworkImage);
        }
        if (mFallbackDurationMs > 0) {
          fb.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, mFallbackDurationMs);
        }
        mMediaSession.setMetadata(fb.build());
        return;
      }
      resetMetaData();
      return;
    }

    MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder();
    metadataBuilder
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, mMetadata.getTitle())
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, mMetadata.getArtist())
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, mMetadata.getAlbum());
    if (mArtworkImage != null) {
      metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, mArtworkImage);
    }
    if (mPosition != null) {
      metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, mPosition.getDuration());
    }
    // Set mediaSession's metadata to update the "Now Playing Card".
    MediaMetadataCompat metadata = metadataBuilder.build();
    mMediaSession.setMetadata(metadata);
    if (mPlaybackListener != null) {
      mPlaybackListener.onPlaybackChanged(isPlaying());
    }

    Log.i(
        TAG,
        "MediaSession setMetadata title: %s, artist %s, album %s, duration %d.",
        metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE),
        metadata.getString(MediaMetadataCompat.METADATA_KEY_ARTIST),
        metadata.getString(MediaMetadataCompat.METADATA_KEY_ALBUM),
        metadata.getLong(MediaMetadataCompat.METADATA_KEY_DURATION));
  }

  private long computeMediaSessionActions() {
    long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
        | PlaybackStateCompat.ACTION_PLAY_PAUSE;
    if (mCommandSink != null) {
      // TizenTube: always advertise transport actions so MediaSessionCompat turns steering
      // wheel / headset KEYCODE_MEDIA_NEXT/PREVIOUS/FAST_FORWARD/REWIND into callbacks
      // (onMediaButtonEvent only dispatches actions present in the playback state).
      actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT
          | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
          | PlaybackStateCompat.ACTION_FAST_FORWARD
          | PlaybackStateCompat.ACTION_REWIND;
    }
    if (mActions != null) {
      if (mActions.contains(MediaSessionAction.PREVIOUS_TRACK)) {
        actions |= PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
      }
      if (mActions.contains(MediaSessionAction.NEXT_TRACK)) {
        actions |= PlaybackStateCompat.ACTION_SKIP_TO_NEXT;
      }
      if (mActions.contains(MediaSessionAction.SEEK_FORWARD)) {
        actions |= PlaybackStateCompat.ACTION_FAST_FORWARD;
      }
      if (mActions.contains(MediaSessionAction.SEEK_BACKWARD)) {
        actions |= PlaybackStateCompat.ACTION_REWIND;
      }
      if (mActions.contains(MediaSessionAction.SEEK_TO)) {
        actions |= PlaybackStateCompat.ACTION_SEEK_TO;
      }
    }
    return actions;
  }

  @Override
  public void onArtworkLoaded(Bitmap bitmap) {
    mArtworkImage = bitmap;
    // Reset the metadata to make sure the artwork update correctly.
    resetMetaData();
    updateMetadata();
  }
}
