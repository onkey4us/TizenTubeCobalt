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

package dev.cobalt.coat;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewGroup;
import android.widget.FrameLayout;

/**
 * TizenTube v7 native player overlay, laid out over the visible player box of the watch page
 * (reported by the userscript, CSS px * devicePixelRatio) for the car's ~900x700 split pane.
 *
 * <pre>
 *   [Back]                                   [Search]
 *              [-10s]  [Play/Pause]  [+10s]
 *   [Prev]                                   [Next]
 *   ============ YouTube seek bar (not covered) ============
 * </pre>
 *
 * <p>Buttons are drawn with Canvas shapes (no resources, no new deps): semi-transparent dark
 * circles, white glyphs, hit area 56dp (Play/Pause 72dp), scaled down to fit a small player but
 * never below 48dp. Shown by {@link #observe(MotionEvent)} on a single tap on the player (after
 * the double-tap timeout, so YouTube's native double-tap seek still works); auto-hides after 3 s,
 * every button press restarts the timer. Hidden = GONE, so it never intercepts touches. When
 * shown, a tap outside the buttons only hides it (consumed), except in the bottom seek-bar strip,
 * which is passed through to the page.
 */
public class TizenTubeOverlay extends FrameLayout {
  /** Button actions; handled by CobaltActivity (page command channel / Activity back). */
  public interface Listener {
    void onOverlayAction(String action);
  }

  public static final String ACTION_BACK = "back";
  public static final String ACTION_SEARCH = "search";
  public static final String ACTION_PREV = "prev";
  public static final String ACTION_NEXT = "next";
  public static final String ACTION_REWIND = "seek-10";
  public static final String ACTION_FORWARD = "seek+10";
  public static final String ACTION_TOGGLE = "toggle";

  private static final long AUTO_HIDE_MS = 3000;
  private static final int BIG_DP = 72;
  private static final int SMALL_DP = 56;
  private static final int MIN_DP = 48;
  private static final int MARGIN_DP = 8;
  private static final int SEEK_STRIP_DP = 40;

  private final Listener mListener;
  private final float mDensity;
  private final Handler mHandler = new Handler(Looper.getMainLooper());
  private final Runnable mAutoHide = this::hide;
  private final Runnable mShowAfterTap = this::show;
  private final int mTouchSlop;
  private final int mDoubleTapTimeout;
  private final int mTapTimeout;

  private final GlyphButton mBack;
  private final GlyphButton mSearch;
  private final GlyphButton mPrev;
  private final GlyphButton mNext;
  private final GlyphButton mRewind;
  private final GlyphButton mForward;
  private final GlyphButton mPlayPause;

  // Player box in this view's parent coordinates (physical px); empty = no player.
  private final RectF mPlayer = new RectF();
  private boolean mEnabled;  // watch page, not PiP
  private boolean mPlaying;

  // Tap observer state.
  private float mDownX;
  private float mDownY;
  private long mDownTime;
  private boolean mMultiTouch;
  private boolean mTapPending;

  public TizenTubeOverlay(Context context, Listener listener) {
    super(context);
    mListener = listener;
    mDensity = context.getResources().getDisplayMetrics().density;
    ViewConfiguration vc = ViewConfiguration.get(context);
    mTouchSlop = vc.getScaledTouchSlop();
    mDoubleTapTimeout = ViewConfiguration.getDoubleTapTimeout();
    mTapTimeout = ViewConfiguration.getLongPressTimeout();
    setVisibility(View.GONE);
    setClipChildren(false);
    setWillNotDraw(true);

    mBack = add(Glyph.BACK, "Quay lại", ACTION_BACK);
    mSearch = add(Glyph.SEARCH, "Tìm kiếm", ACTION_SEARCH);
    mPrev = add(Glyph.PREV, "Video trước", ACTION_PREV);
    mNext = add(Glyph.NEXT, "Video tiếp theo", ACTION_NEXT);
    mRewind = add(Glyph.REWIND, "Lùi 10 giây", ACTION_REWIND);
    mForward = add(Glyph.FORWARD, "Tới 10 giây", ACTION_FORWARD);
    mPlayPause = add(Glyph.PLAY, "Phát / tạm dừng", ACTION_TOGGLE);
  }

