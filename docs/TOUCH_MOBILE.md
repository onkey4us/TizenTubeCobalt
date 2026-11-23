# TizenTube Cobalt cho điện thoại Android (m.youtube.com)

Nhánh `touch-mobile`. Bản này biến APK TizenTube Cobalt thành ứng dụng cho **điện thoại** (chỉ màn
ngang): tải giao diện YouTube dành cho điện thoại `https://m.youtube.com` thay vì giao diện TV
`youtube.com/tv`, và tự mang theo một userscript TizenTube viết riêng cho trang mobile (chặn quảng
cáo, SponsorBlock, tốc độ phát, phát nền / PiP, vừa khung / phủ kín). Không còn lớp giả lập D‑pad, không có
thanh nút nổi.

> Phương án cũ (giữ giao diện TV + giả lập phím mũi tên bằng cử chỉ) đã bị huỷ và **không** có
> trong nhánh này.

## 1. Thay đổi gì và vì sao

| Mục | Thay đổi | Lý do |
| --- | --- | --- |
| URL khởi động | `cobalt.APP_URL = https://m.youtube.com/` | Giao diện điện thoại vốn đã hỗ trợ cảm ứng, bàn phím ảo, chạm đúp tua. |
| User agent | UA Chrome Android dạng *Mobile* + client hints `mobile=?1` | Không có UA mobile thì YouTube trả bản desktop hoặc bản TV. |
| Tỉ lệ hiển thị | Bỏ `--force-device-scale-factor=1` khi chạy chế độ mobile | Giao diện TV cố định 1920×1080 ở tỉ lệ 1; m.youtube.com cần mật độ điểm ảnh thật của máy, nếu không chữ và nút rất nhỏ. Vì vậy **không** cần phóng 1,25–1,5×: trang mobile tự co giãn theo viewport. |
| Xoay / chia màn | v6: **không khoá hướng**, `resizeableActivity="true"` | Màn xe 1920×720 chạy app trong ô chia 3 (ô giữa gần vuông); đổi kích thước không tạo lại Activity. |
| Toàn màn hình | Immersive (ẩn thanh trạng thái + thanh điều hướng, vuốt từ mép để hiện tạm) | Theo wireframe. |
| Nút Back | Back = `history.back()` của trang; ở trang gốc thì đưa app xuống nền | Hành vi trình duyệt, thay cho phím Escape của TV. |
| Bàn phím ảo | Sửa đường IME để bàn phím Android gõ được vào `<input>` | Cobalt TV không bao giờ cần, nên đường này chưa từng được nối. |
| Userscript | 6 module JS đóng gói trong APK, chèn lúc document start | Không phụ thuộc jsdelivr khi chạy. |
| Splash TV | `cobalt.ENABLE_SPLASH_SCREEN=false` | Splash là trang của youtube.com/tv. |

### Công tắc khôi phục giao diện TV

Mọi thứ ở trên phụ thuộc **một** GN arg, mặc định bật trên nhánh này:

```gn
# out/android-arm64_qa/args.gn
tizentube_mobile_ui = false   # quay lại youtube.com/tv như bản gốc
```

Định nghĩa: `cobalt/android/tizentube_mobile.gni:24`. Luồng đi của công tắc:

1. `cobalt/android/BUILD.gn:26` truyền `tizentube_mobile_ui=$tizentube_mobile_ui` vào template manifest.
2. `cobalt/shell/android/shell_apk/AndroidManifest.xml.jinja2:3,74-87`: khi bật, sinh
   `resizeableActivity`, `APP_URL=https://m.youtube.com/`, meta-data `tizentube.MOBILE_UI=true`, tắt splash,
   dịch vụ `dev.cobalt.media.MediaPlaybackService` (`foregroundServiceType="mediaPlayback"`).
3. `CobaltActivity.isTizenTubeMobileUi()` (`cobalt/android/apk/app/src/main/java/dev/cobalt/coat/CobaltActivity.java:234`)
   đọc meta-data đó, thêm switch `--tizentube-mobile-ui` và `use-mobile-user-agent` vào command line.
4. Native: `switches::kTizenTubeMobileUI` (`cobalt/browser/switches.h:46`) bật UA mobile.

Khi `tizentube_mobile_ui=false` thì manifest, Java và C++ chạy đúng đường cũ (TV). Ngoại lệ duy nhất
là bỏ userscript jsdelivr trên host `m.youtube.com` (xem mục 2), mà host đó không xuất hiện ở bản TV.

Để thử nhanh trên máy dev (bản không phải `gold`), có thể ghi đè URL bằng intent:
`adb shell am start -n io.gh.reisxd.tizentube.cobalt/dev.cobalt.app.MainActivity --esa commandLineArgs --url=https://www.youtube.com/tv`.

## 2. Cách userscript được chèn vào trang

### Cơ chế có sẵn (đã tìm thấy)

Repo có **hai** đường chèn script:

1. **Userscript TizenTube cho TV (từ xa, jsdelivr)**: được chèn trong Blink, ở
   `Document::ImplicitClose()`, file `third_party/blink/renderer/core/dom/document.cc:4013-4054`.
   Mỗi tài liệu HTML được thêm một thẻ
   `<script src="https://cdn.jsdelivr.net/npm/@foxreis/tizentube/dist/userScript.js?v=<epoch>">`,
   kèm một script nhỏ dùng `fetch(..., {method:'HEAD'})` để báo lỗi khi jsdelivr bị chặn
   (`h5vcc.tizentube.ShowAlertDialog`). Script này nhắm vào giao diện leanback.
2. **Polyfill Cobalt đóng gói sẵn (cục bộ)**: mọi file trong
   `cobalt/shell/embedded_resources/cobalt_java_script_polyfill/` được action
   `//cobalt/shell:embed_polyfilled_javascript` (`cobalt/shell/BUILD.gn:537`, script
   `cobalt/build/generate_data_header.py`) nhúng vào header `embedded_js.h`. Sau đó
   `Shell::RegisterInjectedJavaScript()` (`cobalt/shell/browser/shell.cc:633`, gọi ở `:259`) đăng ký
   từng file qua `js_communication_host_->AddDocumentStartJavaScript(script, {"*"})` (`shell.cc:646`).
   Script chạy **lúc document start**, trước script của trang, ở mọi frame/origin. Có sẵn
   `html_media_element_extension_on_java_bridge.js`.

### Userscript mobile được gắn vào đâu

Userscript mobile đi theo **đường 2** (cục bộ, có sẵn trong APK, không cần mạng):

```
cobalt/shell/embedded_resources/cobalt_java_script_polyfill/
  tizentube_mobile_00_core.js      cấu hình, cài đặt (localStorage), chuỗi tiếng Việt, tiện ích DOM, xử lý Back
  tizentube_mobile_10_adblock.js   chặn quảng cáo
  tizentube_mobile_20_player.js    SponsorBlock + thông báo "Hoàn tác", tốc độ phát mặc định
  tizentube_mobile_25_layout.js    màn ngang tự phủ kín màn hình, ẩn "Mở ứng dụng"
  tizentube_mobile_30_settings.js  mục "Cài đặt TizenTube" trong menu tài khoản + bảng cài đặt
  tizentube_mobile_05_visibility.js giả visibility/focus khi "Khi chuyển app" ≠ Dừng phát (v6)
  tizentube_mobile_07_codec.js     chặn AV1, >1080p, >60 fps; VP9 chỉ khi có giải mã cứng (v7)
  tizentube_mobile_08_light.js     tắt xem trước trong feed, tắt hiệu ứng/bóng/glow (v7)
  tizentube_mobile_40_background.js báo Java video có đang phát (v6; thay module vuốt dọc cũ)
```

* Thứ tự chạy là thứ tự tên file (bản đồ `std::map` trong `generate_data_header.py`), nên có tiền tố số.
* Các file được liệt kê trong `inputs` của action (`cobalt/shell/BUILD.gn`) để sửa file thì bước build chạy lại.
* **Chặn theo host** (`isAllowedLocation` trong `00_core`): polyfill được chèn vào **mọi** trang và
  frame, kể cả `accounts.google.com` khi người dùng đăng nhập. Userscript chỉ chạy ở frame trên cùng
  của `https://m.youtube.com`, `https://www.youtube.com`, `https://youtube.com`, và không chạy dưới
  `/tv`. Trên mọi host khác (`accounts.google.com`, `accounts.youtube.com`, `consent.*`,
  `myaccount.google.com`, `music.youtube.com`, `studio.youtube.com`, tên miền giả như
  `m.youtube.com.evil.example`, `http:`) nó là no-op: không tạo `window.TTM`, không hook
  `JSON.parse`/`fetch`, không chạm DOM. Cờ harness chỉ được nhận trên `localhost`/`127.0.0.1`/`file:`.
  `window.TTM` được ghim bằng `defineProperty` (không ghi đè được). Kiểm thử:
  `node tools/touch_harness/host_guard_test.mjs` (23 URL) và trên accounts.google.com thật (mục 12).
