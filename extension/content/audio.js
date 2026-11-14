// R1 오디오 전용 재생. 근거와 대안 검토는 docs/plans/agent_audio.md.
// 1) 항상: 검은 화면(CSS) + 최저 화질 강제.  2) 최선 노력: 직접 오디오 URL로 video.src 교체(영상 바이트 0).
'use strict';

(() => {
  // InnerTube player 응답의 streamingData에서 직접 재생 가능한 오디오 URL을 고른다. 없으면 null.
  const pickAudio = (streamingData, canPlay = () => true) => {
    const audio = ((streamingData && streamingData.adaptiveFormats) || [])
      .filter((f) => f.url && /^audio\//.test(f.mimeType || '') && canPlay(f.mimeType));
    const main = audio.filter((f) => !f.audioTrack || f.audioTrack.audioIsDefault); // 더빙 트랙 제외
    const pool = main.length ? main : audio;
    return pool.length ? pool.reduce((a, b) => ((b.bitrate || 0) > (a.bitrate || 0) ? b : a)).url : null;
  };

  if (typeof module !== 'undefined') { module.exports = { pickAudio }; return; } // node 테스트

  const CLS = 'sao-audio-only';
  const NOSWAP = 'sao_audio_noswap'; // 교체가 한 번 실패한 탭에서는 다시 시도하지 않는다
  let on = true;      // 설정을 읽기 전에는 기본값(true)로 가정해 영상이 번쩍이지 않게 한다
  let swapped = '';   // 우리가 넣은 오디오 URL
  let triedId = '';   // 영상당 1회만 교체 시도

  const playerEl = () => document.getElementById('movie_player');
  // 페이지 월드의 플레이어 API 호출 (Firefox Xray 해제). 없거나 실패하면 undefined.
  const call = (name, ...args) => {
    try { return playerEl().wrappedJSObject[name](...args); } catch { return undefined; }
  };
  const videoId = () => { try { return call('getVideoData').video_id; } catch { return undefined; } };
  const adShowing = () => { const p = playerEl(); return !p || p.classList.contains('ad-showing'); };
  const isSwapped = (v) => !!swapped && v.getAttribute('src') === swapped;

  const reloadAt = (v) => {
    const u = new URL(location.href);
    if (v.currentTime > 1) u.searchParams.set('t', `${Math.floor(v.currentTime)}s`);
    location.replace(u.href);
  };
  const recover = (v) => {
    if (!isSwapped(v)) return;
    try { sessionStorage.setItem(NOSWAP, '1'); } catch { return; } // 표시를 못 남기면 리로드 루프 위험 → 그대로 둔다
    reloadAt(v);
  };

  // ponytail: 비-웹 클라이언트(VISIONOS) 버전 하드코딩. YouTube가 막으면 streamingData/url이 없어
  // 조용히 최저 화질 폴백으로 떨어진다. 그때 clientVersion을 갱신(참고: schdie/we_firefox_ytop_mv3).
  const fetchPlayer = async (id) => {
    let visitorData;
    try { visitorData = window.wrappedJSObject.ytcfg.get('VISITOR_DATA'); } catch { /* 없어도 시도 */ }
    const res = await fetch(`${location.origin}/youtubei/v1/player?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Origin': 'https://www.youtube.com' },
      body: JSON.stringify({
        videoId: id,
        context: { client: {
          clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1',
          osName: 'visionOS', osVersion: '26.5.23O47', visitorData,
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        } },
      }),
    });
    return res.json();
  };

  const canSwap = () => on && location.pathname === '/watch' && !adShowing();

  const trySwap = async (v) => {
    try {
      if (!canSwap() || sessionStorage.getItem(NOSWAP)) return;
      const id = videoId();
      if (!id || id === triedId) return;
      triedId = id;
      const data = await fetchPlayer(id);
      const details = data.videoDetails || {};
      if (!canSwap() || videoId() !== id || details.videoId !== id || details.isLive) return;
      const url = pickAudio(data.streamingData, (t) => !!v.canPlayType(t));
      if (!url) return;
      const { currentTime, playbackRate } = v;
      swapped = url;
      v.src = url;
      v.currentTime = currentTime;
      v.playbackRate = playbackRate;
      v.play().catch(() => {});
      setTimeout(() => { if (v.readyState < 2) recover(v); }, 10000);
    } catch { /* 실패 = 최저 화질 폴백 유지 */ }
  };

  const onMedia = (e) => {
    const v = e.target;
    if (!on || !v || v.tagName !== 'VIDEO' || isSwapped(v)) return;
    call('setPlaybackQualityRange', 'tiny', 'tiny');
    if (e.type === 'playing') trySwap(v);
  };

  const apply = (settings) => {
    const was = on;
    on = !!settings.audioOnly;
    document.documentElement.classList.toggle(CLS, on);
    if (on === was) return;
    const v = document.querySelector('video');
    if (on) {
      call('setPlaybackQualityRange', 'tiny', 'tiny');
      if (v && !v.paused) trySwap(v);
    } else if (v && isSwapped(v)) {
      reloadAt(v); // MSE 소스는 되살릴 수 없어 리로드 1회
    } else {
      call('setPlaybackQualityRange', 'auto', 'auto');
    }
  };

  document.documentElement.classList.add(CLS);
  document.addEventListener('loadstart', onMedia, true);
  document.addEventListener('playing', onMedia, true);
  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') recover(e.target);
  }, true);
  SAO.getSettings().then(apply);
  SAO.onSettingsChanged(apply);
})();
