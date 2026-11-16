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

  // ---- 일본어 분절 후처리 ----
  // Intl.Segmenter는 일본어 활용형을 1~2글자로 쪼갠다(食·べ·まし·た). 어간 뒤의 어미·조동사를 한 단위로 묶는다.
  // ponytail: 사전 없는 휴리스틱. 틀리는 예 — 조사 없이 이어지는 말(人がいます: 엔진이 'がい'로 자름),
  // 한자 없는 동사(かかり|ます), 엔진이 조사와 붙여 자른 조각(でく, はと). 사용자는 사전 팝업의 범위 조절로 바로잡는다.
  // 더 정확해야 하면 형태소 분석기(사전 수십 MB)가 필요하다.
  const JA_HAN = /[\p{sc=Han}々]/u;
  const JA_HIRA = /^[\p{sc=Hiragana}ー]+$/u;
  const JA_STEM = /^[\p{sc=Han}々\p{sc=Hiragana}]+$/u; // 한자가 든 어간(行, 行き, 勉強)
  const JA_NOUN = /^[\p{sc=Han}々]{2,}$/u;             // 한자 2자 이상: する 활용만 붙인다
  // 여기서 묶기를 멈춘다: 조사·계사와, 한자 명사 바로 뒤에 조사 없이 자주 오는 말
  const JA_STOP = new Set(('は が を に で と も の へ や か ね よ な わ ぞ から まで より だ です でも では には とは にも とも ' +
    'なら だけ しか ほど くらい ぐらい など とか かな かも けど だけど けれど のに ので じゃ でした でしょう だろう だった ' +
    'また もう まだ よく いい とても すぐ これ それ あれ この その あの ここ そこ こと もの ほうが たち').split(' '));

  /** [{text, word}] -> [{text, word}] (이어 붙인 문자열은 그대로) */
  function mergeJa(segs) {
    const out = [];
    const hira = (s) => !!s && s.word && JA_HIRA.test(s.text);
    segs.forEach((s, i) => {
      const prev = out[out.length - 1];
      const next = hira(segs[i + 1]) ? segs[i + 1].text : '';
      const t = s.text;
      const okuri = () => {
        if (!prev.stem) return false;
        // 조사와 같은 꼴의 어미: 分か·り, 行か·ない, 曲が·って, 嬉しか·った, 分から·ない, 行かな·い
        if (/^(か|が|しか)$/.test(t) && /^っ/.test(next)) return true;
        if (/^[かが]$/.test(t) && next.length <= 2 && /^[らりるれ]/.test(next)) return true;
        if ((t === 'か' || t === 'から') && next.length <= 2 && /^[なん]/.test(next)) return true;
        if (t === 'かな' && /^[いか]/.test(next)) return true;
        if (JA_STOP.has(t) || [...t].length > 3) return false;
        return prev.grown || !JA_NOUN.test(prev.text) || /^[しすさ]/.test(t);
      };
      // っゃゅょんー 로 시작하는 조각은 단어의 첫머리일 수 없다 → 앞 단어에 붙인다
      if (prev && prev.word && hira(s) && (/^[っゃゅょんー]/.test(t) || okuri())) {
        prev.text += t;
        prev.grown = true;
      } else {
        out.push({ text: t, word: s.word, stem: s.word && JA_HAN.test(t) && JA_STEM.test(t), grown: false });
      }
    });
    return out.map(({ text, word }) => ({ text, word }));
  }

  /** 텍스트 -> [{text, word}] (word=true만 사전 조회 대상). 이어 붙이면 원문과 같다. */
  function segmentWords(text, lang) {
    let seg;
    try {
      seg = new Intl.Segmenter(lang, { granularity: 'word' });
    } catch (e) {
      seg = new Intl.Segmenter(undefined, { granularity: 'word' }); // 잘못된 언어 태그
    }
    // isWordLike는 쓰지 않는다: Firefox는 東京, です, 見 같은 단어도 false로 돌려준다.
    const segs = Array.from(seg.segment(text), (s) => ({ text: s.segment, word: /[\p{L}\p{N}]/u.test(s.segment) }));
    return langKey(lang) === 'ja' ? mergeJa(segs) : segs;
  }

  // ---- 사전 팝업의 선택 범위 조절 ----
  const CJ = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u;

  /**
   * 범위 조절 단위 [{text, word, seg}]: seg = segmentWords 세그먼트 번호.
   * 한자·가나 단어는 글자마다 한 단위(분절이 틀려도 한 글자씩 줄여 바로잡을 수 있게).
   */
  function selectionUnits(text, lang) {
    return segmentWords(text, lang).flatMap((s, seg) =>
      (s.word && CJ.test(s.text) ? Array.from(s.text) : [s.text]).map((t) => ({ text: t, word: s.word, seg })));
  }

  /**
   * 선택 [a, b)의 한쪽 끝을 옮긴다(공백·문장부호는 건너뜀). 넓힐 때는 세그먼트 하나, 줄일 때는 단위 하나.
   * edge: 'start'|'end', dir: -1(앞으로)|1(뒤로). 못 옮기면 null.
   */
  function moveEdge(units, a, b, edge, dir) {
    const start = edge === 'start';
    const lo = start ? (dir < 0 ? 0 : a + 1) : (dir < 0 ? a : b);
    const hi = start ? (dir < 0 ? a : b) : (dir < 0 ? b - 1 : units.length); // [lo, hi) 안에서 찾는다
    let j = dir < 0 ? hi - 1 : lo;
    while (j >= lo && j < hi && !units[j].word) j += dir;
    if (j < lo || j >= hi) return null;
    if (start === dir < 0) while (units[j + dir] && units[j + dir].seg === units[j].seg) j += dir; // 넓히기: 세그먼트 끝까지
    return start ? [j, b] : [a, j + 1];
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

  const api = { pickTracks, parseJson3, cueAt, segmentWords, mergeJa, selectionUnits, moveEdge, timedtextUrl };
  Object.assign(globalThis, api);
  if (typeof module !== 'undefined') module.exports = api;
})();
