'use strict';

const names = new Intl.DisplayNames(['ko'], { type: 'language' });
const $ = (id) => document.getElementById(id);
const TOGGLES = ['audioOnly', 'dualSubs', 'dictionary']; // 입력 요소 id == 설정 키

const render = (s) => {
  for (const k of TOGGLES) $(k).checked = s[k];
  $('pair').textContent = `${names.of(s.targetLang)} → ${names.of(s.nativeLang)}`;
};

for (const k of TOGGLES) {
  $(k).addEventListener('change', (e) => SAO.setSettings({ [k]: e.target.checked }));
}

$('openVocab').addEventListener('click', async () => {
  await browser.tabs.create({ url: browser.runtime.getURL('vocab/vocab.html') });
  window.close();
});
$('openOptions').addEventListener('click', async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

SAO.onSettingsChanged(render);
SAO.getSettings().then(render);