  private GlyphButton add(Glyph glyph, String label, String action) {
    GlyphButton b = new GlyphButton(getContext(), glyph);
    b.setContentDescription(label);
    b.setOnClickListener(
        v -> {
          if (ACTION_TOGGLE.equals(action)) {
            // Optimistic icon flip; the page reports the real state right after.
            setPlaying(!mPlaying);
          }
          restartAutoHide();
          mListener.onOverlayAction(action);
        });
    addView(b, new LayoutParams(dp(SMALL_DP), dp(SMALL_DP)));
    return b;
  }

  private int dp(float v) {
    return Math.round(v * mDensity);
  }

  // ---------------------------------------------------------------- state from the page

  /** Watch page (and not PiP) -> may show. Otherwise hidden. */
  public void setEnabledForPage(boolean enabled) {
    mEnabled = enabled;
    if (!enabled) {
      cancelPendingTap();
      hide();
    }
  }

  public void setPlaying(boolean playing) {
    mPlaying = playing;
    mPlayPause.setGlyph(playing ? Glyph.PAUSE : Glyph.PLAY);
  }

  /** Player box in CSS px, devicePixelRatio; w/h 0 = no player visible. */
  public void setPlayerRect(float x, float y, float w, float h, float dpr) {
    if (w <= 0 || h <= 0) {
      mPlayer.setEmpty();
      hide();
      return;
    }
    mPlayer.set(x * dpr, y * dpr, (x + w) * dpr, (y + h) * dpr);
    ViewGroup.LayoutParams lp = getLayoutParams();
    if (lp instanceof FrameLayout.LayoutParams) {
      FrameLayout.LayoutParams flp = (FrameLayout.LayoutParams) lp;
      flp.leftMargin = Math.round(mPlayer.left);
      flp.topMargin = Math.round(mPlayer.top);
      flp.width = Math.round(mPlayer.width());
      flp.height = Math.round(mPlayer.height());
      setLayoutParams(flp);
    }
  }

  public boolean isShowing() {
    return getVisibility() == View.VISIBLE;
  }

  public void show() {
    mTapPending = false;
    if (!mEnabled || mPlayer.isEmpty()) {
      return;
    }
    if (getParent() instanceof View) {
      bringToFront();
    }
    setVisibility(View.VISIBLE);
    restartAutoHide();
  }

  public void hide() {
    mHandler.removeCallbacks(mAutoHide);
    setVisibility(View.GONE);
  }

  /** Any key/remote interaction with the overlay restarts the 3 s timer. */
  public void restartAutoHide() {
    mHandler.removeCallbacks(mAutoHide);
    mHandler.postDelayed(mAutoHide, AUTO_HIDE_MS);
  }

  private void cancelPendingTap() {
    mTapPending = false;
    mHandler.removeCallbacks(mShowAfterTap);
  }

  // ------------------------------------------------------------------- tap detection

  /**
   * Called from Activity.dispatchTouchEvent with raw (window) events BEFORE the views get them.
   * Never consumes. Shows the overlay after a single tap on the player that is not followed by a
   * second tap within the double-tap timeout (that one is YouTube's native double-tap seek).
   */
  public void observe(MotionEvent ev, float offsetX, float offsetY) {
    if (!mEnabled) {
      return;
    }
    float x = ev.getX() - offsetX;
    float y = ev.getY() - offsetY;
    switch (ev.getActionMasked()) {
      case MotionEvent.ACTION_DOWN:
        mMultiTouch = false;
        mDownX = x;
        mDownY = y;
        mDownTime = SystemClock.uptimeMillis();
        if (mTapPending) {
          // Second tap: native double-tap seek; do not show the overlay.
          cancelPendingTap();
        }
        if (isShowing() && !containsInParent(x, y)) {
          // Tap outside the overlay (e.g. related list below the player): hide, pass through.
          hide();
        }
        break;
      case MotionEvent.ACTION_POINTER_DOWN:
        mMultiTouch = true;  // pinch fit/fill
        cancelPendingTap();
        break;
      case MotionEvent.ACTION_UP:
        boolean tap =
            !mMultiTouch
                && Math.abs(x - mDownX) < mTouchSlop
                && Math.abs(y - mDownY) < mTouchSlop
                && SystemClock.uptimeMillis() - mDownTime < mTapTimeout;
        if (tap && !isShowing() && mPlayer.contains(x, y) && !inSeekStrip(y)) {
          mTapPending = true;
          mHandler.removeCallbacks(mShowAfterTap);
          mHandler.postDelayed(mShowAfterTap, mDoubleTapTimeout);
        }
        break;
      case MotionEvent.ACTION_CANCEL:
        cancelPendingTap();
        break;
      default:
        break;
    }
  }

