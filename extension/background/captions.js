// subs 에이전트. YouTube timedtext는 플레이어가 만든 PO 토큰(pot) 없이는 빈 응답을 줄 수 있다.
// 플레이어가 스스로 보낸 timedtext 요청 URL(pot 포함)을 videoId별로 기억해 content script에 돌려준다.
'use strict';

(() => {
  const seen = new Map(); // videoId -> url

  browser.webRequest.onBeforeRequest.addListener(
    (d) => {
      const p = new URL(d.url).searchParams;
      const v = p.get('v');
      if (!v || !p.get('pot')) return;
      seen.delete(v);
      seen.set(v, d.url);
      if (seen.size > 50) seen.delete(seen.keys().next().value);
    },
    { urls: ['*://*.youtube.com/api/timedtext*'] },
  );

  // {videoId} -> 관찰된 URL | null (아직 없으면 최대 3초 대기)
  SAO.handlers[SAO.MSG.CAPTIONS] = async ({ videoId }) => {
    for (let i = 0; i < 15 && !seen.has(videoId); i++) await new Promise((r) => setTimeout(r, 200));
    return seen.get(videoId) || null;
  };
})();
