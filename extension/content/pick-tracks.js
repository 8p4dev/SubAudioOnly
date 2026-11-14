// 자막 순수 로직 (DOM/browser 미사용 — node에서 require 가능). 브라우저에서는 globalThis에 노출.
'use strict';

(() => {
  // 언어 매칭 키: 기본 코드(en-US -> en). 중국어만 간체/번체를 구분한다.
  const langKey = (code) => {
    const parts = String(code || '').toLowerCase().split(/[-_]/);
    if (parts[0] !== 'zh') return parts[0];
    return parts.some((p) => ['hant', 'tw', 'hk', 'mo'].includes(p)) ? 'zh-hant' : 'zh-hans';
  };

  const isAsr = (t) => t.kind === 'asr';

  /**
   * @param {{baseUrl:string, languageCode:string, kind?:string}[]} captionTracks
   * @returns {null | {target:{track:object, tlang:string|null}, native:{track:object, tlang:string|null}}}
   *   tlang이 null이면 그 트랙을 그대로, 아니면 YouTube 자동번역(tlang=<값>)으로 사용.
   */
  function pickTracks(captionTracks, nativeLang, targetLang) {
    const tracks = (captionTracks || []).filter((t) => t && t.baseUrl && t.languageCode);
    if (!tracks.length) return null;
    const manualFirst = [...tracks.filter((t) => !isAsr(t)), ...tracks.filter(isAsr)];
    const find = (lang) => manualFirst.find((t) => langKey(t.languageCode) === langKey(lang));
    const t = find(targetLang);
    const n = find(nativeLang);
    const src = t || n || manualFirst[0]; // 번역 원본: 수동 우선, 없으면 asr
    return {
      target: { track: t || src, tlang: t ? null : targetLang },
      native: { track: n || src, tlang: n ? null : nativeLang },
    };
  }

  /**
   * json3 -> 시작 시각순 [{start, end, text}] (ms).
   * asr 트랙은 줄이 겹쳐 롤업되므로 각 큐의 끝을 다음 큐의 시작으로 자른다.
   * ponytail: 수동 자막의 의도된 동시 큐(화자 2명)도 뒤의 것만 남는다. 필요해지면 겹침 병합.
   */
  function parseJson3(json) {
    const cues = [];
    for (const ev of (json && json.events) || []) {
      if (!ev.segs) continue;
      const text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      if (!text) continue; // asr의 개행 전용 이벤트 등
      const start = ev.tStartMs || 0;
      cues.push({ start, end: start + (ev.dDurationMs || 0), text });
    }
    cues.sort((a, b) => a.start - b.start);
    cues.forEach((c, i) => {
      if (cues[i + 1] && c.end > cues[i + 1].start) c.end = cues[i + 1].start;
    });
    return cues;
  }

  /** ms 시각의 큐 텍스트(없으면 ''). cues는 parseJson3 결과(정렬, 비겹침). */
  function cueAt(cues, ms) {
    let lo = 0;
    let hi = cues.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= ms) lo = mid + 1;
      else hi = mid - 1;
    }
    const c = cues[hi];
    return c && ms < c.end ? c.text : '';
  }

  /** 텍스트 -> [{text, word}] (word=true만 사전 조회 대상) */
  function segmentWords(text, lang) {
    let seg;
    try {
      seg = new Intl.Segmenter(lang, { granularity: 'word' });
    } catch (e) {
      seg = new Intl.Segmenter(undefined, { granularity: 'word' }); // 잘못된 언어 태그
    }
    return Array.from(seg.segment(text), (s) => ({ text: s.segment, word: !!s.isWordLike }));
  }

  /**
   * 트랙 baseUrl -> json3 요청 URL. potUrl(플레이어가 직접 보낸 timedtext URL)이 있으면
   * baseUrl에 없는 파라미터(pot, c, cver ...)만 가져온다. youtube.com의 timedtext가 아니면 null.
   */
  function timedtextUrl(baseUrl, tlang, potUrl, origin = 'https://www.youtube.com') {
    let u;
    try {
      u = new URL(baseUrl, origin);
      if (potUrl) {
        for (const [k, v] of new URL(potUrl, origin).searchParams) {
          if (!u.searchParams.has(k)) u.searchParams.set(k, v);
        }
      }
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(u.hostname) || u.pathname !== '/api/timedtext') return null;
    u.searchParams.set('fmt', 'json3');
    if (tlang) u.searchParams.set('tlang', tlang);
    else u.searchParams.delete('tlang');
    return u.href;
  }

  const api = { pickTracks, parseJson3, cueAt, segmentWords, timedtextUrl };
  Object.assign(globalThis, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