  private boolean containsInParent(float x, float y) {
    return x >= getLeft() && x < getRight() && y >= getTop() && y < getBottom();
  }

  private boolean inSeekStrip(float yInParent) {
    return yInParent > mPlayer.bottom - dp(SEEK_STRIP_DP);
  }

  @SuppressLint("ClickableViewAccessibility")
  @Override
  public boolean onTouchEvent(MotionEvent ev) {
    // Reaches here only for touches that no button took. Bottom strip (YouTube seek bar):
    // pass through to the page. Elsewhere: hide on tap, consume so the page does not also
    // toggle its controls.
    if (ev.getActionMasked() == MotionEvent.ACTION_DOWN && ev.getY() > getHeight() - dp(SEEK_STRIP_DP)) {
      hide();
      return false;
    }
    if (ev.getActionMasked() == MotionEvent.ACTION_UP) {
      hide();
    }
    return true;
  }

  // ------------------------------------------------------------------------- layout

  @Override
  protected void onLayout(boolean changed, int l, int t, int r, int b) {
    int w = r - l;
    int h = b - t;
    int margin = dp(MARGIN_DP);
    int strip = dp(SEEK_STRIP_DP);
    // Fit: corners + centre row vertically: small + big + small + 2 margins + seek strip.
    float needH = dp(SMALL_DP) * 2 + dp(BIG_DP) + margin * 4 + strip;
    float needW = dp(SMALL_DP) * 2 + dp(BIG_DP) + margin * 6;
    float scale = Math.min(1f, Math.min(h / needH, w / needW));
    int small = Math.max(dp(MIN_DP), Math.round(dp(SMALL_DP) * scale));
    int big = Math.max(dp(MIN_DP), Math.round(dp(BIG_DP) * scale));
    int gap = Math.max(margin, Math.round(dp(24) * scale));

    place(mBack, margin, margin, small);
    place(mSearch, w - margin - small, margin, small);
    int bottomY = h - strip - small;
    place(mPrev, margin, bottomY, small);
    place(mNext, w - margin - small, bottomY, small);
    int cy = (h - strip / 2) / 2;
    int cx = w / 2;
    place(mPlayPause, cx - big / 2, cy - big / 2, big);
    place(mRewind, cx - big / 2 - gap - small, cy - small / 2, small);
    place(mForward, cx + big / 2 + gap, cy - small / 2, small);
  }

  private static void place(View v, int x, int y, int size) {
    v.measure(
        MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(size, MeasureSpec.EXACTLY));
    v.layout(x, y, x + size, y + size);
  }

  // ------------------------------------------------------------------------- glyphs

  enum Glyph {
    BACK,
    SEARCH,
    PREV,
    NEXT,
    REWIND,
    FORWARD,
    PLAY,
    PAUSE
  }

  /** Circular button: dark translucent disc + white glyph drawn with Paths. */
  static final class GlyphButton extends View {
    private final Paint mDisc = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint mInk = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint mText = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path mPath = new Path();
    private final RectF mOval = new RectF();
    private Glyph mGlyph;
    private boolean mDown;

    GlyphButton(Context context, Glyph glyph) {
      super(context);
      mGlyph = glyph;
      mDisc.setColor(0x99000000);
      mInk.setColor(0xFFFFFFFF);
      mInk.setStrokeCap(Paint.Cap.ROUND);
      mInk.setStrokeJoin(Paint.Join.ROUND);
      mText.setColor(0xFFFFFFFF);
      mText.setTextAlign(Paint.Align.CENTER);
      mText.setFakeBoldText(true);
      setClickable(true);
      setFocusable(true);
    }