* `00_core` định nghĩa `window.TTM`, các module sau dựa vào nó.
* Userscript jsdelivr (đường 1) **bị bỏ qua trên `m.youtube.com`**: đây là thay đổi duy nhất trong
  Blink, một điều kiện host ở `document.cc:4019`
  (`IsA<HTMLDocument>(this) && Url().Host() != "m.youtube.com"`). Nếu không bỏ, script TV sẽ chạy
  trên trang mobile và hộp thoại lỗi jsdelivr sẽ hiện khi mạng chặn CDN.

**Trusted Types:** m.youtube.com gửi `Content-Security-Policy: require-trusted-types-for 'script'`
(đã kiểm bằng `curl`). Gán chuỗi vào `innerHTML` sẽ ném lỗi, nên mọi module dựng DOM bằng
`createElement`/`createElementNS` (`TTM.el`, `TTM.svgIcon`). Harness bật đúng chính sách này để bắt lỗi sớm.

## 3. Các module userscript

### 3.1 Chặn quảng cáo (`10_adblock`)

Ba lớp, lớp sau dự phòng cho lớp trước:

1. **Dữ liệu**: xoá `adPlacements`, `adSlots`, `playerAds`, `adBreakHeartbeatParams` và các mục
   quảng cáo trong feed (`adSlotRenderer`, `promotedSparklesWebRenderer`, `inFeedAdLayoutRenderer`, …)
   *trước khi* YouTube đọc chúng: hook setter `window.ytInitialPlayerResponse` /
   `window.ytInitialData`, `JSON.parse` và `Response.prototype.json`. Hook phải có trước script của
   trang, nên dựa vào document start. Không có dữ liệu quảng cáo thì player không lên lịch ad break.
2. **CSS**: ẩn `ytm-promoted-sparkles-web-renderer`, `ad-slot-renderer`, `ytm-companion-ad-renderer`,
   `.ytp-ad-overlay-container`, … (danh sách `CSS_SELECTORS`).
3. **Quảng cáo vẫn chạy** (`.html5-video-player.ad-showing`): bấm nút Bỏ qua nếu có, nếu không thì
   tắt tiếng và nhảy tới cuối quảng cáo (hoặc phát nhanh 16×). Khôi phục tiếng và tốc độ khi hết.

Rủi ro: YouTube đổi tên khoá/thẻ thường xuyên. Khi quảng cáo lọt qua, hãy cập nhật `AD_ITEM_KEYS`,
`PLAYER_AD_KEYS`, `CSS_SELECTORS`, `SKIP_SELECTORS`.

### 3.2 SponsorBlock (`20_player`)

* Lấy video id từ `?v=` hoặc `/shorts/<id>`, `/live/<id>`; theo dõi điều hướng SPA (kiểm tra mỗi 250 ms).
* Gọi `https://sponsor.ajay.app/api/skipSegments?videoID=<id>&categories=[...]&actionTypes=["skip","mute"]`
  với cả 8 loại: `sponsor, selfpromo, interaction, intro, outro, preview, music_offtopic, filler`.
  404 nghĩa là video không có đoạn nào.
* Loại đang bật (mặc định: tài trợ, tự quảng bá, nhắc tương tác, không phải nhạc) được bỏ qua tự
  động; đoạn `mute` thì tắt tiếng trong khoảng đó.
* Khi bỏ qua, hiện thông báo ở **dưới** màn hình trong **4 giây** kèm nút **"Hoàn tác"**. Nền đen
  đục 85%, chữ trắng 15px; "Hoàn tác" đậm (700), màu xanh sáng `#a8d4ff` trên nền nút sáng hơn. Độ
  tương phản đo được kể cả khi video phía sau trắng: chữ 15:1, nút 5,9:1 (WCAG AA ≥ 4,5:1).
  Thông báo hiện **ngay** ở độ mờ 100% (không hiệu ứng hiện dần), chỉ mờ dần khi biến mất. Trước đây
  nó hiện dần 0→1 trong 200 ms, nên trong những khung hình đầu cả nền lẫn chữ đều trong suốt trên
  video (nhìn như chữ xám nhạt trên nền màu). Màu nền/chữ dùng `!important`.

| Loại | Chữ hiển thị |
| --- | --- |
| sponsor | Đã bỏ qua đoạn tài trợ |
| selfpromo | Đã bỏ qua đoạn tự quảng bá |
| interaction | Đã bỏ qua lời nhắc tương tác |
| intro | Đã bỏ qua đoạn mở đầu |
| outro | Đã bỏ qua đoạn kết |
| preview | Đã bỏ qua đoạn xem trước / tóm tắt |
| music_offtopic | Đã bỏ qua đoạn không phải nhạc |
| filler | Đã bỏ qua đoạn lan man |

* "Hoàn tác" tua về đầu đoạn và đánh dấu đoạn đó `suppressed`: lần này không bỏ qua lại. Khi phát
  ra khỏi đoạn, dấu được gỡ, nên lần sau quay lại đoạn đó vẫn bỏ qua như thường.
* Không chạy khi đang có quảng cáo.

### 3.3 Tốc độ phát (`20_player`)

Tốc độ mặc định (0,25× đến 3×) được áp dụng cho mỗi video mới ở sự kiện `loadedmetadata` (bắt ở
pha capture trên `document`), áp lại sau 800 ms vì player có thể đặt lại. Người dùng vẫn đổi tốc độ
trong menu của YouTube như bình thường cho video đang xem.

### 3.3b Bố cục, khung video, PiP và "Mở ứng dụng" (`25_layout`)

* **Tự phủ kín theo tỉ lệ cửa sổ (v6).** Chỉ khi `innerWidth/innerHeight > 1,6` (rộng hơn 16:10, ví
  dụ toàn màn 1280×480) và video trên trang xem đang phát, `<html>` mới được gắn `ttm-fill`: thanh đầu
  ẩn, `#player-container-id` ghim kín cửa sổ. Ở ô giữa gần vuông của màn chia 3 (427–900 px rộng,
  tỉ lệ 0,9–1,3) giữ **bố cục xem bình thường** của m.youtube.com (video trên, tiêu đề và danh sách
  liên quan dưới). Tính lại khi `resize`/`orientationchange` (chờ 250 ms, ngưỡng trễ vào 1,6 / ra 1,5
  để không nhấp nháy), không tải lại trang. Chụm hai ngón (xem dưới) vẫn vào phủ kín bằng tay.
* **Khung video (v6).** Mặc định **Vừa khung** = `object-fit: contain` (thấy trọn khung, có viền đen),
  ở cả bố cục thường lẫn phủ kín. **Phủ kín** = `cover` (cắt mép). Cài đặt "Khung video"; **chụm hai
  ngón** trên video đổi qua lại: kéo ra → Phủ kín, chụm vào → Vừa khung, kèm thông báo ngắn giữa màn.
  Chỉ xét chạm **2 ngón**, nên chạm 1 lần và chạm đúp ±10 s của YouTube không bị ảnh hưởng. Mỗi video
  mới quay về mặc định.
* **PiP.** `CobaltActivity.onPictureInPictureModeChanged()` gắn `<html>.ttm-pip` và phát sự kiện
  `tizentube-pip`; module hiện **chỉ video** (phủ kín, ẩn thanh đầu, điều khiển YouTube, toast, bảng
  cài đặt) và trả lại như cũ khi thoát PiP.
* **Vì sao không dùng Fullscreen API.** Đã thử trên m.youtube.com thật: mọi kiểu toàn màn hình
  "thật" (`requestFullscreen` trên container hoặc `<html>`) và cả `body[faux-fullscreen]` của
  YouTube đều khiến YouTube kéo `#player-control-container` phủ lên video, và **chạm đúp ±10 s gốc
  ngừng hoạt động**. Lớp phủ CSS giữ nguyên bố cục đó nên chạm đúp vẫn chạy. Hằng
  `USE_FULLSCREEN_API` (mặc định `false`) giữ lại đường API để thử sau.
