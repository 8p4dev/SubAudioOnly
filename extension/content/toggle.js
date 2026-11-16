// 플레이어 좌상단의 빠른 스위치: 작은 버튼을 탭하면 기능 3개를 켜고 끄는 칩이 펼쳐진다.
'use strict';

(() => {
  const ITEMS = [['audioOnly', '소리만'], ['dualSubs', '자막'], ['dictionary', '사전']];
  let settings = SAO.DEFAULTS;
  let timer;

  const button = (cls, text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    return b;
  };

  const root = document.createElement('div');
  root.id = 'sao-toggle';
  const main = button('sao-toggle-main', '♪');
  main.setAttribute('aria-label', 'SubAudioOnly 빠른 설정');
  const panel = document.createElement('div');
  panel.className = 'sao-toggle-panel';
  const chips = ITEMS.map(([key, label]) => {
    const b = button('sao-toggle-chip', label);
    b.dataset.key = key;
    return b;
  });
  panel.append(...chips);
  root.append(main, panel);

  const paint = () => {
    for (const b of chips) b.setAttribute('aria-pressed', String(!!settings[b.dataset.key]));
    main.classList.toggle('sao-toggle-off', !ITEMS.some(([key]) => settings[key]));
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    main.setAttribute('aria-expanded', String(open));
    clearTimeout(timer);
    if (open) timer = setTimeout(() => setOpen(false), 5000); // 건드리지 않으면 스스로 접힌다
  };

  // 자막 오버레이와 같은 컨테이너에 붙인다(모바일 컨트롤 오버레이 위에서 탭이 닿는 위치).
  const mount = () => {
    if (location.pathname !== '/watch') return root.remove();
    const m = document.getElementById('player-container-id') || document.getElementById('movie_player');
    if (m && root.parentNode !== m) m.append(root);
  };

  const hit = (e) => (e.target instanceof Element ? e.target.closest('#sao-toggle button') : null);

  // 캡처 단계에서 가로채 플레이어의 탭 동작(재생 토글, 컨트롤 표시)을 막는다.
  document.addEventListener('click', (e) => {
    const b = hit(e);
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    if (b === main) return setOpen(panel.hidden);
    SAO.setSettings({ [b.dataset.key]: !settings[b.dataset.key] });
    setOpen(true);
  }, true);
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
    document.addEventListener(type, (e) => { if (hit(e)) e.stopPropagation(); }, true);
  }

  const apply = (s) => { settings = s; paint(); };
  setOpen(false);
  paint();
  SAO.getSettings().then(apply);
  SAO.onSettingsChanged(apply);
  document.addEventListener('timeupdate', mount, true);
  document.addEventListener('loadstart', mount, true);
  for (const ev of ['state-navigateend', 'yt-navigate-finish']) window.addEventListener(ev, mount);
})();
