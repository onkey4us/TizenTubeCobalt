# TizenTube Cobalt cho điện thoại Android (m.youtube.com)

Nhánh `touch-mobile`. Bản này biến APK TizenTube Cobalt thành ứng dụng cho **điện thoại** (chỉ màn
ngang): tải giao diện YouTube dành cho điện thoại `https://m.youtube.com` thay vì giao diện TV
`youtube.com/tv`, và tự mang theo một userscript TizenTube viết riêng cho trang mobile (chặn quảng
cáo, SponsorBlock, tốc độ phát, cử chỉ độ sáng/âm lượng). Không còn lớp giả lập D‑pad, không có
thanh nút nổi.

> Phương án cũ (giữ giao diện TV + giả lập phím mũi tên bằng cử chỉ) đã bị huỷ và **không** có
> trong nhánh này.

## 1. Thay đổi gì và vì sao

| Mục | Thay đổi | Lý do |
| --- | --- | --- |
| URL khởi động | `cobalt.APP_URL = https://m.youtube.com/` | Giao diện điện thoại vốn đã hỗ trợ cảm ứng, bàn phím ảo, chạm đúp tua. |
| User agent | UA Chrome Android dạng *Mobile* + client hints `mobile=?1` | Không có UA mobile thì YouTube trả bản desktop hoặc bản TV. |
| Tỉ lệ hiển thị | Bỏ `--force-device-scale-factor=1` khi chạy chế độ mobile | Giao diện TV cố định 1920×1080 ở tỉ lệ 1; m.youtube.com cần mật độ điểm ảnh thật của máy, nếu không chữ và nút rất nhỏ. Vì vậy **không** cần phóng 1,25–1,5×: trang mobile tự co giãn theo viewport. |
| Xoay màn hình | `android:screenOrientation="sensorLandscape"` | Chỉ màn ngang (2 chiều ngang). |
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
   `sensorLandscape`, `APP_URL=https://m.youtube.com/`, meta-data `tizentube.MOBILE_UI=true`, tắt splash.
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
  tizentube_mobile_40_gestures.js  vuốt dọc: độ sáng (trái) / âm lượng (phải)
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

### 3.3b Bố cục màn ngang và "Mở ứng dụng" (`25_layout`)

* **Tự phủ kín màn hình khi xem ở màn ngang.** Khi video trên trang xem bắt đầu phát
  (`playing`) và màn hình đang ngang, `<html>` được gắn lớp `ttm-fill`: thanh đầu YouTube bị ẩn,
  `#player-container-id` ghim kín viewport, `<video>` phủ kín với `object-fit: cover`, nên không còn
  viền đen hai bên trên màn 20:9 (mép trên/dưới video bị cắt một chút). Tắt "Phủ kín màn hình (cắt
  bớt mép video)" để dùng `contain` (có viền đen, không cắt). Tắt "Tự động toàn màn hình khi xem"
  để tắt hẳn. Back lần 1 thoát chế độ này (giữ trang xem), Back lần 2 mới `history.back()`.
  Mở bài khác thì tự bật lại.
* **Vì sao không dùng Fullscreen API.** Đã thử trên m.youtube.com thật: mọi kiểu toàn màn hình
  "thật" (`requestFullscreen` trên container hoặc `<html>`) và cả `body[faux-fullscreen]` của
  YouTube đều khiến YouTube kéo `#player-control-container` phủ lên video, và **chạm đúp ±10 s gốc
  ngừng hoạt động**. Lớp phủ CSS giữ nguyên bố cục đó nên chạm đúp vẫn chạy. Thanh trạng thái/điều
  hướng Android đã do app ẩn (immersive), nên hình ảnh như nhau. Hằng `USE_FULLSCREEN_API` (mặc định
  `false`) giữ lại đường API để thử sau.
* Chỉ ghim container ngoài cùng. `#player` / `#movie_player` vẫn theo luồng bình thường; nếu đặt
  `#player` là `absolute`, khối điều khiển (nơi YouTube bắt chạm đúp) bị kéo lên trên và hỏng chạm đúp.