* Chỉ ghim container ngoài cùng. `#player` / `#movie_player` vẫn theo luồng bình thường.
* **Ẩn "Mở ứng dụng".** Tìm theo **chữ** ("Mở ứng dụng", "Open App", …) hoặc link `intent:`/
  `vnd.youtube:`/Play Store trong thanh đầu và các khối quảng bá app, gắn lớp `ttm-app-promo`. Không ẩn
  cả thanh đầu.

### 3.4 Cài đặt (`30_settings`): không có nút nổi

Mục **"Cài đặt TizenTube"** (biểu tượng bánh răng, cao 48px) được chèn **vào menu tài khoản** của
m.youtube.com (bấm ảnh đại diện). Bấm vào sẽ mở bảng cài đặt:

* Chặn quảng cáo
* SponsorBlock (tự bỏ qua đoạn) và **từng loại đoạn**
* Tốc độ phát mặc định
* Khung video: Vừa khung (mặc định) / Phủ kín
* Tự động toàn màn hình khi xem (màn rộng)
* **Khi chuyển app**: Chỉ phát âm thanh (mặc định) / Cửa sổ nổi (PiP) / Dừng phát
* Dòng thông tin `DPR … · màn …×… · khung …×…` (cập nhật khi đổi kích thước) để biết DPR thật của màn xe

Bảng cài đặt cao tối đa **85vh** (≈350 px trên màn ngang 412 px). Phần đầu (tiêu đề + nút **✕**
48×48 ở góc trên phải, `aria-label="Đóng"`) cố định, chỉ phần thân cuộn (`overflow-y: auto`), nên mục
"Mở đầu" và các mục dưới luôn tới được. **Không có nút "Đóng" ở dưới**: đóng bằng ✕, nút Back
Android, hoặc chạm ra ngoài bảng. Ở 915×412 thấy trọn 5 dòng cài đặt (thân bảng 297 px). Nhận dạng cử chỉ bỏ qua các lớp phủ của TizenTube
(`#ttm-sheet-backdrop`, `#ttm-skip-toast`, `#ttm-level`), nên vuốt trong bảng là cuộn, không chỉnh âm
lượng (trước đây trong trình phát toàn màn hình vuốt bị nhận nhầm và chặn cuộn).

Lưu trong `localStorage` khoá `tizentube_mobile_settings_v1` (theo origin m.youtube.com). Nút Back
Android đóng bảng trước khi điều hướng.

**Cách chọn phần tử** (markup m.youtube.com hay đổi, nên chỉ dựa vào tên custom element, không
dựa vào class sinh tự động):

* Chính: `ytm-multi-page-menu-renderer`, `ytm-account-section-list-renderer`, `ytm-account-menu`.
  Mục được chèn trước `ytm-compact-link-renderer` đầu tiên (hoặc nối vào cuối).
* **Khi chưa đăng nhập** (không có ảnh đại diện / menu tài khoản): phần tài khoản là tab **"Bạn"**
  (`/feed/library`), trang này chỉ có `ytm-sign-in-promo-with-background-renderer`. Mục được chèn
  ngay trên khối mời đăng nhập, là một dòng trong trang (cuộn theo trang, không nổi). Đã kiểm trên
  m.youtube.com thật.
* Dự phòng, chỉ khi không có menu tài khoản (ví dụ trong trình phát toàn màn hình): bảng menu
  tràn của trình phát `ytm-bottom-sheet-renderer`, `ytm-menu-popup-renderer`, `.player-settings-menu`.
* `MutationObserver` trên `<body>` (gộp theo `requestAnimationFrame`) chèn lại khi YouTube vẽ lại menu.

Khi YouTube đổi tên thẻ, chỉ cần sửa `ACCOUNT_MENU_SELECTORS` / `FALLBACK_MENU_SELECTORS`.

### 3.5 Không còn vuốt dọc (v6)

Vuốt dọc chỉnh âm lượng/độ sáng, ô chỉ báo giữa màn và dải loại trừ 32 px ở mép đã **bỏ hẳn**
(xe có phím âm lượng và độ sáng tự động). Màn video giữ đơn giản: chạm 1 lần hiện điều khiển, chạm đúp
trái/phải tua 10 s (hành vi gốc của YouTube; không listener nào của TizenTube nghe chạm 1 ngón trên
player), chụm hai ngón đổi Vừa khung/Phủ kín.

### 3.6 Giữ trang "đang hiện" (`05_visibility`, v6)

Khi "Khi chuyển app" là **Chỉ phát âm thanh** hoặc **Cửa sổ nổi (PiP)**, chạy ở document start trước
mọi script YouTube:

* `document.hidden === false`, `visibilityState === 'visible'` (cả bản `webkit*`), `document.hasFocus()
  === true` (getter trên `Document.prototype`);
* chặn ở pha capture trên `window` (listener đầu tiên): `visibilitychange`, `webkitvisibilitychange`,
  `pagehide` (trừ khi đang rời trang thật, `beforeunload`), `freeze`, `resume`, `blur` **của cửa sổ**
  (blur của ô nhập/nút vẫn tới trang).

Lý do: trên Android 9 chia màn, chạm vào ô bản đồ làm cửa sổ của ta mất focus (onPause) dù vẫn hiện;
m.youtube.com dừng video khi mất focus/ẩn. **Dừng phát**: không giả gì (hành vi gốc). Thay đổi trong
`document.cc` chỉ bỏ userscript jsdelivr trên m.youtube.com, không đụng tới visibility, nên hai bên
không xung đột.

## 4. Cầu nối native (`window.TizenTubeMobile`, v6)

`dev.cobalt.coat.javabridge.TizenTubeMobileBridge` được gắn qua JavaBridge có sẵn của Cobalt
(`JavascriptInjector.addPossiblyUnsafeInterface` trong `CobaltActivity.initializeJavaBridge()`), chỉ
ở chế độ mobile và **chỉ cho origin** `https://m.youtube.com`, `https://www.youtube.com`,
`https://youtube.com`. Phương thức `@CobaltJavaScriptInterface`:

| Hàm JS | Java | Ghi chú |
| --- | --- | --- |
| `getBridgeVersion()` | | `2` (v6) |
| `getLeaveMode()` / `setLeaveMode('audio'\|'pip'\|'stop')` | `SharedPreferences("tizentube_mobile").leave_mode` | Lưu bền; Java đọc **trước khi trang tải** (`readLeaveMode` trong `createContent`) để `onUserLeaveHint`/`onStop` biết chế độ kể cả khi trang chưa chạy. JS gọi `setLeaveMode` mỗi lần lưu cài đặt; lúc khởi động JS lấy giá trị Java làm chuẩn. |
| `setPlaying(bool)` | `CobaltActivity.onTizenTubePlaybackChanged()` | Module 40 báo `<video>` chính đang phát/dừng; Java gộp với trạng thái MediaSession của Chromium (`CobaltMediaSession.isPlaying()`). |

Lời gọi chạy trên luồng nền; thay đổi được chuyển về luồng chính (`Handler`). Hàm âm lượng/độ sáng
của v5 đã bỏ.

## 4b. Khi chuyển app: phát nền, PiP, chia màn (v6)

**Chỉ phát âm thanh (mặc định)**, khi `onStop` lúc đang phát:

1. `CobaltActivity.onStop()` quyết định **trước** `super.onStop()`: đặt
   `CobaltMediaSession.setKeepActiveInBackground(true)` để `StarboardBridge.onActivityStop()` không
   huỷ MediaSession (thông báo + phím media vẫn chạy).
2. **Không** gọi `updateShellActivityVisible(false)`: WebContents giữ `VISIBLE`, Blink không phát
   `visibilitychange`, Chromium không đưa renderer xuống nền. Thêm cờ dòng lệnh (chế độ mobile):
   `--disable-background-media-suspend` (WebMediaPlayerImpl không treo pipeline khi trang ẩn;
   Android mặc định `kIsBackgroundMediaSuspendEnabled = true`), `--disable-renderer-backgrounding`,
   `--disable-background-timer-throttling` (JS SponsorBlock / tự phát tiếp vẫn chạy đúng giờ).
3. Khởi động `dev.cobalt.media.MediaPlaybackService`: dịch vụ tiền cảnh `mediaPlayback`
   (`startForegroundService` từ API 26, `startService` dưới đó; `startForeground(id, n,
   FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)` từ API 29). Kênh thông báo "Đang phát" (API 26+),
   `Notification.MediaStyle` gắn token MediaSession framework (`MediaSessionCompat.Token.getToken()`),
   nút Phát/Tạm dừng → `CobaltMediaSession.sendPlayPause()` (cùng đường phím media), chạm thông báo mở
   lại app.
