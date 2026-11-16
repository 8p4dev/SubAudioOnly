// R4 단어 클릭 사전 + R5 단어장 추가. 자막 오버레이(.sao-word)는 subs 소유 — 여기선 읽기만 한다.
// 오버레이 밖의 .sao-word(단어 목록 등)는 data-sao-context / data-sao-context-translation / data-sao-time 으로 문맥을 준다.
'use strict';

(() => {
  let settings = SAO.DEFAULTS;
  SAO.getSettings().then((s) => { settings = s; });
  SAO.onSettingsChanged((s) => {
    settings = s;
    if (!s.dictionary) close();
  });

  let popup = null;   // #sao-dict (열려 있을 때만)
  let ui = null;      // 팝업 안에서 갱신하는 요소들
  let active = null;  // 선택된 .sao-word
  let base = null;    // 단어장 항목의 공통 부분(처음 탭한 단어, 문맥, 영상, 시각)
  let sel = null;     // 선택 범위 {units, a, b}: 문맥 문장의 단위 배열과 [a, b). 문맥에서 단어를 못 찾으면 null
  let item = null;    // 단어장에 넣을 항목(조회 완료 전에는 meaning 없음)
  let resume = false; // 닫을 때 재생 재개 여부

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text) n.textContent = text;
    return n;
  };
  const button = (cls, text, label) => {
    const b = el('button', cls, text);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  };

  const host = () => document.fullscreenElement || document.body;

  const videoId = () =>
    new URLSearchParams(location.search).get('v') ||
    (location.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)/) || [])[1] || '';

  function close() {
    if (!popup) return;
    popup.remove();
    popup = ui = base = sel = item = null;
    if (active) active.classList.remove('sao-dict-active');
    active = null;
    const video = document.querySelector('video');
    if (resume && video) video.play().catch(() => {});
    resume = false;
  }

  function open(span) {
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

    const lang = settings.targetLang;
    const attr = (name) => {
      const n = span.closest(`[${name}]`);
      return n ? n.getAttribute(name) : null;
    };
    const line = span.closest('.sao-line-target');
    const native = document.querySelector('#sao-overlay .sao-line-native');
    let context = attr('data-sao-context');
    const outside = context !== null; // 오버레이 밖 단어: 문맥을 속성에서 읽는다
    let offset = -1;                  // 문맥 안에서 단어가 시작하는 위치
    if (outside) {
      let pos = 0;
      for (const s of segmentWords(context, lang)) {
        if (s.word && s.text === word) { offset = pos; break; }
        pos += s.text.length;
      }
      if (offset < 0) offset = context.indexOf(word);
    } else if (line) {
      context = line.textContent;
      offset = 0;
      for (let n = span.previousSibling; n; n = n.previousSibling) offset += n.textContent.length;
    }
    context = context || '';

    // 자막 줄은 곧 다시 그려지므로 span을 붙잡지 않고 문장을 단위 배열로 복사해 둔다.
    sel = null;
    if (offset >= 0) {
      const units = selectionUnits(context, lang);
      let pos = 0;
      let a = -1;
      let b = -1;
      units.forEach((u, i) => {
        if (pos === offset) a = i;
        pos += u.text.length;
        if (pos === offset + word.length) b = i + 1;
      });
      if (a >= 0 && b > a) sel = { units, a, b };
    }

    base = {
      word, lang,
      context: context.trim(),
      contextTranslation: (outside ? attr('data-sao-context-translation') || '' : native ? native.textContent : '').trim(),
      videoId: videoId(),
      videoTitle: document.title.replace(/ - YouTube$/, ''),
      time: outside ? Number(attr('data-sao-time')) || 0 : video ? video.currentTime : 0,
    };

    popup = el('div', '');
    popup.id = 'sao-dict';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', '사전');
    popup.lang = settings.nativeLang;
    const head = el('div', 'sao-dict-head');
    const title = el('div', 'sao-dict-title');
    ui = {
      word: el('span', 'sao-dict-word'),
      reading: el('span', 'sao-dict-reading'),
      context: el('div', 'sao-dict-context'),
      body: el('div', 'sao-dict-body'),
      add: button('sao-dict-add'),
      range: [],
    };
    ui.word.lang = ui.context.lang = lang;
    title.append(ui.word, ui.reading);
    head.append(title, button('sao-dict-close', '×', '닫기'));
    popup.append(head);
    if (sel) {
      // 화살표 = 선택의 그 끝이 움직이는 방향
      const range = el('div', 'sao-dict-range');
      for (const [edge, name] of [['start', '시작'], ['end', '끝']]) {
        range.append(el('span', 'sao-dict-range-label', name));
        for (const [dir, text, where] of [[-1, '◀', '앞으로'], [1, '▶', '뒤로']]) {
          const b = button('', text, `선택 ${name}을 ${where}`);
          b.dataset.edge = edge;
          b.dataset.dir = dir;
          ui.range.push(b);
          range.append(b);
        }
      }
      popup.append(ui.context, ui.body, range, ui.add);
    } else {
      popup.append(ui.body, ui.add);
    }
    host().append(popup);
    show();
  }

  // 현재 선택(sel이 없으면 처음 탭한 단어)을 조회해 팝업 내용을 채운다.
  async function show() {
    const text = (i, j) => sel.units.slice(i, j).map((u) => u.text).join('');
    const word = sel ? text(sel.a, sel.b) : base.word;
    const mine = item = { ...base, word };
    const { body, add } = ui;
    ui.word.textContent = word;
    ui.reading.textContent = '';
    if (sel) {
      const mark = el('span', 'sao-dict-sel', word);
      ui.context.replaceChildren(text(0, sel.a), mark, text(sel.b));
      ui.context.scrollTop = mark.offsetTop - ui.context.clientHeight / 2;
      ui.context.scrollLeft = mark.offsetLeft - ui.context.clientWidth / 2;
      for (const b of ui.range) b.disabled = !moveEdge(sel.units, sel.a, sel.b, b.dataset.edge, Number(b.dataset.dir));
    }
    body.replaceChildren(el('div', 'sao-dict-status', '검색 중…'));
    add.textContent = '단어장에 추가';
    add.disabled = true;

    let result;
    let saved = false;
    try {
      [result, saved] = await Promise.all([
        SAO.send(SAO.MSG.LOOKUP, { word, from: mine.lang, to: settings.nativeLang }),
        SAO.vocab.list().then((l) => l.some((v) => v.word === word && v.lang === mine.lang), () => false),
      ]);
    } catch (e) {
      if (item !== mine) return;
      body.replaceChildren(el('div', 'sao-dict-status sao-dict-error', `뜻을 불러오지 못했습니다. (${e.message})`));
      return;
    }
    if (item !== mine) return; // 그 사이 닫혔거나 다른 단어/범위가 열림

    const entries = Array.isArray(result.entries) ? result.entries : [];
    // meaning = 대표 번역 + 품사별 앞쪽 뜻 몇 개(중복 제거, 최대 6개)
    mine.meaning = [...new Set([result.translation, ...entries.flatMap((e) => e.terms.slice(0, 3))])]
      .filter(Boolean).slice(0, 6).join(', ');
    if (typeof result.reading === 'string') ui.reading.textContent = result.reading;
    // 사전 항목(품사별 뜻)은 영어가 낀 언어 쌍에서만 온다. 없으면 번역만 보인다.
    body.replaceChildren(el('div', 'sao-dict-translation', result.translation));
    for (const e of entries) {
      const row = el('div', 'sao-dict-entry');
      row.append(el('span', 'sao-dict-pos', e.pos), el('span', 'sao-dict-terms', e.terms.slice(0, 8).join(', ')));
      body.append(row);
    }
    if (saved) add.textContent = '추가됨';
    else add.disabled = false;
  }

  // 선택의 한쪽 끝을 옮기고 그 범위로 다시 조회한다.
  function moveSelection(btn) {
    const r = sel && moveEdge(sel.units, sel.a, sel.b, btn.dataset.edge, Number(btn.dataset.dir));
    if (!r) return;
    [sel.a, sel.b] = r;
    show();
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

  const hit = (e, selector) => (e.target instanceof Element ? e.target.closest(selector) : null);
  const LINE = '#sao-overlay .sao-line-target';

  // 탭한 단어. 자막 줄의 빈 곳(공백·문장부호·줄 사이)을 누르면 가장 가까운 단어로 본다:
  // 한두 글자짜리 단어는 손가락으로 정확히 맞히기 어렵고, 빗나간 탭이 플레이어로 떨어지면 재생이 토글된다.
  function wordAt(e) {
    const word = hit(e, '.sao-word');
    const line = !word && hit(e, LINE);
    if (!line) return word;
    let best = null;
    let min = Infinity;
    for (const w of line.querySelectorAll('.sao-word')) {
      for (const r of w.getClientRects()) {
        const d = Math.hypot(
          Math.max(r.left - e.clientX, 0, e.clientX - r.right),
          Math.max(r.top - e.clientY, 0, e.clientY - r.bottom),
        );
        if (d < min) { min = d; best = w; }
      }
    }
    return best;
  }

  // 캡처 단계에서 가로채 YouTube 플레이어의 탭 동작(재생 토글, 컨트롤 표시)을 막는다.
  // 캡처에서 전파를 끊으면 팝업 버튼의 자체 리스너도 못 받으므로 버튼도 여기서 위임 처리한다.
  document.addEventListener('click', (e) => {
    const word = settings.dictionary && wordAt(e);
    if (!word && !popup) return;
    e.preventDefault();
    e.stopPropagation();
    if (word) open(word);
    else if (hit(e, '.sao-dict-add')) addToVocab(hit(e, '.sao-dict-add'));
    else if (hit(e, '.sao-dict-range button')) moveSelection(hit(e, '.sao-dict-range button'));
    else if (hit(e, '.sao-dict-close') || !hit(e, '#sao-dict')) close(); // 닫기 버튼 또는 팝업 밖 탭
  }, true);

  // 플레이어가 click 대신 touch/pointer 이벤트로 탭을 처리하는 경우 대비(기본 동작은 유지 → click 합성/스크롤 정상).
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    document.addEventListener(type, (e) => {
      if ((settings.dictionary && hit(e, `.sao-word, ${LINE}`)) || hit(e, '#sao-dict')) e.stopPropagation();
    }, true);
  }

  // 전체화면에서는 fullscreen element의 자손만 보인다.
  document.addEventListener('fullscreenchange', () => { if (popup) host().append(popup); });
})();
