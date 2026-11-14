// R4 단어 클릭 사전 + R5 단어장 추가. 자막 오버레이(.sao-word)는 subs 에이전트 소유 — 여기선 읽기만 한다.
'use strict';

(() => {
  let settings = SAO.DEFAULTS;
  SAO.getSettings().then((s) => { settings = s; });
  SAO.onSettingsChanged((s) => {
    settings = s;
    if (!s.dictionary) close();
  });

  let popup = null;   // #sao-dict (열려 있을 때만)
  let active = null;  // 선택된 .sao-word
  let item = null;    // 단어장에 넣을 항목(조회 완료 전에는 meaning 없음)
  let resume = false; // 닫을 때 재생 재개 여부

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  const host = () => document.fullscreenElement || document.body;

  const videoId = () =>
    new URLSearchParams(location.search).get('v') ||
    (location.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/) || [])[1] || '';

  function close() {
    if (!popup) return;
    popup.remove();
    popup = item = null;
    if (active) active.classList.remove('sao-dict-active');
    active = null;
    const video = document.querySelector('video');
    if (resume && video) video.play().catch(() => {});
    resume = false;
  }

  async function open(span) {
    const word = span.textContent.trim();
    if (!word) return;
    const video = document.querySelector('video');
    if (!popup) { // 이미 열려 있으면(다른 단어 탭) 최초의 재생 상태를 유지
      resume = !!video && !video.paused;
      if (resume) video.pause();
    } else {
      popup.remove();
      if (active) active.classList.remove('sao-dict-active');
    }
    active = span;
    span.classList.add('sao-dict-active');

    const line = span.closest('.sao-line-target');
    const native = document.querySelector('#sao-overlay .sao-line-native');
    const lang = settings.targetLang;
    const mine = item = {
      word, lang,
      context: line ? line.textContent.trim() : '',
      contextTranslation: native ? native.textContent.trim() : '',
      videoId: videoId(),
      videoTitle: document.title.replace(/ - YouTube$/, ''),
      time: video ? video.currentTime : 0,
    };

    popup = el('div', '');
    popup.id = 'sao-dict';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '사전');
    popup.lang = settings.nativeLang;
    const head = el('div', 'sao-dict-head');
    const title = el('span', 'sao-dict-word', word);
    title.lang = lang;
    const closeBtn = el('button', 'sao-dict-close', '×');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '닫기');
    head.append(title, closeBtn);
    const body = el('div', 'sao-dict-body');
    body.append(el('div', 'sao-dict-status', '검색 중…'));
    const add = el('button', 'sao-dict-add', '단어장에 추가');
    add.type = 'button';
    add.disabled = true;
    popup.append(head, body, add);
    host().append(popup);

    let result, saved = false;
    try {
      [result, saved] = await Promise.all([
        SAO.send(SAO.MSG.LOOKUP, { word, from: lang, to: settings.nativeLang }),
        SAO.vocab.list().then((l) => l.some((v) => v.word === word && v.lang === lang), () => false),
      ]);
    } catch (e) {
      if (item !== mine) return;
      body.replaceChildren(el('div', 'sao-dict-status sao-dict-error', `뜻을 불러오지 못했습니다. (${e.message})`));
      return;
    }
    if (item !== mine) return; // 그 사이 닫혔거나 다른 단어가 열림

    const entries = Array.isArray(result.entries) ? result.entries : [];
    // meaning = 대표 번역 + 품사별 앞쪽 뜻 몇 개(중복 제거, 최대 6개)
    mine.meaning = [...new Set([result.translation, ...entries.flatMap((e) => e.terms.slice(0, 3))])]
      .filter(Boolean).slice(0, 6).join(', ');
    body.replaceChildren(el('div', 'sao-dict-translation', result.translation));
    for (const e of entries) {
      const row = el('div', 'sao-dict-entry');
      row.append(el('span', 'sao-dict-pos', e.pos), el('span', 'sao-dict-terms', e.terms.slice(0, 8).join(', ')));
      body.append(row);
    }
    if (saved) add.textContent = '추가됨';
    else add.disabled = false;
  }

  async function addToVocab(btn) {
    if (btn.disabled || !item || item.meaning === undefined) return;
    btn.disabled = true;
    try {
      await SAO.vocab.add(item);
      btn.textContent = '추가됨';
    } catch (e) {
      btn.textContent = '추가 실패 — 다시 시도';
      btn.disabled = false;
    }
  }

  const hit = (e, sel) => (e.target instanceof Element ? e.target.closest(sel) : null);

  // 캡처 단계에서 가로채 YouTube 플레이어의 탭 동작(재생 토글, 컨트롤 표시)을 막는다.
  // 캡처에서 전파를 끊으면 팝업 버튼의 자체 리스너도 못 받으므로 버튼도 여기서 위임 처리한다.
  document.addEventListener('click', (e) => {
    const word = settings.dictionary && hit(e, '.sao-word');
    if (!word && !popup) return;
    e.preventDefault();
    e.stopPropagation();
    if (word) open(word);
    else if (hit(e, '.sao-dict-add')) addToVocab(hit(e, '.sao-dict-add'));
    else if (hit(e, '.sao-dict-close') || !hit(e, '#sao-dict')) close(); // 닫기 버튼 또는 팝업 밖 탭
  }, true);

  // 플레이어가 click 대신 touch/pointer 이벤트로 탭을 처리하는 경우 대비(기본 동작은 유지 → click 합성/스크롤 정상).
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    document.addEventListener(type, (e) => {
      if ((settings.dictionary && hit(e, '.sao-word')) || hit(e, '#sao-dict')) e.stopPropagation();
    }, true);
  }

  // 전체화면에서는 fullscreen element의 자손만 보인다.
  document.addEventListener('fullscreenchange', () => { if (popup) host().append(popup); });
})();