4. Android huỷ `SurfaceView` video nên bộ giải mã video Starboard dừng codec (**video ngừng giải
   mã**); **âm thanh vẫn phát** (đồng hồ phát lại theo audio renderer). Quay lại app (`onStart`):
   dừng dịch vụ, bỏ cờ giữ MediaSession, SurfaceView được tạo lại (`mForceCreateNewVideoSurfaceView`)
   và codec dựng lại ở khung kế tiếp.
5. Dừng dịch vụ ở `onStart`, `onDestroy`, hoặc khi vuốt app khỏi Gần đây (`onTaskRemoved`). Khi tạm
   dừng từ thông báo, thông báo vẫn ở lại (nút Phát).

**Cửa sổ nổi (PiP)**: `onUserLeaveHint()` vào PiP 16:9 (`PictureInPictureParams`, API 26+) **chỉ khi**
đang phát **và** máy có `FEATURE_PICTURE_IN_PICTURE` **và không** ở chế độ chia màn
(`isInMultiWindowMode()`). API 31+: dùng `setAutoEnterEnabled(...)` (cập nhật khi đổi chế độ / phát /
chia màn) thay cho gọi tay. Không có PiP (thường gặp ở đầu xe), API < 26, hoặc đang chia màn → **tự
quay về Chỉ phát âm thanh** (ghi log). Vào PiP gọi `onPause` (không `onStop`): ở chế độ mobile
`onPause` **không** blur trang nữa, nên video không dừng. `onPictureInPictureModeChanged` báo trang
(`ttm-pip`).

**Dừng phát**: như Cobalt gốc (`onPause` blur trang, `onStop` ẩn WebContents, huỷ MediaSession).

**Chia màn (launcher 3 ô của xe)**: không khoá hướng, `resizeableActivity="true"`; `configChanges` đã
gồm `orientation|screenSize|smallestScreenSize|screenLayout` nên đổi kích thước ô **không tạo lại
Activity, không tải lại trang** (`onMultiWindowModeChanged`/`onConfigurationChanged` chỉ ghi log và
cập nhật PiP params). `onPause` khi chạm ô khác: không blur trang (trừ khi Dừng phát), userscript chặn
`blur` cửa sổ.

**Giới hạn / chưa kiểm**: chưa biên dịch, chưa chạy trên đầu xe. Đường phát nền dựa trên việc
Starboard audio renderer tiếp tục khi codec video bị huỷ (đọc mã: `MediaCodecVideoDecoder::
OnSurfaceDestroyed` → `TeardownCodec`, ghi đầu vào sau đó bỏ qua; đồng hồ là audio renderer). Nếu
trên máy thật video renderer chặn audio (thiếu khung), cần thêm bước tắt track video — Starboard
renderer hiện **không** hỗ trợ `OnTracksChanged`, nên tối ưu "tắt track video khi ẩn" của Chromium
không áp dụng. API 33+: thông báo cần quyền `POST_NOTIFICATIONS` để **hiện**, dịch vụ vẫn chạy.

## 5. Nút Back, toàn màn hình, xoay màn hình

* **Nút Back phần cứng và cử chỉ Back** đều vào `CobaltActivity.handleMobileBack()` (`CobaltActivity.java:479`):
  1. Đang toàn màn hình (video) → thoát toàn màn hình.
  2. Gọi `window.__tizentubeMobileHandleBack()`: nếu bảng cài đặt TizenTube đang mở thì đóng.
  3. Nếu còn trang trước trong lịch sử web → `history.back()` (router SPA của YouTube xử lý).
  4. Nếu đang ở trang gốc → `moveTaskToBack(true)` (giống `requestSuspend()` của Cobalt; app không bị huỷ).
  5. Nếu script không chạy được (renderer chưa sẵn sàng) → `NavigationController.goBack()` hoặc về nền.

  `canGoBack()` bỏ qua mục `about:blank` mà `ShellManager.launchShell("")` tạo trước URL khởi động.
  Android 13+ có thể báo cùng một lần bấm qua cả key event lẫn `OnBackInvokedCallback`, nên có chống
  lặp 300 ms. Ở chế độ TV, đường cũ (gửi `KEYCODE_BACK` → Escape cho Kabuki) giữ nguyên.
* **Immersive**: `enterImmersiveMode()` (`CobaltActivity.java:543`) dùng `WindowInsetsController`
  (API 30+) để ẩn `statusBars | navigationBars`, hành vi `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, vẽ
  vào cả vùng tai thỏ (`LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`). API < 30 dùng
  `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`. Áp lại ở `onWindowFocusChanged` (sau hộp thoại/IME).
  `decorFitsSystemWindows` được giữ `true` để `adjustResize` vẫn thu nhỏ trang khi bàn phím mở.
* **Xoay / chia màn (v6)**: không khoá hướng, `resizeableActivity="true"`. `configChanges` đã có
  `orientation|screenSize|smallestScreenSize|screenLayout` nên xoay hoặc đổi ô chia màn không tạo lại
  Activity.
* **Manifest**: chỉ có **một** template dùng chung cho cả bản TV
  (`cobalt/shell/android/shell_apk/AndroidManifest.xml.jinja2`, được `//cobalt/android:cobalt_manifest` dùng). Giữ nguyên
  `android.hardware.touchscreen required="false"` và `android.software.leanback required="false"` để
  cùng manifest vẫn cài được trên TV, và `LAUNCHER` + `LEANBACK_LAUNCHER` để có icon trên cả điện
  thoại lẫn TV. `required="false"` không ngăn cài trên điện thoại.
* **CSP**: bản `gold` (`cobalt_is_release_build`) mặc định huỷ mọi điều hướng thiếu header
  `Content-Security-Policy` (`cobalt/browser/cobalt_secure_navigation_throttle.cc`). m.youtube.com có
  header này, nhưng luồng đăng nhập/đồng ý của Google đi qua nhiều trang, nên chế độ mobile thêm
  `--csp-enforcement=false` (vẫn ghi đè được bằng intent ở bản không phải gold). HTTPS‑only
  (`--https-enforcement`) **không** đổi.

## 6. User agent

`GetCobaltUserAgent()` / `GetCobaltUserAgentMetadata()` trong
`cobalt/browser/cobalt_content_browser_client.cc:210-255`. Khi có `--tizentube-mobile-ui`, UA được
lấy từ `embedder_support::GetUserAgent()` của Chromium cùng với `--use-mobile-user-agent`, nên số
phiên bản Chrome **luôn khớp** Chromium đi kèm (M138, theo `chrome/VERSION`) và khớp client hints
(`Sec-CH-UA-Mobile: ?1`, `Sec-CH-UA-Platform: "Android"`). Chuỗi UA thực tế:

```
Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36
```

(`Android 10; K` và `.0.0.0` là dạng UA rút gọn chuẩn của Chrome hiện nay.) Thứ tự ưu tiên giữ nguyên:
`h5vcc.tizentube.SetUserAgent()` (`user_agent_override`) > `--user-agent` (bản không phải official) > UA mobile.
`DeviceUtils.updateDeviceSpecificUserAgentSwitch()` bỏ cờ mobile trên màn ≥ 600dp (máy tính bảng);
`CobaltActivity` thêm lại để mọi máy đều nhận m.youtube.com.

Đã kiểm bằng `curl -A '<UA trên>' https://m.youtube.com/` → HTTP 200, trang mobile.

## 7. Bàn phím ảo (IME) cho ô tìm kiếm

**Phát hiện:** Cobalt dùng `ImeAdapterImpl` của Chromium và `windowSoftInputMode="adjustResize"`,
nhưng container view truyền cho `ShellViewAndroidDelegate` là `android.R.id.content` (một
`FrameLayout` thường) (`Shell.java`, `initFromNativeTabContents`). `ImeAdapterImpl` gọi bàn phím với
container đó, và `ThreadedInputConnectionProxyView` gọi lại `containerView.onCreateInputConnection()`.
Một `FrameLayout` thường trả `null`, nên bàn phím có thể hiện nhưng **không gõ được** vào `<input>`
(TV không cần vì dùng bàn phím lưới của Kabuki). Chromium thường dùng `ContentView` (cùng gói
`components/embedder_support`) để chuyển tiếp lời gọi này.

**Sửa (chỉ ở chế độ mobile, TV giữ nguyên):**

* `ContentViewRenderView.setImeContainerEnabled(true)` (`cobalt/shell/android/java/src/dev/cobalt/shell/ContentViewRenderView.java:363`):
  view trở thành focusable, chuyển `onCreateInputConnection` / `onCheckIsTextEditor` sang
  `ImeAdapter.fromWebContents(...)` và báo focus cho `ViewEventSink`, giống `ContentView`.