    void setGlyph(Glyph glyph) {
      if (glyph != mGlyph) {
        mGlyph = glyph;
        invalidate();
      }
    }

    @Override
    public void setPressed(boolean pressed) {
      super.setPressed(pressed);
      if (mDown != pressed) {
        mDown = pressed;
        mDisc.setColor(pressed ? 0xCC000000 : 0x99000000);
        invalidate();
      }
    }

    @Override
    protected void onDraw(Canvas c) {
      float w = getWidth();
      float cx = w / 2f;
      float cy = getHeight() / 2f;
      float r = Math.min(w, getHeight()) / 2f - w * 0.04f;
      c.drawCircle(cx, cy, r, mDisc);
      float s = r * 0.5f;  // glyph half-size
      mInk.setStrokeWidth(Math.max(2f, r * 0.12f));
      mPath.reset();
      switch (mGlyph) {
        case PLAY:
          mInk.setStyle(Paint.Style.FILL);
          mPath.moveTo(cx - s * 0.6f, cy - s);
          mPath.lineTo(cx + s, cy);
          mPath.lineTo(cx - s * 0.6f, cy + s);
          mPath.close();
          c.drawPath(mPath, mInk);
          break;
        case PAUSE:
          mInk.setStyle(Paint.Style.FILL);
          c.drawRect(cx - s * 0.75f, cy - s, cx - s * 0.2f, cy + s, mInk);
          c.drawRect(cx + s * 0.2f, cy - s, cx + s * 0.75f, cy + s, mInk);
          break;
        case NEXT:
        case PREV:
          {
            mInk.setStyle(Paint.Style.FILL);
            float d = mGlyph == Glyph.NEXT ? 1f : -1f;
            mPath.moveTo(cx - d * s * 0.7f, cy - s * 0.8f);
            mPath.lineTo(cx + d * s * 0.4f, cy);
            mPath.lineTo(cx - d * s * 0.7f, cy + s * 0.8f);
            mPath.close();
            c.drawPath(mPath, mInk);
            float bx = cx + d * s * 0.55f;
            c.drawRect(Math.min(bx, bx + d * s * 0.2f), cy - s * 0.8f,
                Math.max(bx, bx + d * s * 0.2f), cy + s * 0.8f, mInk);
          }
          break;
        case REWIND:
        case FORWARD:
          {
            mInk.setStyle(Paint.Style.STROKE);
            float d = mGlyph == Glyph.FORWARD ? 1f : -1f;
            mOval.set(cx - s * 1.1f, cy - s * 1.1f, cx + s * 1.1f, cy + s * 1.1f);
            // Open circle arrow with the gap at the top.
            c.drawArc(mOval, d > 0 ? -60 : -120, d * 300, false, mInk);
            float ax = cx + d * s * 0.55f;
            float ay = cy - s * 0.95f;
            mInk.setStyle(Paint.Style.FILL);
            mPath.moveTo(ax + d * s * 0.45f, ay);
            mPath.lineTo(ax - d * s * 0.1f, ay - s * 0.4f);
            mPath.lineTo(ax - d * s * 0.1f, ay + s * 0.4f);
            mPath.close();
            c.drawPath(mPath, mInk);
            mText.setTextSize(s * 0.95f);
            c.drawText("10", cx, cy + s * 0.35f, mText);
          }
          break;
        case BACK:
          mInk.setStyle(Paint.Style.STROKE);
          c.drawLine(cx - s * 0.8f, cy, cx + s * 0.8f, cy, mInk);
          c.drawLine(cx - s * 0.8f, cy, cx - s * 0.1f, cy - s * 0.7f, mInk);
          c.drawLine(cx - s * 0.8f, cy, cx - s * 0.1f, cy + s * 0.7f, mInk);
          break;
        case SEARCH:
          mInk.setStyle(Paint.Style.STROKE);
          c.drawCircle(cx - s * 0.2f, cy - s * 0.2f, s * 0.55f, mInk);
          c.drawLine(cx + s * 0.2f, cy + s * 0.2f, cx + s * 0.8f, cy + s * 0.8f, mInk);
          break;
      }
    }
  }
}