* **Ẩn "Mở ứng dụng".** Trong thanh đầu m.youtube.com (khi chưa đăng nhập) nút này là
  `<a>` trong `ytm-button-renderer.icon-avatar_logged_out` (`ytm-mobile-topbar-renderer#header-bar`).
  Module tìm theo **chữ** ("Mở ứng dụng", "Open App", …) hoặc link `intent:`/`vnd.youtube:`/Play Store
  trong thanh đầu và các khối quảng bá app (`ytm-mealbar-promo-renderer`, …), rồi gắn lớp
  `ttm-app-promo` (`display:none`). Không ẩn cả thanh đầu, nên Tìm kiếm và ảnh đại diện (khi đã
  đăng nhập) vẫn còn. Luôn bật vì trong app nút này vô dụng.

### 3.4 Cài đặt (`30_settings`): không có nút nổi

Mục **"Cài đặt TizenTube"** (biểu tượng bánh răng, cao 48px) được chèn **vào menu tài khoản** của
m.youtube.com (bấm ảnh đại diện). Bấm vào sẽ mở bảng cài đặt:

* Chặn quảng cáo
* SponsorBlock (tự bỏ qua đoạn) và **từng loại đoạn**
* Tốc độ phát mặc định
* Vuốt dọc chỉnh độ sáng / âm lượng

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

### 3.5 Cử chỉ trong trình phát (`40_gestures`)

* **Vuốt dọc nửa trái** của player = **độ sáng**, **nửa phải** = **âm lượng**. Vuốt hết 80% chiều
  cao player = 0→100%.
* Ô chỉ báo nhỏ ở **giữa màn hình** (biểu tượng + thanh + %), ẩn sau 0,7 s khi nhấc tay.
* **Không** đụng tới cử chỉ của YouTube: không thêm chạm, chạm đúp, play/pause hay tua. Một lần chạm
  chỉ bị "nhận" khi đã di chuyển ≥ 24px **và** chủ yếu theo chiều dọc (|dy| ≥ 1,5·|dx|). Trước đó
  YouTube vẫn nhận mọi sự kiện. Vuốt ngang bị bỏ qua. Sau khi nhận, `touchmove`/`touchend` của lần
  vuốt đó bị chặn (`preventDefault` + `stopImmediatePropagation` ở pha capture) để YouTube không coi
  là chạm. Chạm đúp tua ±10s và chạm để hiện/ẩn điều khiển của YouTube vẫn hoạt động (harness kiểm tra).
* Bỏ qua: 32px mép trái/phải (cử chỉ Back của Android), 48px phía trên, 72px phía dưới (thanh tiến
  trình, nút điều khiển), miniplayer, và phần tử điều khiển (`.ytp-progress-bar`, …).
* Tắt được trong bảng cài đặt.

## 4. Cầu nối native

`dev.cobalt.coat.javabridge.TizenTubeMobileBridge`
(`cobalt/android/apk/app/src/main/java/dev/cobalt/coat/javabridge/TizenTubeMobileBridge.java`)
được gắn là `window.TizenTubeMobile` qua cơ chế JavaBridge có sẵn của Cobalt
(`JavascriptInjector.addPossiblyUnsafeInterface`, `CobaltActivity.initializeJavaBridge()`, khoảng dòng
`:711`). Cầu nối chỉ được thêm khi chạy chế độ mobile, và **chỉ cho các origin**
`https://m.youtube.com`, `https://www.youtube.com`, `https://youtube.com`
(`TIZENTUBE_MOBILE_BRIDGE_ORIGINS`, `CobaltActivity.java:101`). Cầu nối HTMLMediaElementExtension
có sẵn vẫn để allowlist rỗng như cũ.

