// TizenTube mobile harness: runs BEFORE the real userscript modules.
// Sets the harness flag (the modules otherwise only run on m.youtube.com),
// a log sink, a mock SponsorBlock API and an optional mock Android bridge.
(function () {
  'use strict';
  window.__TIZENTUBE_MOBILE_HARNESS__ = true;

  var early = [];
  window.__TIZENTUBE_MOBILE_LOG__ = function (msg) {
    if (window.harnessLog) window.harnessLog(msg, 'tt'); else early.push(msg);
  };
  window.__harnessEarlyLog = early;

  // Pretend to be on a watch page so SponsorBlock has a video id.
  if (!new URLSearchParams(location.search).get('v')) {
    history.replaceState(null, '', location.pathname + '?v=dQw4w9WgXcQ' + location.hash);
  }

  // Mock SponsorBlock segments (seconds) for the 60 s mock video.
  window.__harnessSegments = {
    dQw4w9WgXcQ: [
      { UUID: 'mock-sponsor', category: 'sponsor', actionType: 'skip', segment: [5, 12] },
      { UUID: 'mock-selfpromo', category: 'selfpromo', actionType: 'skip', segment: [20, 24] },
      { UUID: 'mock-interaction', category: 'interaction', actionType: 'skip', segment: [30, 33] },
      { UUID: 'mock-outro', category: 'outro', actionType: 'skip', segment: [52, 60] }
    ],
    jNQXAC9IVRw: [
      { UUID: 'mock-intro', category: 'intro', actionType: 'skip', segment: [2, 6] },
      { UUID: 'mock-filler', category: 'filler', actionType: 'skip', segment: [15, 19] }
    ]
  };
  window.__harnessUseRealSponsorBlock = false;
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('https://sponsor.ajay.app/api/skipSegments') === 0 && !window.__harnessUseRealSponsorBlock) {
      var id = new URL(url).searchParams.get('videoID');
      var segs = window.__harnessSegments[id];
      if (window.harnessLog) window.harnessLog('mock fetch ' + url.slice(0, 80) + '…', 'net');
      return Promise.resolve(segs ? new Response(JSON.stringify(segs), {
        status: 200, headers: { 'Content-Type': 'application/json' } }) : new Response('Not Found', { status: 404 }));
    }
    return realFetch(input, init);
  };

  // Mock of dev.cobalt.coat.javabridge.TizenTubeMobileBridge (v6: leave mode + playing
  // state). getVolume/getBrightness are only kept so tests can prove nothing changes them.
  var state = { volume: 0.5, brightness: 0.6, leave: 'audio' };
  window.__harnessMockBridge = {
    getBridgeVersion: function () { return 2; },
    getLeaveMode: function () { return state.leave; },
    setLeaveMode: function (m) { state.leave = m; if (window.harnessLog) window.harnessLog('bridge: leave mode = ' + m, 'bridge'); },
    setPlaying: function (p) { window.__harnessMockBridge.__playing = p; if (window.harnessLog) window.harnessLog('bridge: playing = ' + p, 'bridge'); },
    __playing: null,
    getVolume: function () { return state.volume; },
    setVolume: function (v) {
      state.volume = Math.round(Math.max(0, Math.min(1, v)) * 15) / 15;  // 15 steps like STREAM_MUSIC.
      if (window.harnessBridgeChanged) window.harnessBridgeChanged(state);
      return state.volume;
    },
    getBrightness: function () { return state.brightness; },
    setBrightness: function (v) {
      state.brightness = Math.max(0.01, Math.min(1, v));
      if (window.harnessBridgeChanged) window.harnessBridgeChanged(state);
    }
  };
  window.TizenTubeMobile = window.__harnessMockBridge;
})();