* `Shell.setUseRenderViewAsImeContainer(true)` khiến `ShellViewAndroidDelegate` dùng
  `ContentViewRenderView` làm container (`Shell.java:196`). `CobaltActivity` bật cờ này ở chế độ mobile.
* `adjustResize` giữ nguyên: trang co lại phía trên bàn phím, ô tìm kiếm không bị che.

**Rủi ro còn lại (chưa kiểm được trên máy thật vì không build được ở đây):**

* Lần đầu chạm vào ô tìm kiếm, focus của view Android phải ở `ContentViewRenderView`; nếu
  `VideoSurfaceView` hoặc view khác giữ focus thì cần chạm lại. `setImeContainerEnabled` có gọi
  `requestFocus()`, và `onResume` của Cobalt `requestFocus()` root view.
* Bàn phím có thể kéo thanh điều hướng hiện lên tạm; `onWindowFocusChanged` áp lại immersive sau khi đóng.
* Nếu vẫn không gõ được: bật `DEBUG_LOGS` trong `ImeAdapterImpl` và xem `onCreateInputConnection returns null`.

## 8. Tham chiếu cử chỉ (theo wireframe v1 và yêu cầu mới)

| Ở đâu | Cử chỉ | Kết quả | Xử lý bởi |
| --- | --- | --- | --- |
| Mọi nơi | Cuộn, chạm, gõ | Như trình duyệt di động | m.youtube.com |
| Trình phát | Chạm 1 lần | Hiện/ẩn điều khiển | YouTube |
| Trình phát | Chạm đúp trái/phải | Tua −10s / +10s | YouTube |
| Trình phát | Kéo thanh tiến trình | Tua, ảnh xem trước | YouTube |
| Trình phát | **Chụm hai ngón** | Vừa khung ↔ Phủ kín + thông báo ngắn | TizenTube |
| Rời app | Home / chuyển app | Theo "Khi chuyển app": phát nền / PiP / dừng | TizenTube + Android |
| Mọi nơi | Nút/cử chỉ Back | Đóng bảng TT → thoát toàn màn hình → `history.back()` → về nền | TizenTube + Android |
| Menu tài khoản | "Cài đặt TizenTube" | Mở bảng cài đặt | TizenTube |
| Ô tìm kiếm | Chạm | Bàn phím Android | Chromium IME |

Mục tiêu chạm ≥ 48dp: các nút của TizenTube (mục menu, công tắc, nút "Hoàn tác", ✕) có
`min-height` 48px hoặc 40px trong vùng 48px. Trang dùng mật độ thật nên 1 CSS px = 1 dp.

## 9. Harness thử nghiệm

`tools/touch_harness/`: trang giả lập m.youtube.com (header, nút tài khoản → `ytm-multi-page-menu-renderer`,
ô tìm kiếm, trình phát `#movie_player.html5-video-player` với `<video>` thật 60 s, quảng cáo giả có
nút Bỏ qua, feed chứa thẻ quảng cáo, menu tràn `ytm-bottom-sheet-renderer`, đoạn SponsorBlock giả,
cầu nối Android giả). Nó tải **module thật** từ `cobalt/shell/embedded_resources/cobalt_java_script_polyfill/`
(đồng bộ, trước `<body>`, giống document start) và bật Trusted Types như m.youtube.com.

```bash
# từ thư mục gốc repo
python3 -m http.server 8000
# mở http://localhost:8000/tools/touch_harness/
# DevTools → Toggle device toolbar (Ctrl+Shift+M), chọn điện thoại, xoay ngang
```

Có thể thử: vuốt dọc trái/phải (log `bridge:` và lớp phủ tối), tua tới 4 s → bỏ qua đoạn tài trợ →
"Hoàn tác", "Phát quảng cáo giả", "Thử lọc JSON quảng cáo", nút tài khoản → "Cài đặt TizenTube",
nút ⋮ (vị trí dự phòng), "Video kế tiếp" (điều hướng SPA), "Nút Back Android", bật/tắt cầu nối giả
(chế độ dự phòng), gọi API SponsorBlock thật.

Nếu chỉ phục vụ riêng thư mục harness, hãy chép module vào `tools/touch_harness/modules/`; loader
sẽ tự dùng thư mục đó.

Kiểm thử tự động (Chrome headless qua DevTools Protocol, Node ≥ 22, không cần npm):

```bash
python3 -m http.server 8765 --bind 127.0.0.1 &
node tools/touch_harness/e2e_cdp.mjs     # CHROME=/đường/dẫn/chrome nếu cần
```

## 10. Build APK Android

Không thể build toàn bộ trên máy dev nhỏ; dưới đây là đúng quy trình của repo.

### Quy trình gốc (trích từ repo)

`.github/workflows/android_27.lts.yaml` gọi workflow tái sử dụng `.github/workflows/main.yaml` với
`platform: android-arm64` (cấu hình `.github/config/android-arm64.json`, target `cobalt:gn_all`,
`test_root_target //cobalt/android:cobalt_apk`). Job build trong `main.yaml`:

* chạy trên `runs-on: [self-hosted, chrobalt-linux-runner]` (mặc định của `build_runners`), trong
  container dựng từ `cobalt/docker/linux/Dockerfile` và đẩy lên `ghcr.io` bởi job `docker-build-image`
  (cũng self-hosted);
* `.github/actions/depot_tools`: clone depot_tools pin `4a978d8f1f3567d5bd729aec018bfc345a14e1cd`,
  `gclient config --name=src --custom-var=rbe_instance="projects/cobalt-actions-prod/instances/default_instance" <repo>`,
  `target_os=['android']`, `gclient sync --shallow --no-history --nohooks --force --delete_unversioned_trees --revision <sha>`,
  `gclient runhooks`; xác thực GoB bằng gcloud;
* `.github/actions/build`: `cobalt/build/gn.py -p android-arm64 -C <devel|qa|gold>` (mặc định bật
  RBE/Siso với `SISO_CREDENTIAL_HELPER=gcloud`), rồi ninja; APK bản `qa` được lưu artifact từ
  `out/android-arm64_qa/apks/*.apk`.

Cấu hình GN: `cobalt/build/configs/android-arm64/args.gn` (`target_cpu = "arm64"`, import
`android_common.gn` → `chromium_android.gn` + `common.gn`). `gn.py` thêm `build_type`:
`devel` (`symbol_level=1`), `qa` (`is_official_build=true`), `gold` (`is_official_build=true`,
`cobalt_is_release_build=true`). Target APK: `cobalt/android:cobalt_apk` (cũng là `GN_TARGET` của
Kokoro, `cobalt/devinfra/kokoro/build/android/arm64-coat/common.gcl`). File ra: `out/android-arm64_<config>/apks/Cobalt.apk`.

**Bản phát hành TizenTube** (`gh release view v2.0.3 -R reisxd/TizenTubeCobalt`): chỉ có tệp
`cobalt-arm.apk` và `cobalt-arm64.apk` tải lên tay; trong repo **không** có workflow phát hành. Nhiều
khả năng tác giả build trên máy riêng theo đúng các bước trên.

### Build thủ công (máy Linux x64 mạnh)

```bash
mkdir tt && cd tt
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
git -C depot_tools checkout 4a978d8f1f3567d5bd729aec018bfc345a14e1cd
export PATH="$PWD/depot_tools:$PATH" DEPOT_TOOLS_UPDATE=0
gclient config --name=src https://github.com/onkey4us/TizenTubeCobalt.git
echo "target_os=['android']" >> .gclient
gclient sync --shallow --no-history --nohooks --force --delete_unversioned_trees --revision touch-mobile
gclient runhooks
cd src
cobalt/build/gn.py -p android-arm64 -C qa --no-rbe
# (tuỳ chọn) echo 'tizentube_mobile_ui = false' >> out/android-arm64_qa/args.gn   # bản TV
autoninja -C out/android-arm64_qa cobalt/android:cobalt_apk
adb install -r out/android-arm64_qa/apks/Cobalt.apk
```

`--no-rbe` là bắt buộc nếu không có quyền vào RBE của Google (`projects/cobalt-actions-prod`).
Các DEPS nội bộ (`checkout_cobalt_internal`, `checkout_src_internal`) mặc định `False`, nên sync
được mà không cần tài khoản Google.

### Workflow GitHub Actions đề xuất: `.github/workflows/android_touch_mobile.yaml`