| Hàm JS | Android | Ghi chú |
| --- | --- | --- |
| `getBrightness()` / `setBrightness(0..1)` | `WindowManager.LayoutParams.screenBrightness` | Chỉ cửa sổ của app; không cần quyền `WRITE_SETTINGS`; rời app là trả lại độ sáng hệ thống. Tối thiểu 0,01 để màn không tắt hẳn. |
| `getVolume()` / `setVolume(0..1)` | `AudioManager` `STREAM_MUSIC` | Cùng luồng với phím âm lượng (`setVolumeControlStream(STREAM_MUSIC)` trong `BaseCobaltActivity`). Không hiện thanh âm lượng hệ thống; ô chỉ báo của ta thay thế. Trả `-1` nếu bị chặn (ví dụ chế độ Không làm phiền). |
| `getBridgeVersion()` | | `1` |

**Vì sao chọn AudioManager thay vì `video.volume`:** Cobalt phát âm thanh qua Starboard
(`AudioTrackBridge`). `HTMLMediaElement.volume` có hoạt động nhưng chỉ là hệ số phần mềm, tối đa
bằng âm lượng hệ thống hiện tại, nên vuốt lên không thể to hơn. `STREAM_MUSIC` đổi đúng âm lượng
người dùng nghe, giống app YouTube. Nếu không có cầu nối (desktop/harness), userscript dùng
`video.volume`, và dùng CSS `filter: brightness()` cho độ sáng (chỉ làm tối được), kèm một
`console.warn`.

Lời gọi cầu nối là IPC đồng bộ, nên được gom lại tối đa 1 lần mỗi khung hình (`requestAnimationFrame`).

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
* **Xoay**: `sensorLandscape` trong manifest. `configChanges` đã có `orientation|screenSize` nên xoay
  giữa 2 chiều ngang không tạo lại Activity.
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
| Trình phát | **Vuốt dọc nửa trái** | **Độ sáng** + ô chỉ báo giữa màn | TizenTube |
| Trình phát | **Vuốt dọc nửa phải** | **Âm lượng** + ô chỉ báo giữa màn | TizenTube |
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
| `cobalt/shell/android/shell_apk/AndroidManifest.xml.jinja2` | `APP_URL`, `sensorLandscape`, `tizentube.MOBILE_UI`, tắt splash (có điều kiện). |
| `cobalt/android/apk/app/src/main/java/dev/cobalt/coat/CobaltActivity.java` | Cờ mobile, bỏ ép scale factor, tắt ép CSP, UA mobile, immersive, Back, cầu nối JS. |
| `cobalt/android/apk/app/src/main/java/dev/cobalt/coat/javabridge/TizenTubeMobileBridge.java` | Cầu nối độ sáng / âm lượng. |
| `cobalt/shell/android/java/src/dev/cobalt/shell/Shell.java` | Chọn `ContentViewRenderView` làm container IME. |
| `cobalt/shell/android/java/src/dev/cobalt/shell/ContentViewRenderView.java` | Chuyển tiếp `onCreateInputConnection` / focus tới ImeAdapter. |
| `cobalt/browser/switches.h` | Switch `--tizentube-mobile-ui`. |
| `cobalt/browser/cobalt_content_browser_client.cc`, `cobalt/browser/BUILD.gn` | UA + client hints mobile. |
| `cobalt/shell/BUILD.gn` | Khai báo `inputs` cho các file JS nhúng. |
| `cobalt/shell/embedded_resources/cobalt_java_script_polyfill/tizentube_mobile_*.js` | Userscript mobile (6 module). |
| `third_party/blink/renderer/core/dom/document.cc` | Bỏ userscript jsdelivr (TV) trên `m.youtube.com`. |
| `tools/touch_harness/*` | Harness + kiểm thử tự động (`e2e_cdp.mjs`, `host_guard_test.mjs`). |
| `.github/workflows/android_touch_mobile.yaml` | Workflow build APK arm64 chạy tay. |

## 12. Kết quả kiểm tra (không build toàn bộ)

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
