'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { parseLookup } = require('../extension/background/dict.js');

test('parseLookup: 사전 항목이 있는 응답', () => {
  // 실제 응답(run, en->ko)을 줄인 것
  const data = [
    [['달리다', 'run', null, null, 10]],
    [
      ['noun', ['달리기', '연속'], [['달리기', ['run'], null, 0.003]], 'run', 1],
      ['verb', ['달리다', '운영하다', null, ''], [], 'run', 2],
    ],
    'en',
  ];
  assert.deepStrictEqual(parseLookup('run', data), {
    word: 'run',
    translation: '달리다',
    entries: [
      { pos: 'noun', terms: ['달리기', '연속'] },
      { pos: 'verb', terms: ['달리다', '운영하다'] },
    ],
  });
});

test('parseLookup: 사전 항목이 없는 응답([1]이 null)', () => {
  const data = [[['먹다', '食べる', null, null, 3]], null, 'ja'];
  assert.deepStrictEqual(parseLookup('食べる', data), { word: '食べる', translation: '먹다', entries: [] });
});

test('parseLookup: 깨진 응답', () => {
  assert.throws(() => parseLookup('x', null));
  assert.throws(() => parseLookup('x', { error: 'nope' }));
  assert.throws(() => parseLookup('x', []));
  assert.throws(() => parseLookup('x', [null, null]));
  // 일부만 깨진 경우: 쓸 수 있는 것만 남긴다
  assert.deepStrictEqual(
    parseLookup('x', [[null, ['가'], 'bad', [1]], ['bad', [1, 'bad'], ['noun', [null, 2]], [null, ['나']]]]),
    { word: 'x', translation: '가', entries: [{ pos: '', terms: ['나'] }] },
  );
});