Kích hoạt bằng tay (`workflow_dispatch`) **hoặc** đẩy tag `build-apk-*`. GitHub chỉ cho
`workflow_dispatch` khi file workflow đã nằm trên nhánh mặc định; khi nó mới ở nhánh `touch-mobile`
thì dùng tag (chạy với giá trị mặc định: `qa`, bản mobile, `ubuntu-latest`, 360 phút):

```bash
git tag build-apk-1 touch-mobile && git push fork build-apk-1
```

Các input của `workflow_dispatch`:

* `config`: `devel` / `qa` (mặc định) / `gold`;
* `mobile_ui`: giá trị `tizentube_mobile_ui` (bỏ chọn = bản TV);
* `runner`: nhãn `runs-on` dạng JSON, mặc định `"ubuntu-latest"`, ví dụ `["self-hosted","linux","x64"]`;
* `timeout_minutes`: mặc định 360.

Các bước giống `dind_build.sh` / `.github/actions/depot_tools` + `.github/actions/build`: dọn đĩa
(chỉ runner GitHub), cài gói từ `cobalt/docker/linux/Dockerfile`, checkout, depot_tools pin, `gclient
config/sync/runhooks`, `gn.py -p android-arm64 -C <config> --no-rbe`, thêm `tizentube_mobile_ui`,
`autoninja ... cobalt/android:cobalt_apk`, tải APK lên artifact (cùng glob với bước
"Archive Android APKs" của `.github/actions/build`).

**Vì sao không gọi thẳng `main.yaml`:** job build của nó cần runner self-hosted `chrobalt-linux-runner`,
image docker do job self-hosted đẩy lên ghcr, xác thực GoB/RBE bằng gcloud của Google, và chạy kèm
các job test trên thiết bị (`odt-runner`). Fork không có những thứ này, nên workflow mới là một job
độc lập, chép đúng các lệnh.

**Giới hạn runner GitHub (`ubuntu-latest`)**: khoảng 4 vCPU, 16 GB RAM, ~14 GB đĩa trống (khoảng
70–90 GB sau khi xoá toolchain có sẵn), tối đa 6 giờ mỗi job. Checkout Chromium/Cobalt + Android SDK/NDK
cộng thư mục `out/` cần cỡ **100 GB trở lên**, và build không có RBE mất **nhiều giờ CPU**. Lần build
nguội trên runner miễn phí **gần như chắc chắn hết đĩa hoặc hết giờ**. Nên dùng:

* runner self-hosted (khuyên ≥ 16 nhân, ≥ 32 GB RAM, ≥ 250 GB SSD), đặt input `runner`
  là `["self-hosted","linux","x64"]` và `timeout_minutes` lớn hơn; hoặc
* "larger runner" trả phí của GitHub (ví dụ 16‑core / 600 GB), đặt nhãn tương ứng.

## 11. Danh sách tệp

| Tệp | Vai trò |
| --- | --- |
| `cobalt/android/tizentube_mobile.gni` | GN arg `tizentube_mobile_ui` (mặc định `true`). |
| `cobalt/android/BUILD.gn` | Truyền arg vào manifest; thêm `TizenTubeMobileBridge.java`. |
| `cobalt/shell/android/shell_apk/AndroidManifest.xml.jinja2` | `APP_URL`, `resizeableActivity`, `tizentube.MOBILE_UI`, tắt splash, `MediaPlaybackService` (có điều kiện). |
| `cobalt/android/apk/app/src/main/java/dev/cobalt/coat/CobaltActivity.java` | Cờ mobile, bỏ ép scale factor, tắt ép CSP, UA mobile, immersive, Back, cầu nối JS. |
| `cobalt/android/apk/app/src/main/java/dev/cobalt/coat/javabridge/TizenTubeMobileBridge.java` | Cầu nối: chế độ "Khi chuyển app" (SharedPreferences), trạng thái phát. |
| `cobalt/android/apk/app/src/main/java/dev/cobalt/media/MediaPlaybackService.java` | Dịch vụ tiền cảnh phát nền + thông báo MediaStyle (v6). |
| `cobalt/android/apk/app/src/main/java/dev/cobalt/coat/CobaltMediaSession.java` | Giữ MediaSession khi phát nền, trạng thái/metadata cho thông báo (v6). |
| `cobalt/shell/android/java/src/dev/cobalt/shell/Shell.java` | Chọn `ContentViewRenderView` làm container IME. |
| `cobalt/shell/android/java/src/dev/cobalt/shell/ContentViewRenderView.java` | Chuyển tiếp `onCreateInputConnection` / focus tới ImeAdapter. |
| `cobalt/browser/switches.h` | Switch `--tizentube-mobile-ui`. |
| `cobalt/browser/cobalt_content_browser_client.cc`, `cobalt/browser/BUILD.gn` | UA + client hints mobile. |
| `cobalt/shell/BUILD.gn` | Khai báo `inputs` cho các file JS nhúng. |
| `cobalt/shell/embedded_resources/cobalt_java_script_polyfill/tizentube_mobile_*.js` | Userscript mobile (6 module). |
| `third_party/blink/renderer/core/dom/document.cc` | Bỏ userscript jsdelivr (TV) trên `m.youtube.com`. |
| `tools/touch_harness/*` | Harness + kiểm thử tự động (`e2e_cdp.mjs`, `host_guard_test.mjs`). |
| `.github/workflows/android_touch_mobile.yaml` | Workflow build APK arm64 chạy tay. |

## 4c. v7: nhẹ hơn, render đóng băng, lớp phủ native, phím vô lăng

**Bản release (gold).** Đã rà `cobalt_is_release_build` / `COBALT_IS_RELEASE_BUILD` /
`is_official_build` / `OFFICIAL_BUILD`:
* Userscript (`embed_polyfilled_javascript`, `Shell::RegisterInjectedJavaScript`), JavaBridge
  (`JavascriptInjector`, `TizenTubeMobile`, `HTMLMediaElementExtension`), `tizentube_mobile_ui`,
  các cờ dòng lệnh của chế độ mobile (`getCommandLineArgs`): **không bị chặn**. `isReleaseBuild()`
  chỉ bỏ `commandLineArgs` từ intent (tham số adb), không ảnh hưởng cờ của ta.
* Gold mặc định bật CSP (`CobaltSecureNavigationThrottle`) → chế độ mobile đã thêm
  `--csp-enforcement=false` (có từ trước). HTTPS-only vẫn bật (m.youtube.com là https).
* `app_event_runner.cc` (gold ép URL khởi động về `youtube.com/tv`) và `SetMinLogLevel(FATAL)` chỉ ở
  `BUILDFLAG(IS_STARBOARD)`; `is_starboard = false` khi `target_os == "android"` → **không áp dụng**.
* Gold tắt DevTools (`CreateDevToolsManagerDelegate` → null), proxy dòng lệnh, heap profiling: không
  cần cho app.
* `ui/gfx/gpu_memory_buffer.cc`: bỏ `NOTIMPLEMENTED()` ở nhánh Android của `Clone()` (Android không có
  native handle để clone ở đây) → hết spam `gpu_memory_buffer.cc:148 Not implemented`.
* `version_code` 203 → **204** (gói giữ nguyên, keystore debug giữ nguyên).

**Trang nhẹ hơn (`08_light`).** Tắt xem trước tự phát trong feed: cờ thử nghiệm của m.youtube.com
(`enable_inline_muted_playback_on_web_search*`, `mweb_mixes_inline_playback`, …) bị ép `false` khi
YouTube ghi `ytcfg` (hook `window.ytcfg` + `ytcfg.set`), ẩn `ytm-video-preview-portal` và các khung
inline-player, và chặn cứng: `<video>` ngoài trình phát trang xem bị `pause()`, `play()` trả
`NotAllowedError`. CSS toàn trang: transition/animation **1 ms** (không phải `none`, để
`transitionend`/`animationend` của YouTube vẫn chạy, menu/bảng vẫn đóng), animation vô hạn chỉ chạy 1
lần (spinner đứng yên), `box-shadow`/`backdrop-filter: none`, tắt lớp "cinematic" (canvas mờ vẽ lại mỗi
khung) sau trình phát. Toast/bảng cài đặt có nền đặc + viền, vẫn rõ.

**Codec (`07_codec`).** Hook `MediaSource.isTypeSupported` (và `ManagedMediaSource`,
`WebKitMediaSource` nếu có), `HTMLMediaElement.canPlayType`, `navigator.mediaCapabilities.
decodingInfo` (trả `{supported:false, smooth:false, powerEfficient:false}`) ở document start, trước khi
player dò:
* luôn chặn **AV1** (`av01`); chặn `width>1920`, `height>1080` (tham số `width=`/`height=` trong chuỗi
  type, hoặc `video.width/height` của decodingInfo) và `framerate>60`;
