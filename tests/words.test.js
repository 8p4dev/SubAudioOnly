'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

require('../extension/content/pick-tracks.js'); // 전역 segmentWords, cueAt
const { extractWords } = require('../extension/content/wordlist.js');
const { parseBatch, translateBatch } = require('../extension/background/words.js');

const cue = (start, text) => ({ start, end: start + 2000, text });

test('extractWords: 중복 제거(대소문자 무시), 횟수, 처음 나온 문장과 시각', () => {
  const target = [cue(1000, 'The cat sat.'), cue(4000, 'the CAT ran, the dog sat')];
  const native = [cue(900, '고양이가 앉았다.'), cue(4000, '고양이는 뛰고 개는 앉았다')];
  const words = extractWords(target, native, 'en');
  assert.deepEqual(words.map((w) => [w.word, w.count]), [['The', 3], ['cat', 2], ['sat', 2], ['ran', 1], ['dog', 1]]);
  assert.deepEqual(words[0], {
    key: 'the', word: 'The', count: 3, context: 'The cat sat.', contextTranslation: '고양이가 앉았다.', time: 1,
  });
  assert.equal(words[3].context, 'the CAT ran, the dog sat');
  assert.equal(words[3].contextTranslation, '고양이는 뛰고 개는 앉았다');
  assert.equal(words[3].time, 4);
});

test('extractWords: 숫자만으로 된 토큰과 구두점은 제외', () => {
  const words = extractWords([cue(0, 'In 2024, 3 dogs — 1,000 bones!')], [], 'en');
  assert.deepEqual(words.map((w) => w.word), ['In', 'dogs', 'bones']);
});

test('extractWords: 자국어 큐가 없으면 문맥 번역은 빈 문자열, 빈 입력은 빈 배열', () => {
  assert.equal(extractWords([cue(0, 'hello')], undefined, 'en')[0].contextTranslation, '');
  assert.deepEqual(extractWords([], [], 'en'), []);
  assert.deepEqual(extractWords(null, null, 'en'), []);
});

test('parseBatch: 조각을 이어 붙여 줄 단위로 나눈다', () => {
  // 줄마다 조각이 오는 경우(en 등)
  assert.deepEqual(parseBatch([[['고양이\n', 'cat\n'], ['개 \n', 'dog\n'], ['새', 'bird']]], 3), ['고양이', '개', '새']);
  // 한 조각으로 합쳐져 오는 경우(zh, es 등)
  assert.deepEqual(parseBatch([[['의\n예\n아니요', '的\n是\n不']]], 3), ['의', '예', '아니요']);
});

test('parseBatch: 줄 수가 안 맞거나 형식이 다르면 null', () => {
  assert.equal(parseBatch([[['고양이 개', 'cat\ndog']]], 2), null);
  assert.equal(parseBatch(null, 1), null);
  assert.equal(parseBatch([null], 1), null);
  assert.equal(parseBatch({}, 1), null);
});

// fetch 스텁: 요청 본문의 q를 줄 단위로 받아 응답을 만든다
const stubFetch = (t, reply) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const lines = init.body.get('q').split('\n');
    calls.push({ url: String(url), lines });
    return reply(lines);
  });
  return calls;
};
const ok = (lines) => ({ ok: true, json: async () => [lines.map((l, i) => [l + (i < lines.length - 1 ? '\n' : '')])] });

test('translateBatch: 50개씩 묶어 보내고 입력 순서·길이를 유지하며 캐시한다', async (t) => {
  const calls = stubFetch(t, (lines) => ok(lines.map((l) => `<${l}>`)));
  const texts = Array.from({ length: 120 }, (_, i) => `w${i}`);
  const out = await translateBatch({ texts: [...texts, 'w0', ''], from: 'zh-Hans', to: 'ko' });
  assert.equal(out.length, 122);
  assert.equal(out[5], '<w5>');
  assert.equal(out[120], '<w0>');
  assert.equal(out[121], '');
  assert.deepEqual(calls.map((c) => c.lines.length), [50, 50, 20]);
  assert.match(calls[0].url, /sl=zh-CN&tl=ko/);
  await translateBatch({ texts, from: 'zh-Hans', to: 'ko' });
  assert.equal(calls.length, 3); // 전부 캐시
});

test('translateBatch: 줄 수가 안 맞으면 반으로 나눠 재시도, 그래도 안 맞으면 빈 문자열', async (t) => {
  const calls = stubFetch(t, (lines) => (lines.includes('bad') && lines.length > 1 ? ok(['합쳐짐']) : ok(lines.map((l) => `<${l}>`))));
  const out = await translateBatch({ texts: ['a1', 'b1', 'bad', 'c1'], from: 'en', to: 'ko' });
  assert.deepEqual(out, ['<a1>', '<b1>', '', '']);
  assert.equal(calls.length, 3);
});

test('translateBatch: HTTP 오류면 남은 묶음을 보내지 않고 빈 문자열', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const calls = stubFetch(t, () => ({ ok: false, status: 429 }));
  const texts = Array.from({ length: 60 }, (_, i) => `x${i}`);
  const out = await translateBatch({ texts, from: 'en', to: 'ko' });
  assert.deepEqual(out, texts.map(() => ''));
  assert.equal(calls.length, 1);
});
