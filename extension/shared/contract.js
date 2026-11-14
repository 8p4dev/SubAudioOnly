// 공유 계약 — 모든 컨텍스트(background, content, options, popup, vocab)에서 가장 먼저 로드된다.
// 오케스트레이터 소유. 하위 에이전트는 수정 금지(변경 필요 시 보고).
// 최상위에서 `browser`를 건드리지 않는다(node 테스트에서 require 가능해야 함).
'use strict';

globalThis.SAO = (() => {
  const DEFAULTS = {
    nativeLang: 'ko',   // 자국어 (BCP-47 기본 코드: 'ko', 'en', 'ja', 'zh-Hans' ...)
    targetLang: 'en',   // 학습 언어
    audioOnly: true,    // 영상 로딩 차단 + 검은 화면
    dualSubs: true,     // 학습 언어 + 자국어 이중 자막
    dictionary: true,   // 단어 클릭 사전
    subtitleScale: 1,   // 자막 글자 배율 (0.6 ~ 2)
  };

  // 메시지 타입 (content/UI -> background)
  const MSG = {
    LOOKUP: 'sao:lookup',     // {word, from, to} -> LookupResult
    CAPTIONS: 'sao:captions', // subs 에이전트 내부용 (payload는 subs 에이전트가 정의)
    AUDIO: 'sao:audio',       // audio 에이전트 내부용 (payload는 audio 에이전트가 정의)
  };

  /**
   * @typedef {{word:string, translation:string, entries:{pos:string, terms:string[]}[]}} LookupResult
   * @typedef {{id:string, word:string, meaning:string, context:string, contextTranslation:string,
   *   lang:string, videoId:string, videoTitle:string, time:number, addedAt:number}} VocabItem
   */

  const getSettings = async () =>
    ({ ...DEFAULTS, ...(await browser.storage.local.get('settings')).settings });

  const setSettings = async (patch) => {
    const settings = { ...(await getSettings()), ...patch };
    await browser.storage.local.set({ settings });
    return settings;
  };

  // cb(settings) — 설정이 바뀔 때마다 전체 설정 객체로 호출
  const onSettingsChanged = (cb) =>
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) cb({ ...DEFAULTS, ...changes.settings.newValue });
    });

  // background로 메시지 전송. 핸들러가 throw하면 여기서 reject된다.
  const send = async (type, payload = {}) => {
    const res = await browser.runtime.sendMessage({ ...payload, type });
    if (res && res.__error) throw new Error(res.__error);
    return res;
  };

  // background 전용: handlers[MSG.X] = async (msg, sender) => result  (background/main.js가 디스패치)
  const handlers = {};

  // ponytail: 단어장은 storage.local 배열 하나. 수천 개 넘어가면 IndexedDB로.
  const vocab = {
    /** @returns {Promise<VocabItem[]>} 최신순 */
    list: async () => (await browser.storage.local.get('vocab')).vocab || [],
    /** 같은 word+lang은 덮어쓴다. id/addedAt은 자동 부여. */
    add: async (item) => {
      const rest = (await vocab.list()).filter((v) => !(v.word === item.word && v.lang === item.lang));
      const saved = {
        meaning: '', context: '', contextTranslation: '', videoId: '', videoTitle: '', time: 0,
        ...item, id: crypto.randomUUID(), addedAt: Date.now(),
      };
      await browser.storage.local.set({ vocab: [saved, ...rest] });
      return saved;
    },
    remove: async (id) =>
      browser.storage.local.set({ vocab: (await vocab.list()).filter((v) => v.id !== id) }),
    clear: () => browser.storage.local.set({ vocab: [] }),
    /** 노션 등에 붙여넣을 수 있는 마크다운 표 */
    toMarkdown: (items) => {
      const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();
      const source = (v) =>
        v.videoId
          ? `[${cell(v.videoTitle) || v.videoId}](https://youtu.be/${v.videoId}?t=${Math.floor(v.time || 0)})`
          : '';
      return [
        '| 단어 | 뜻 | 문장 | 번역 | 출처 |',
        '| --- | --- | --- | --- | --- |',
        ...items.map((v) =>
          `| ${cell(v.word)} | ${cell(v.meaning)} | ${cell(v.context)} | ${cell(v.contextTranslation)} | ${source(v)} |`),
      ].join('\n');
    },
  };

  return { DEFAULTS, MSG, getSettings, setSettings, onSettingsChanged, send, handlers, vocab };
})();