* Cài đặt **Codec**: "Tự động (chặn AV1)" (mặc định) / "Ưu tiên H.264" (chặn thêm VP9/VP8/`video/webm`
  → YouTube phát `avc1`);
* "Tự động" hỏi Java `TizenTubeMobile.hasHardwareDecoder('video/x-vnd.on2.vp9')` (`MediaCodecList`,
  bỏ decoder phần mềm theo `MediaCodecUtil.isSoftwareDecoder`): **không có VP9 phần cứng → chặn VP9
  luôn**, YouTube phát H.264.

**VP9 trên BAIC X7.** Tài liệu máy (DiPlay-BAIC-BEIJING-X7, `docs/BAIC_X7.md`) ghi model
`C3005H_MX8Q`, "Freescale i.MX8" → dòng **i.MX8QM/QXP** (hậu tố `MX8Q`), không phải i.MX8M. VPU của
i.MX8QM/QXP là **Amphion "Malone"**: theo tài liệu VPU của NXP, giải mã cứng H.264, HEVC, VC-1,
MPEG-2/4, VP8 (tùy bản BSP), **không có VP9**. (i.MX8M Quad có Hantro G2 thì có VP9.) Thông tin này
lấy từ hiểu biết chung về dòng chip, chưa đối chiếu được datasheet trong phiên này và chưa đo trên xe. Vì vậy trên X7, VP9 sẽ giải mã bằng phần mềm
(`c2.android.vp9`/`OMX.google.vp9`) trên CPU A53/A72 — đây là nguồn chính của >120% CPU. **Khuyến nghị:
mặc định "Tự động"** (đã tự chọn H.264 khi máy không có VP9 phần cứng; máy khác có VP9 cứng vẫn dùng VP9
tiết kiệm băng thông). Chưa xác minh trên máy thật: hãy xem `logcat` dòng `codec: hardware VP9 decoder:`
của userscript, hoặc `dumpsys media.player`/`media_codecs.xml`.

**Đóng băng render khi ẩn hẳn.** `onStop` + đang phát + chế độ "Chỉ phát âm thanh"/PiP-dự-phòng:
v7 gọi `updateShellActivityVisible(false)` → `WebContents` **HIDDEN** → `WebContentsImpl::WasHidden` →
`RenderWidgetHostViewAndroid::Hide` → `DelegatedFrameHost::WasHidden` + `RenderWidgetHostImpl::
WasHidden`: compositor ngừng BeginFrame, Blink ngừng vẽ / `requestAnimationFrame`. Đây là thứ thật sự
dừng tạo khung. Âm thanh vẫn phát: `WebMediaPlayerImpl::ShouldPausePlaybackWhenHidden()` = false cho
video có tiếng khi "background video playback" bật (mặc định) và `--disable-background-media-suspend`
tắt suspend nền; renderer Starboard không có hook visibility. JS trang vẫn thấy `hidden=false` (module
05), `--disable-renderer-backgrounding` giữ ưu tiên tiến trình nên timer (SponsorBlock, tự phát tiếp)
vẫn chạy. `onStart` hiện lại (`WasShown`). **Không** đóng băng khi `onPause` (chia màn, chạm ô bản đồ),
**không** khi PiP (cửa sổ PiP hiện, không có `onStop`). "Dừng phát": như cũ. Chưa kiểm trên máy: nếu
Blink vẫn dừng media khi trang ẩn thật trên Android, bỏ dòng `updateShellActivityVisible(false)` trong
nhánh `mBackgroundPlaybackActive` của `onStop` để quay về hành vi v6 (không đóng băng).

**Lớp phủ native (`TizenTubeOverlay.java`).** `FrameLayout` thêm trên nội dung web
(`addContentView`), đặt **khớp khung trình phát** mà trang báo (`setPlayerRect`, CSS px × DPR):
* giữa: −10s (56dp) · Phát/Tạm dừng (72dp) · +10s (56dp); góc trên: Quay lại (trái), Tìm kiếm (phải);
  mép dưới: Video trước (trái), Video tiếp (phải), **trên** dải 40dp của thanh tua YouTube (không che);
* nút tròn nền đen mờ, biểu tượng trắng vẽ bằng `Canvas`/`Path` — không tài nguyên mới, không deps mới;
  thu nhỏ khi trình phát nhỏ nhưng không dưới 48dp;
* hiện khi **chạm 1 lần** vào trình phát ở trang xem: `CobaltActivity.dispatchTouchEvent` chỉ **quan
  sát** (không ăn sự kiện), chạm ngắn ít dịch chuyển, rồi đợi `getDoubleTapTimeout()`; có chạm thứ 2
  → là chạm đúp tua của YouTube, không hiện. 2 ngón (chụm) → bỏ qua;
* tự ẩn sau 3 s, mỗi lần bấm nút đếm lại; ẩn = `GONE`, không chặn chạm. Khi hiện: chạm ngoài nút (trong
  khung) chỉ ẩn lớp phủ (ăn chạm để YouTube không bật/tắt điều khiển của nó lần nữa); chạm vào dải thanh
  tua dưới cùng thì ẩn và **chuyển xuống trang**; chạm ngoài khung (danh sách bên dưới) ẩn và đi tiếp;
* chỉ ở trang xem (`setWatchPage`), không ở PiP. Mục "Cài đặt TizenTube" nằm ở tab "Bạn" (không ở trang
  xem) nên **không chồng vùng chạm**; lớp phủ JS cũ không có nút phát/tiếp nên không có gì để bỏ.

**Kênh lệnh Java → trang.** `CobaltActivity.sendPageCommand()` (chỉ chuỗi trong danh sách trắng) →
`evaluateJavaScript("window.dispatchEvent(new CustomEvent('ttm-cmd',{detail:'…'}))")`; module 40 thực
hiện bằng API `#movie_player` đã kiểm trên trang thật: `playVideo`/`pauseVideo` (toggle theo
`getPlayerState()`), `nextVideo`, `seekBy(±10)` (đồng bộ đồng hồ YouTube; dự phòng `video.currentTime`),
prev = >3 s thì `seekTo(0)` (theo `getCurrentTime()` của player), ngược lại `previousVideo()` trong
playlist hoặc `history.back()`; search = bấm nút tìm của thanh đầu (thoát phủ kín trước); back = đường
Back của Activity (`handleMobileBack`).

**MediaSession / phím vô lăng.** `CobaltMediaSession` (MediaSessionCompat có sẵn) nhận
`setCommandSink`: `onSkipToNext/Previous`, `onFastForward/Rewind` → kênh lệnh (m.youtube.com không
đăng ký handler nexttrack/seek nên `didReceiveAction` của Chromium không làm gì); `onPlay/onPause` vẫn
qua Chromium. Ở chế độ TizenTube **luôn quảng bá** `ACTION_SKIP_TO_NEXT/PREVIOUS/FAST_FORWARD/REWIND/
PLAY_PAUSE` để `MediaSessionCompat.onMediaButtonEvent` chuyển `KEYCODE_MEDIA_*` của vô lăng/tai nghe
thành callback (nó bỏ qua action không có trong playback state). Tiền cảnh: `onKeyDown` bắt
`KEYCODE_MEDIA_PLAY_PAUSE/PLAY/PAUSE/NEXT/PREVIOUS/FAST_FORWARD/REWIND/HEADSETHOOK` → kênh lệnh;
nền: callback MediaSession ở trên (session giữ active khi phát nền, v6).
* **Audio focus**: Chromium đã có `AudioFocusDelegate` (Java, `AudioFocusRequest` trên 26+): xin GAIN
  khi phát, mất hẳn → tạm dừng, tạm thời → tạm dừng, can-duck → hạ âm; Cobalt bật
  `DeferAudioFocusUntilAudible` để xin focus ngay. **Không thêm** bộ xin focus thứ hai (hai bộ sẽ giành
  focus của nhau).
* **Metadata**: Chromium đã chuyển `navigator.mediaSession.metadata` + ảnh bìa (ArtworkLoader, tải nền
  + cache) sang `CobaltMediaSession` → widget/xe. Userscript hook setter và gửi `setMetadata(...)` làm
  **dự phòng** (chỉ dùng khi Chromium chưa có metadata, không tải ảnh lần hai).
