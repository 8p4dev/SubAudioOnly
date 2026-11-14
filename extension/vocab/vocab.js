'use strict';

const $ = (id) => document.getElementById(id);

// 사용자 데이터는 항상 textContent로만 넣는다(innerHTML 금지).
const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};

const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

const card = (v) => {
  const li = el('li', 'card');

  const head = el('div', 'head');
  const title = el('div');
  title.append(el('span', 'word', v.word), el('span', 'meaning', v.meaning));
  const del = el('button', 'del danger', '삭제');
  del.type = 'button';
  del.setAttribute('aria-label', `${v.word} 삭제`);
  del.addEventListener('click', () => SAO.vocab.remove(v.id));
  head.append(title, del);
  li.append(head);

  if (v.context) {
    const ctx = el('p', 'context', v.context);
    if (v.lang) ctx.lang = v.lang;
    li.append(ctx);
  }
  if (v.contextTranslation) li.append(el('p', 'context muted', v.contextTranslation));

  if (v.videoId) {
    const sec = Math.floor(Number(v.time) || 0);
    const a = el('a', '', `${v.videoTitle || v.videoId} (${clock(sec)})`);
    a.href = `https://youtu.be/${encodeURIComponent(v.videoId)}?t=${sec}`;
    a.target = '_blank';
    a.rel = 'noopener';
    const src = el('p', 'source');
    src.append(a);
    li.append(src);
  }
  return li;
};

const render = async () => {
  const items = await SAO.vocab.list();
  $('list').replaceChildren(...items.map(card));
  $('count').textContent = items.length ? `${items.length}개` : '';
  $('empty').hidden = items.length > 0;
  $('export').hidden = $('copy').disabled = $('clear').disabled = items.length === 0;
  $('md').value = SAO.vocab.toMarkdown(items);
};

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('md').value);
    $('status').textContent = '복사했습니다. 노션에 붙여넣으면 표가 됩니다.';
  } catch {
    $('md').focus();
    $('md').select();
    $('status').textContent = '복사하지 못했습니다. 아래 텍스트를 직접 복사해 주세요.';
  }
});

$('clear').addEventListener('click', () => {
  if (confirm('단어장의 모든 단어를 삭제할까요? 되돌릴 수 없습니다.')) SAO.vocab.clear();
});

$('md').addEventListener('focus', (e) => e.target.select());

// 삭제/전체 삭제/다른 탭의 추가 모두 이 경로로 다시 그린다.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.vocab) {
    $('status').textContent = '';
    render();
  }
});
render();
