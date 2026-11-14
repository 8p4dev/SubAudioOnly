// R4 사전 조회 — Google 번역 무료 엔드포인트의 사전 응답(dt=bd)만 사용.
'use strict';

(() => {
  // 응답(중첩 배열) -> LookupResult. [0][i][0] = 번역 조각, [1] = [[pos, [terms...], ...], ...] 또는 null.
  const parseLookup = (word, data) => {
    if (!Array.isArray(data)) throw new Error('사전 응답 형식이 올바르지 않습니다');
    const str = (v) => typeof v === 'string' && v.trim() !== '';
    const translation = (Array.isArray(data[0]) ? data[0] : [])
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('').trim();
    const entries = (Array.isArray(data[1]) ? data[1] : [])
      .filter((e) => Array.isArray(e) && Array.isArray(e[1]))
      .map((e) => ({ pos: str(e[0]) ? e[0] : '', terms: e[1].filter(str) }))
      .filter((e) => e.terms.length);
    if (!translation && !entries.length) throw new Error('뜻을 찾지 못했습니다');
    return { word, translation, entries };
  };

  // 설정의 BCP-47 코드 중 Google 번역 코드와 다른 것만 변환
  const GOOGLE_LANG = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' };

  // ponytail: 무제한 메모리 캐시(background 재시작 시 초기화). 메모리가 문제되면 LRU로.
  const cache = new Map();

  const lookup = async ({ word, from, to }) => {
    word = String(word || '').trim();
    if (!word) throw new Error('단어가 비어 있습니다');
    const key = `${from}|${to}|${word}`;
    if (cache.has(key)) return cache.get(key);
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&dt=bd&' +
      new URLSearchParams({ sl: GOOGLE_LANG[from] || from, tl: GOOGLE_LANG[to] || to, q: word });
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`사전 서버 오류 (HTTP ${res.status})`);
    const result = parseLookup(word, await res.json());
    cache.set(key, result);
    return result;
  };

  if (globalThis.SAO) SAO.handlers[SAO.MSG.LOOKUP] = lookup;
  if (typeof module !== 'undefined') module.exports = { parseLookup, lookup };
})();