* **DPAD** (trang xem, không có ô nhập đang focus — `ImeAdapterImpl.focusedNodeEditable()`): TRÁI/PHẢI
  = −10/+10 s khi lớp phủ ẩn (khi hiện thì để di chuyển focus giữa các nút), GIỮA/ENTER = phát/tạm dừng
  (hoặc bấm nút đang focus), LÊN/XUỐNG = hiện lớp phủ. Phím đã xử lý thì `onKeyUp` cũng bị nuốt.

## 12. Kết quả kiểm tra (không build toàn bộ)

### Lượt v7

* Harness 71/71, host guard 23/23 (thêm: không hook media/`ytcfg` ngoài YouTube), `node --check` mọi
  tệp JS, Java: `javalang` 5 tệp OK (chưa biên dịch).
* Trang thật (`/workspace/TizenTubeCobalt-test/results_v7.json`) **97/97** ở 900×700, 1280×480@1,5,
  427×480, 507×480, 600×467 @1,5, 640×720: feed trang chủ/tìm kiếm cuộn → 0 `<video>` đang phát; cờ
  inline bị ép false; transition/animation 1 ms, shadow/backdrop none; codec: av01/2160p/120fps bị từ
  chối, video đang phát `avc1` (không phải av01, ≤1080p), "Ưu tiên H.264" → `avc1`, mô phỏng X7 không
  VP9 cứng → "Tự động" phát `avc1`; kênh lệnh seek±10/pause/play/toggle/next/prev/search/back trên
  player thật; hook metadata (tiêu đề, kênh, ảnh i.ytimg.com, thời lượng); bảng cài đặt có Codec + DPR +
  ✕ 48px; kiểm hồi quy v6 (spoof visibility, vừa khung/phủ kín, cổng tỉ lệ, chạm đúp gốc). Lần chạy
  đầy đủ đầu tiên có 4 lần chạm đúp D1 lệch giờ (máy đang build song song); chạy lại đều đạt.

### Lượt v6 (đầu xe BAIC Beijing X7, chia màn)

* `minSdkVersion` của APK = **24** (`build/config/android/config.gni`: `default_min_sdk_version = 24`
  khi `is_cobalt`); target 36. Mã Java mới chặn API 26 (kênh thông báo, `PictureInPictureParams`,
  `startForegroundService`), 29 (`startForeground` có type), 31 (`setAutoEnterEnabled`).
* Java: không có JDK/android.jar trong máy này; đã phân tích cú pháp 4 tệp đổi bằng `javalang`
  (OK) và đối chiếu tay API (`MediaMetadata.getTitle/getArtist`, `MediaSessionCompat.Token.getToken`,
  `evaluateJavaScript`, `Log`). **Chưa biên dịch.**
* Manifest render (jinja2) cả 2 chế độ, XML hợp lệ.
* Harness 62/62, host guard 23/23 (đã thêm kiểm tra không cài giả visibility ngoài YouTube).
* Trang thật m.youtube.com, chạm, UA app, ở 1280×480@1,5 và các ô 427×480, 507×480, 600×480, 600×467
  @1,5, 640×720, 900×700 @1: **100/100** (`/workspace/TizenTubeCobalt-test/results_v6.json`).

### Lượt designer v4 (thử lại trên m.youtube.com thật)

31/31 đạt (Pixel 7 ngang, UA của app, nạp nguyên văn 6 module). Mới: tự phủ kín màn ngang (player và
`<video>` 915×412 ở (0,0), thanh đầu ẩn, `cover`), chạm vẫn giữ bố cục, "Mở ứng dụng" bị ẩn ở trang
xem (thanh đầu trang chủ không có nút này ngay cả khi không có userscript; đã đối chứng), tương phản
toast, bảng cài đặt ≤ 85vh + cuộn bằng chạm tới "Mở đầu" + ✕ đóng bảng, chặn host trên
`accounts.google.com` thật (chỉ tải trang, không đăng nhập: không `TTM`, không phần tử/style,
`JSON.parse` và `Response.json` vẫn native). Tất cả mục cũ vẫn đạt, trong đó chạm đúp ±10 s gốc được
đo **khi đang phủ kín màn hình**. Harness cục bộ 52/52, `host_guard_test.mjs` 23/23.

### Thử trên m.youtube.com thật (Chrome headless)

Bộ thử nằm ngoài repo (`/workspace/TizenTubeCobalt-test/`, Playwright + Chrome hệ thống), mô phỏng
Pixel 7 ngang 915×412 @2,625x, có cảm ứng, đúng UA của app, nạp **nguyên văn** 5 module ở document
start, cầu nối Android được giả lập. Video `kJQP7kiw5Fk` (có đoạn `music_offtopic` 0–21,8 s trên
SponsorBlock; các video LTT/MKBHD thử qua API không có đoạn `sponsor`). Kết quả 20/20 đạt: tải đoạn
SponsorBlock, tự bỏ qua, thông báo tiếng Việt ở dưới + "Hoàn tác" (tua về và không bỏ qua lại), tốc
độ mặc định, xoá trường quảng cáo trong `ytInitialPlayerResponse`, không có giao diện quảng cáo, vuốt
âm lượng/độ sáng + ô chỉ báo giữa màn, chạm đúp ±10 s gốc của YouTube vẫn chạy, vuốt dọc không tua/không
dừng, mục cài đặt (tab "Bạn" khi chưa đăng nhập) + bảng cài đặt + lưu `localStorage` + Back.

Lỗi tìm thấy và đã sửa nhờ thử trên trang thật:

* `TTM.addStyle` gọi `appendChild` lúc document start khi `<html>` chưa tồn tại → `TypeError`, cả
  userscript không khởi tạo. Harness không bắt được vì nó nạp module sau khi `<head>` đã có. Nay
  chờ phần tử gốc bằng `MutationObserver`.
* Khi chưa đăng nhập, m.youtube.com không có menu tài khoản → không có chỗ đặt mục cài đặt. Nay
  chèn vào tab "Bạn".

Giới hạn: không đăng nhập Google, nên menu ảnh đại diện (đường chính khi đã đăng nhập) chưa được thử
trên trang thật, chỉ trong harness. Phiên headless chưa đăng nhập không được phát quảng cáo trong
video, nên đường "bấm Bỏ qua / nhảy qua quảng cáo đang chạy" chỉ được kiểm trong harness.

* `node --check`: đạt cho cả 6 module userscript, `html_media_element_extension_on_java_bridge.js`
  và mọi file JS của harness (`harness_pre.js`, `load_modules.js`, `harness.js`, `e2e_cdp.mjs`, `host_guard_test.mjs`).
* Manifest: là template jinja2 nên không `xmllint` trực tiếp được. Đã render bằng jinja2 có sẵn trong
  `third_party/jinja2` với `tizentube_mobile_ui=true` và `false`. Cả hai bản XML đều hợp lệ theo trình
  phân tích XML của Python (`xml.dom.minidom`). Máy này không có `xmllint`.
* Workflow YAML phân tích được bằng PyYAML.
* Harness: `tools/touch_harness/e2e_cdp.mjs` trên Chrome headless, giả lập điện thoại ngang
  915×412 @2,6x có cảm ứng: **43/43 đạt** (CSS + JSON/fetch lọc quảng cáo, nhảy qua quảng cáo đang
  chạy, SponsorBlock bỏ qua + thông báo tiếng Việt ở dưới + Hoàn tác không bỏ qua lại + tự ẩn sau 4 s
  + loại bị tắt không bỏ qua + điều hướng SPA, tốc độ mặc định, lưu `localStorage` qua tải lại, vuốt
  âm lượng/độ sáng qua cầu nối, ô chỉ báo ở giữa và tự ẩn, chạm/chạm đúp gốc vẫn hoạt động, bỏ qua vuốt
  ngắn và vuốt ngang, dự phòng không có cầu nối, mục menu tài khoản ≥ 48px, không có nút nổi, bảng cài
  đặt, Back đóng bảng, vị trí dự phòng trong menu tràn, Trusted Types, không lỗi console).
* Java/C++: **chưa biên dịch** (cần cây Chromium đầy đủ). Đã đối chiếu thủ công mọi API dùng tới với
  mã nguồn trong cây (`WebContents.evaluateJavaScript/isFullscreenForCurrentTab/exitFullscreen`,
  `NavigationController.canGoBack/getLastCommittedEntryIndex/getEntryAtIndex`, `ImeAdapter`,
  `ViewEventSink.from`, `JavascriptInjector.addPossiblyUnsafeInterface`,
  `embedder_support::GetUserAgent/GetUserAgentMetadata/kUseMobileUserAgent`). Lần build CI đầu tiên
  là lần kiểm tra biên dịch thật.
