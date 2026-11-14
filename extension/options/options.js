'use strict';

// YouTube 자막 / Google 번역에서 통하는 BCP-47 코드. 표시 이름은 Intl.DisplayNames가 만든다.
const LANGS = [
  'ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'vi', 'th', 'id',
  'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'da', 'fi', 'no', 'cs', 'el', 'hu', 'ro', 'uk', 'ms', 'bn',
];
const names = new Intl.DisplayNames(['ko'], { type: 'language' });
const $ = (id) => document.getElementById(id);
const KEYS = Object.keys(SAO.DEFAULTS); // 입력 요소 id == 설정 키

for (const id of ['nativeLang', 'targetLang']) {
  for (const code of LANGS) $(id).add(new Option(names.of(code), code));
}

const showScale = (v) => { $('scaleOut').textContent = `${Number(v).toFixed(1)}배`; };

const render = (s) => {
  for (const k of KEYS) {
    if ($(k).type === 'checkbox') $(k).checked = s[k];
    else $(k).value = s[k];
  }
  showScale(s.subtitleScale);
  $('sameLang').hidden = s.nativeLang !== s.targetLang;
};

const read = (el) =>
  el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;

// 저장만 한다. 화면 갱신은 onSettingsChanged 한 곳에서(다른 페이지에서 바꾼 값도 같은 경로).
for (const k of KEYS) {
  $(k).addEventListener('change', (e) => SAO.setSettings({ [k]: read(e.target) }));
}
$('subtitleScale').addEventListener('input', (e) => showScale(e.target.value));
$('reset').addEventListener('click', () => SAO.setSettings(SAO.DEFAULTS));

SAO.onSettingsChanged(render);
SAO.getSettings().then(render);
