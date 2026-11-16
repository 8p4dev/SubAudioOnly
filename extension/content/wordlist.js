// 영상 단어 목록 패널 (#sao-words): 현재 영상의 학습 언어 자막 전체에서 단어를 뽑아 보여 준다.
// 빠른 스위치(toggle.js)가 보내는 'sao:words-toggle' 이벤트로 열고 닫는다.
'use strict';

(() => {
  /**
   * 자막 큐 -> 고유 단어 목록(등장 순서). 전역 segmentWords/cueAt(pick-tracks.js) 사용.
   * 대소문자만 다른 단어는 하나로 합치고(표시는 처음 나온 형태), 숫자만으로 된 토큰은 뺀다.
   * @returns {{key:string, word:string, count:number, context:string, contextTranslation:string, time:number}[]}
   *   context = 처음 나온 문장, contextTranslation = 그 시각의 자국어 큐(없으면 ''), time = 초
   */
  function extractWords(target, native, lang) {
    const map = new Map();
    for (const cue of target || []) {
      for (const s of segmentWords(cue.text, lang)) {
        if (!s.word || /^[\p{N}.,]+$/u.test(s.text)) continue;
        const key = s.text.toLowerCase();
        const w = map.get(key);
        if (w) w.count++;
        else {
          map.set(key, {
            key, word: s.text, count: 1, context: cue.text,
            contextTranslation: cueAt(native || [], (cue.start + cue.end) / 2),
            time: cue.start / 1000,
          });
        }
      }
    }
    return [...map.values()];
  }

  if (typeof module !== 'undefined') module.exports = { extractWords };
  if (typeof document === 'undefined') return; // node 테스트

  // ponytail: 100행씩 그리고 그려진 행만 번역한다(DOM 크기와 번역 요청 수를 함께 제한). 부족하면 가상 스크롤로.
  const PAGE = 100;
  const BATCH = 50; // 번역 요청 하나에 담는 단어 수 — 뜻이 도착하는 대로 채우기 위해 나눠 보낸다

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text) n.textContent = text;
    if (tag === 'button') n.type = 'button';
    return n;
  };

  const root = el('div', '');
  root.id = 'sao-words';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '영상 단어 목록');
  const title = el('span', 'sao-words-title');
  const sortBtn = el('button', 'sao-words-sort');
  const closeBtn = el('button', 'sao-words-close', '×');
  closeBtn.setAttribute('aria-label', '닫기');
  const head = el('div', 'sao-words-head');
  head.append(title, sortBtn, closeBtn);
  const note = el('div', 'sao-words-note');
  const list = el('div', 'sao-words-list');
  const moreBtn = el('button', 'sao-words-more');
  root.append(head, note, list);

  let settings = SAO.DEFAULTS;
  let openVid = null;   // 패널을 연 영상(닫혀 있으면 null)
  let words = [];       // extractWords 결과(등장 순서)
  let ordered = [];     // 현재 정렬로 늘어놓은 words
  let shown = 0;        // 그려진 행 수
  let byFreq = false;
  let gen = 0;          // 자막이 바뀌거나 닫히면 증가 → 진행 중인 번역 결과를 버린다
  let queue = Promise.resolve(); // 번역 요청은 한 번에 하나씩
  const meanings = new Map();    // key -> 뜻
  const rows = new Map();        // key -> {row, meaning}
  let saved = new Set();         // 단어장에 있는 단어의 key

  const host = () => document.fullscreenElement || document.body;
  const videoId = () => (location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null);
  const isOpen = () => openVid !== null;

  // 세로: 플레이어 아래 영역을 덮는다(가로는 CSS가 오른쪽 옆으로 배치하고 이 값을 쓰지 않는다).
  function place() {
    const p = document.getElementById('player-container-id') || document.getElementById('movie_player');
    const bottom = p ? p.getBoundingClientRect().bottom : 0;
    const top = bottom > 0 && bottom < innerHeight * 0.7 ? bottom : innerHeight * 0.4;
    root.style.setProperty('--sao-words-top', `${Math.round(top)}px`);
  }

  function paintNote() {
    note.textContent = words.length
      ? (settings.dictionary ? '' : '사전이 꺼져 있습니다. 켜면 단어를 탭해 자세한 뜻을 볼 수 있습니다.')
      : (settings.dualSubs ? '이 영상에는 자막이 없습니다. (불러오는 중이면 곧 표시됩니다)'
        : '자막이 꺼져 있습니다. 자막을 켜면 단어 목록을 볼 수 있습니다.');
  }

  const paintSaved = () => rows.forEach((r, key) => r.row.classList.toggle('sao-words-saved', saved.has(key)));

  async function loadSaved() {
    const lang = SAO.subs && SAO.subs.lang;
    const items = await SAO.vocab.list().catch(() => []);
    saved = new Set(items.filter((v) => v.lang === lang).map((v) => String(v.word).toLowerCase()));
    paintSaved();
  }

  // 그려진 행의 뜻을 받아 채운다. 실패하면 뜻 없이 둔다.
  function fill(page) {
    const g = gen;
    const from = SAO.subs.lang;
    const to = settings.nativeLang;
    queue = queue.then(async () => {
      const todo = page.filter((w) => !meanings.has(w.key));
      for (let i = 0; i < todo.length && g === gen; i += BATCH) {
        const chunk = todo.slice(i, i + BATCH);
        const out = await SAO.send(SAO.MSG.TRANSLATE_BATCH, { texts: chunk.map((w) => w.word), from, to });
        if (g !== gen) return;
        chunk.forEach((w, j) => {
          if (!out[j]) return;
          meanings.set(w.key, out[j]);
          const r = rows.get(w.key);
          if (r) r.meaning.textContent = out[j];
        });
      }
    }).catch(() => {});
  }

  function more() {
    const page = ordered.slice(shown, shown + PAGE);
    shown += page.length;
    moreBtn.remove();
    for (const w of page) {
      const row = el('div', 'sao-words-row');
      // dict.js가 이 속성들을 문맥으로 읽는다(공유 계약)
      row.dataset.saoContext = w.context;
      if (w.contextTranslation) row.dataset.saoContextTranslation = w.contextTranslation;
      row.dataset.saoTime = String(w.time);
      const word = el('span', 'sao-word', w.word);
      word.lang = SAO.subs.lang;
      const meaning = el('span', 'sao-words-meaning', meanings.get(w.key));
      const mark = el('span', 'sao-words-mark', '★');
      mark.setAttribute('aria-label', '단어장에 있음');
      row.append(word, w.count > 1 ? el('span', 'sao-words-count', `×${w.count}`) : '', meaning, mark);
      row.classList.toggle('sao-words-saved', saved.has(w.key));
      rows.set(w.key, { row, meaning });
      list.append(row);
    }
    if (shown < ordered.length) {
      moreBtn.textContent = `더 보기 (${ordered.length - shown}개 남음)`;
      list.append(moreBtn);
    }
    if (page.length) fill(page);
  }

  function render() {
    title.textContent = words.length ? `단어 ${words.length}개` : '단어';
    sortBtn.hidden = !words.length;
    sortBtn.textContent = byFreq ? '빈도순' : '등장순';
    sortBtn.setAttribute('aria-label', `정렬: ${sortBtn.textContent} (탭하면 전환)`);
    paintNote();
    ordered = byFreq ? [...words].sort((a, b) => b.count - a.count) : words; // 안정 정렬: 같은 빈도는 등장 순서
    list.replaceChildren();
    list.scrollTop = 0;
    rows.clear();
    shown = 0;
    more();
  }

  function rebuild() {
    gen++;
    meanings.clear();
    const subs = SAO.subs;
    words = subs ? extractWords(subs.target, subs.native, subs.lang) : [];
    render();
    loadSaved();
  }

  function open() {
    openVid = videoId();
    if (!openVid) return;
    host().append(root);
    document.documentElement.classList.add('sao-words-open'); // 가로 화면에서 자막을 패널 옆으로 비킨다(wordlist.css)
    place();
    rebuild();
  }

  function close() {
    openVid = null;
    gen++;
    root.remove();
    document.documentElement.classList.remove('sao-words-open');
  }

  // 영상이 바뀌었거나 /watch가 아니면 닫는다.
  const check = () => { if (isOpen() && videoId() !== openVid) close(); };

  document.addEventListener('sao:words-toggle', () => (isOpen() ? close() : open()));
  document.addEventListener('sao:cues', () => {
    check();
    if (isOpen()) rebuild();
  });
  for (const ev of ['state-navigateend', 'yt-navigate-finish', 'popstate']) window.addEventListener(ev, check);
  window.addEventListener('resize', () => { if (isOpen()) place(); });
  // 전체화면에서는 fullscreen element의 자손만 보인다.
  document.addEventListener('fullscreenchange', () => {
    if (!isOpen()) return;
    host().append(root);
    place();
  });

  const inside = (e) => e.target instanceof Element && !!e.target.closest('#sao-words');

  // 캡처 단계에서 가로채 패널 안의 탭이 뒤의 YouTube 페이지로 가지 않게 한다.
  // .sao-word 탭은 먼저 등록된 dict.js의 리스너가 처리한다(사전 팝업이 열려 있을 때의 팝업 밖 탭도 dict.js가
  // 처리하고 preventDefault한다) — 그런 클릭에는 패널 버튼이 반응하지 않는다.
  document.addEventListener('click', (e) => {
    if (!inside(e)) return;
    const handled = e.defaultPrevented;
    e.preventDefault();
    e.stopPropagation();
    if (handled) return;
    const b = e.target.closest('button');
    if (b === closeBtn) close();
    else if (b === moreBtn) more();
    else if (b === sortBtn) {
      byFreq = !byFreq;
      render();
    }
  }, true);
  // 기본 동작은 유지(스크롤, click 합성)하고 전파만 끊는다.
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
    document.addEventListener(type, (e) => { if (inside(e)) e.stopPropagation(); }, true);
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.vocab && isOpen()) loadSaved();
  });
  SAO.onSettingsChanged((s) => {
    settings = s;
    if (isOpen()) paintNote();
  });
  SAO.getSettings().then((s) => {
    settings = s;
    if (isOpen()) paintNote();
  });
})();
