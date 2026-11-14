'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickTracks, parseJson3, cueAt, segmentWords, timedtextUrl } = require('../extension/content/pick-tracks.js');

const tr = (languageCode, kind) => ({ baseUrl: `https://www.youtube.com/api/timedtext?v=x&lang=${languageCode}`, languageCode, kind });

test('pickTracks: 두 언어 수동 자막 모두 있음 -> 번역 없음', () => {
  const en = tr('en'), ko = tr('ko');
  assert.deepStrictEqual(pickTracks([tr('ja'), ko, en], 'ko', 'en'), {
    target: { track: en, tlang: null },
    native: { track: ko, tlang: null },
  });
});

test('pickTracks: 학습 언어만 -> 자국어는 tlang', () => {
  const en = tr('en');
  assert.deepStrictEqual(pickTracks([en], 'ko', 'en'), {
    target: { track: en, tlang: null },
    native: { track: en, tlang: 'ko' },
  });
});

test('pickTracks: 자국어만 -> 학습 언어는 tlang', () => {
  const ko = tr('ko');
  assert.deepStrictEqual(pickTracks([ko], 'ko', 'en'), {
    target: { track: ko, tlang: 'en' },
    native: { track: ko, tlang: null },
  });
});

test('pickTracks: 제3언어만 -> 양쪽 tlang, 원본은 수동 우선', () => {
  const jaAsr = tr('ja', 'asr'), fr = tr('fr');
  assert.deepStrictEqual(pickTracks([jaAsr, fr], 'ko', 'en'), {
    target: { track: fr, tlang: 'en' },
    native: { track: fr, tlang: 'ko' },
  });
  assert.strictEqual(pickTracks([jaAsr], 'ko', 'en').target.track, jaAsr);
});

test('pickTracks: 수동 > asr, 지역 코드 매치, 중국어 간/번체, 빈 목록', () => {
  const enAsr = tr('en', 'asr'), enUS = tr('en-US');
  assert.strictEqual(pickTracks([enAsr, enUS], 'ko', 'en').target.track, enUS);
  assert.strictEqual(pickTracks([enAsr], 'ko', 'en').target.track, enAsr); // asr뿐이면 asr 그대로
  assert.strictEqual(pickTracks([enAsr], 'ko', 'en').target.tlang, null);

  const tw = tr('zh-TW'), cn = tr('zh-CN');
  assert.strictEqual(pickTracks([tw, cn], 'ko', 'zh-Hans').target.track, cn);
  assert.strictEqual(pickTracks([tw, cn], 'ko', 'zh-Hant').target.track, tw);
  assert.deepStrictEqual(pickTracks([tw], 'ko', 'zh-Hans').target, { track: tw, tlang: 'zh-Hans' });

  assert.strictEqual(pickTracks([], 'ko', 'en'), null);
  assert.strictEqual(pickTracks(undefined, 'ko', 'en'), null);
});

test('parseJson3 + cueAt: asr 롤업 겹침을 줄 단위로 자르고 시각으로 찾는다', () => {
  const cues = parseJson3({
    events: [
      { tStartMs: 0, dDurationMs: 9000, id: 1 }, // 창 정의(세그 없음)
      { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: 'hello' }, { utf8: ' world', tOffsetMs: 500 }] },
      { tStartMs: 2990, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] },
      { tStartMs: 3000, dDurationMs: 4000, segs: [{ utf8: 'second\nline' }] },
    ],
  });
  assert.deepStrictEqual(cues, [
    { start: 1000, end: 3000, text: 'hello world' },
    { start: 3000, end: 7000, text: 'second line' },
  ]);
  assert.strictEqual(cueAt(cues, 999), '');
  assert.strictEqual(cueAt(cues, 1000), 'hello world');
  assert.strictEqual(cueAt(cues, 2999), 'hello world');
  assert.strictEqual(cueAt(cues, 3000), 'second line');
  assert.strictEqual(cueAt(cues, 7000), '');
  assert.strictEqual(cueAt([], 5), '');
  assert.deepStrictEqual(parseJson3(null), []);
});

test('segmentWords: 단어만 word=true, 이어 붙이면 원문', () => {
  const segs = segmentWords("Hello, world! It's", 'en');
  assert.deepStrictEqual(segs.filter((s) => s.word).map((s) => s.text), ['Hello', 'world', "It's"]);
  assert.strictEqual(segs.map((s) => s.text).join(''), "Hello, world! It's");
  assert.ok(segmentWords('x', 'not a lang tag').length);
});

test('timedtextUrl: fmt/tlang 설정, pot 파라미터 병합(baseUrl 값 우선), 외부 호스트 거부', () => {
  const base = 'https://www.youtube.com/api/timedtext?v=x&lang=en&signature=S&fmt=srv3';
  const u = new URL(timedtextUrl(base, 'ko', 'https://www.youtube.com/api/timedtext?v=x&lang=ja&tlang=fr&pot=P&c=WEB&fmt=json3'));
  const p = Object.fromEntries(u.searchParams);
  assert.deepStrictEqual(p, { v: 'x', lang: 'en', signature: 'S', fmt: 'json3', tlang: 'ko', pot: 'P', c: 'WEB' });
  assert.strictEqual(new URL(timedtextUrl(base + '&tlang=fr', null)).searchParams.has('tlang'), false);
  assert.ok(timedtextUrl('/api/timedtext?v=x', null, undefined, 'https://m.youtube.com').startsWith('https://m.youtube.com/api/timedtext?'));
  assert.strictEqual(timedtextUrl('https://evil.example/api/timedtext?v=x', null), null);
  assert.strictEqual(timedtextUrl('https://notyoutube.com/api/timedtext?v=x', null), null);
  assert.strictEqual(timedtextUrl('https://www.youtube.com/other?v=x', null), null);
});
