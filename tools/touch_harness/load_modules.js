// Loads the REAL userscript modules synchronously, in the same order the APK
// injects them (std::map order of file names). Prefers the repo copy so edits
// are picked up without copying; falls back to ./modules/ if the harness
// folder is served on its own.
(function () {
  'use strict';
  var MODULES = [
    'tizentube_mobile_00_core.js',
    'tizentube_mobile_05_visibility.js',
    'tizentube_mobile_07_codec.js',
    'tizentube_mobile_08_light.js',
    'tizentube_mobile_10_adblock.js',
    'tizentube_mobile_20_player.js',
    'tizentube_mobile_25_layout.js',
    'tizentube_mobile_30_settings.js',
    'tizentube_mobile_40_background.js'
  ];
  var BASES = ['../../cobalt/shell/embedded_resources/cobalt_java_script_polyfill/', 'modules/'];

  function fetchSync(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);  // Synchronous on purpose: mimic document-start injection.
      xhr.send();
      return xhr.status === 200 ? xhr.responseText : null;
    } catch (e) {
      return null;
    }
  }

  var base = null;
  for (var i = 0; i < BASES.length && base === null; i++) {
    if (fetchSync(BASES[i] + MODULES[0]) !== null) base = BASES[i];
  }
  window.__harnessModuleBase = base;
  if (base === null) {
    window.__harnessModuleError = 'Không tìm thấy module userscript. Hãy chạy http.server từ thư mục gốc repo.';
    return;
  }
  // The page enforces Trusted Types (like m.youtube.com); this harness-only
  // policy is the one allowed way to turn fetched module text into a script.
  var policy = window.trustedTypes && trustedTypes.createPolicy
    ? trustedTypes.createPolicy('ttm-harness-loader', { createScript: function (s) { return s; } })
    : { createScript: function (s) { return s; } };
  MODULES.forEach(function (name) {
    var src = fetchSync(base + name);
    var s = document.createElement('script');
    // sourceURL keeps file names in DevTools stack traces.
    s.text = policy.createScript(src + '\n//# sourceURL=' + base + name);
    document.head.appendChild(s);
  });
})();
