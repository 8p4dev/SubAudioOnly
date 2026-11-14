'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickAudio } = require('../extension/content/audio.js');

const f = (o) => ({ mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 100, ...o });

test('pickAudio: 직접 URL이 있는 오디오 중 최고 비트레이트', () => {
  const sd = { adaptiveFormats: [
    f({ url: 'v', mimeType: 'video/mp4', bitrate: 9999 }),
    f({ url: 'lo', bitrate: 50 }),
    f({ url: 'hi', bitrate: 130 }),
    f({ signatureCipher: 's=..', bitrate: 500 }), // url 없음 → 제외
  ] };
  assert.strictEqual(pickAudio(sd), 'hi');
});

test('pickAudio: 재생 불가 코덱 제외, 기본 오디오 트랙 우선', () => {
  const sd = { adaptiveFormats: [
    f({ url: 'opus', mimeType: 'audio/webm; codecs="opus"', bitrate: 160 }),
    f({ url: 'dub', bitrate: 130, audioTrack: { audioIsDefault: false } }),
    f({ url: 'orig', bitrate: 120, audioTrack: { audioIsDefault: true } }),
  ] };
  assert.strictEqual(pickAudio(sd, (t) => !t.includes('webm')), 'orig');
});

test('pickAudio: 후보가 없으면 null', () => {
  assert.strictEqual(pickAudio(undefined), null);
  assert.strictEqual(pickAudio({ adaptiveFormats: [f({ url: 'v', mimeType: 'video/mp4' })] }), null);
});
