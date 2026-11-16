// 단어 목록의 뜻 — Google 번역 무료 엔드포인트에 단어를 줄바꿈으로 묶어 한 번에 번역한다.
'use strict';

(() => {
  // 설정의 BCP-47 코드 중 Google 번역 코드와 다른 것만 변환
  const GOOGLE_LANG = { 'zh-Hans': 'zh-CN', 'zh-Hant': 'zh-TW' };
  const CHUNK = 50; // 묶음당 단어 수 (실측: 1000단어 POST도 줄 수가 맞았지만 실패 시 잃는 범위를 줄인다)

  // ponytail: 무제한 메모리 캐시(background 재시작 시 초기화). 메모리가 문제되면 LRU로.
  const cache = new Map();

  // 응답 [0]의 조각을 이어 붙여 줄 단위로 나눈다. 줄 수가 n과 다르면 null.
  // (언어에 따라 조각이 줄마다 오기도, 하나로 합쳐져 오기도 하므로 조각 수로 판단하면 안 된다.)
  const parseBatch = (data, n) => {
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const lines = data[0]
      .map((seg) => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('').split('\n');
    return lines.length === n ? lines.map((s) => s.trim()) : null;
  };

  // 한 묶음 번역. 줄 수가 안 맞으면 반으로 나눠 한 번만 재시도하고, 그래도 안 맞으면 ''.
  // HTTP/네트워크 오류는 throw.
  async function translateChunk(texts, sl, tl, retry = true) {
    const res = await fetch(
      'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&' + new URLSearchParams({ sl, tl }),
      { method: 'POST', body: new URLSearchParams({ q: texts.join('\n') }), signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`번역 서버 오류 (HTTP ${res.status})`);
    const out = parseBatch(await res.json(), texts.length);
    if (out) return out;
    if (!retry || texts.length < 2) return texts.map(() => '');
    const mid = texts.length >> 1;
    return [
      ...(await translateChunk(texts.slice(0, mid), sl, tl, false)),
      ...(await translateChunk(texts.slice(mid), sl, tl, false)),
    ];
  }

  // {texts, from, to} -> string[] (입력과 같은 길이, 실패 항목은 '')
  const translateBatch = async ({ texts, from, to }) => {
    const sl = GOOGLE_LANG[from] || from;
    const tl = GOOGLE_LANG[to] || to;
    // 줄바꿈이 섞이면 줄 수가 틀어지므로 공백으로 편다
    const clean = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? '').replace(/\s+/g, ' ').trim());
    const key = (t) => `${sl}|${tl}|${t}`;
    const todo = [...new Set(clean.filter((t) => t && !cache.has(key(t))))];
    try {
      for (let i = 0; i < todo.length; i += CHUNK) { // 순차: 동시 요청을 만들지 않는다
        const chunk = todo.slice(i, i + CHUNK);
        const out = await translateChunk(chunk, sl, tl);
        chunk.forEach((t, j) => { if (out[j]) cache.set(key(t), out[j]); });
      }
    } catch (e) {
      console.warn('[SAO words]', e); // 차단/오프라인: 남은 묶음은 보내지 않고 받은 것만 돌려준다
    }
    return clean.map((t) => cache.get(key(t)) || '');
  };

  if (globalThis.SAO) SAO.handlers[SAO.MSG.TRANSLATE_BATCH] = translateBatch;
  if (typeof module !== 'undefined') module.exports = { parseBatch, translateBatch };
})();
