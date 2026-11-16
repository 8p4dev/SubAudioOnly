// subs 에이전트: 이중 자막 오버레이 (#sao-overlay). 순수 로직은 pick-tracks.js.
'use strict';

(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const warn = (...a) => console.warn('[SAO subs]', ...a);

  const mkLine = (cls) => {
    const el = document.createElement('div');
    el.className = `sao-line ${cls}`;
    return el;
  };
  const overlay = document.createElement('div');
  overlay.id = 'sao-overlay';
  const targetEl = mkLine('sao-line-target');
  const nativeEl = mkLine('sao-line-native');
  overlay.append(targetEl, nativeEl);

  let settings = null;
  let loadedKey = ''; // 'videoId|native|target' — 현재 로드(중)인 조합
  let cues = { target: [], native: [] };
  let shown = { target: '', native: '' };
  const potUrls = {}; // videoId -> Promise<string|null>

  const player = () => document.getElementById('movie_player');
  const videoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);

  // 페이지 객체는 신뢰하지 않는다: 필요한 부분만 JSON으로 복사.
  // 반환: 트랙 배열(현재 영상의 응답, 자막 없으면 []) | null(응답이 아직 없거나 다른 영상 것)
  function readTracks(vid) {
    const sources = [
      () => player().wrappedJSObject.getPlayerResponse(),
      () => window.wrappedJSObject.ytInitialPlayerResponse,
    ];
    for (const get of sources) {
      try {
        const pr = get();
        if (String(pr.videoDetails.videoId) !== vid) continue;
        const json = pr.captions ? JSON.stringify(pr.captions.playerCaptionsTracklistRenderer.captionTracks) : '[]';
        const tracks = JSON.parse(json || '[]');
        return Array.isArray(tracks)
          ? tracks.filter((t) => t && typeof t.baseUrl === 'string' && typeof t.languageCode === 'string')
          : [];
      } catch (e) { /* 아직 준비 안 됨 */ }
    }
    return null;
  }

  async function fetchJson(url) {
    if (!url) return null;
    const res = await fetch(url, { credentials: 'include' });
    const text = res.ok ? await res.text() : '';
    return text ? JSON.parse(text) : null; // pot이 필요하면 200 + 빈 본문
  }

  // 플레이어 자막을 켜서 플레이어가 직접 timedtext 요청(pot 포함)을 보내게 하고, background가 본 URL을 받는다.
  async function getPotUrl(vid, languageCode) {
    for (let i = 0; i < 2; i++) {
      try {
        const p = player().wrappedJSObject;
        if (p.loadModule) p.loadModule('captions');
        if (p.toggleSubtitlesOn) p.toggleSubtitlesOn();
        if (p.setOption) p.setOption('captions', 'track', cloneInto({ languageCode }, window));
      } catch (e) { /* 플레이어 API 없음 — 사용자가 직접 자막을 켜면 background가 관찰한다 */ }
      const url = await SAO.send(SAO.MSG.CAPTIONS, { videoId: vid });
      if (url) return url;
    }
    return null;
  }

  async function fetchCues(vid, { track, tlang }) {
    let json = await fetchJson(timedtextUrl(track.baseUrl, tlang, null, location.origin)).catch(() => null);
    if (!json) {
      potUrls[vid] = potUrls[vid] || getPotUrl(vid, track.languageCode);
      const potUrl = await potUrls[vid];
      if (potUrl) json = await fetchJson(timedtextUrl(track.baseUrl, tlang, potUrl, location.origin));
    }
    return parseJson3(json);
  }

  // 다른 content script(단어 목록 등)가 현재 영상의 자막을 읽을 수 있게 공개한다(계약: SAO.subs + 'sao:cues' 이벤트).
  function setCues(next, vid = null) {
    cues = next;
    SAO.subs = vid ? { videoId: vid, lang: settings.targetLang, target: next.target, native: next.native } : null;
    document.dispatchEvent(new CustomEvent('sao:cues'));
    document.documentElement.classList.toggle('sao-overlay-on', !!(cues.target.length || cues.native.length));
    render();
  }

  // 멱등: 영상/언어 조합이 바뀌었을 때만 다시 로드한다.
  async function load() {
    const vid = settings && settings.dualSubs && videoId();
    const key = vid ? [vid, settings.nativeLang, settings.targetLang].join('|') : '';
    if (key === loadedKey) return;
    loadedKey = key;
    setCues({ target: [], native: [] });
    if (!vid) return;
    targetEl.lang = settings.targetLang;
    nativeEl.lang = settings.nativeLang;
    try {
      let tracks = null;
      for (let i = 0; i < 20 && !tracks && loadedKey === key; i++) {
        tracks = readTracks(vid);
        if (!tracks) await sleep(500);
      }
      if (loadedKey !== key) return;
      const pick = pickTracks(tracks, settings.nativeLang, settings.targetLang);
      if (!pick) return warn('자막 트랙 없음', vid);
      const [target, native] = await Promise.all([
        fetchCues(vid, pick.target).catch((e) => (warn('학습 언어 자막 실패', e), [])),
        fetchCues(vid, pick.native).catch((e) => (warn('자국어 자막 실패', e), [])),
      ]);
      if (loadedKey !== key) return;
      if (!target.length && !native.length) warn('자막 본문을 가져오지 못함', vid);
      setCues({ target, native }, vid);
    } catch (e) {
      warn(e);
    }
  }

  function setLine(which, el, text) {
    if (shown[which] === text) return;
    shown[which] = text;
    el.textContent = which === 'native' ? text : '';
    if (which === 'native') return;
    for (const s of segmentWords(text, settings.targetLang)) {
      if (s.word) {
        const span = document.createElement('span');
        span.className = 'sao-word';
        span.textContent = s.text;
        el.append(span);
      } else {
        el.append(s.text); // 문자열 append = 텍스트 노드
      }
    }
  }

  function render() {
    const p = player();
    const video = document.querySelector('#movie_player video') || document.querySelector('video');
    const active = settings && settings.dualSubs && p && video && !p.classList.contains('ad-showing');
    const ms = active ? video.currentTime * 1000 : -1;
    setLine('target', targetEl, cueAt(cues.target, ms));
    setLine('native', nativeEl, cueAt(cues.native, ms));
    if (!active) return overlay.remove();
    // 모바일은 컨트롤 오버레이가 #movie_player의 형제라서 공통 컨테이너에 붙여야 단어 탭이 닿는다.
    const mount = document.getElementById('player-container-id') || p;
    if (overlay.parentNode !== mount) mount.append(overlay);
  }

  function apply(s) {
    settings = s;
    overlay.style.setProperty('--sao-scale', String(Number(s.subtitleScale) || 1));
    load();
    render();
  }

  const tick = () => { load(); render(); };
  // 미디어 이벤트는 버블링하지 않으므로 capture로 받는다(<video>가 교체돼도 동작).
  for (const ev of ['timeupdate', 'seeking', 'seeked']) document.addEventListener(ev, tick, true);
  for (const ev of ['state-navigateend', 'yt-navigate-finish']) window.addEventListener(ev, tick);

  SAO.onSettingsChanged(apply);
  SAO.getSettings().then(apply, warn);
})();
