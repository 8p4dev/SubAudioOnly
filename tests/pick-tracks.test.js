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

const { mergeJa, selectionUnits, moveEdge } = require('../extension/content/pick-tracks.js');
const words = (segs) => segs.filter((s) => s.word).map((s) => s.text);

test('segmentWords: 단어 판정은 isWordLike가 아니라 글자/숫자 유무', () => {
  // Firefox는 東京·です 등을 isWordLike=false로 준다 → 글자가 있으면 단어로 본다
  const segs = segmentWords('[Music] 3:30, ♪ hello', 'en');
  assert.deepStrictEqual(words(segs), ['Music', '3', '30', 'hello']);
  assert.strictEqual(segs.map((s) => s.text).join(''), '[Music] 3:30, ♪ hello');
});

test('mergeJa: 어간 + 활용 어미를 한 단위로 (엔진별 원시 분절을 고정 입력으로)', () => {
  const run = (raw) => {
    const segs = raw.split('·').map((text) => ({ text, word: true }));
    const out = mergeJa(segs);
    assert.strictEqual(out.map((s) => s.text).join(''), raw.replaceAll('·', ''));
    return out.map((s) => s.text).join('|');
  };
  // Firefox 160의 분절
  assert.strictEqual(run('昨日·は·寿司·を·食·べ·まし·た'), '昨日|は|寿司|を|食べました');
  assert.strictEqual(run('食·べら·れな·か·った'), '食べられなかった');
  assert.strictEqual(run('3·人·で·行き·まし·ょ·う'), '3|人|で|行きましょう');
  assert.strictEqual(run('手紙·を·書·かな·か·った'), '手紙|を|書かなかった');
  assert.strictEqual(run('や·って·みよ·う'), 'やって|みよ|う');
  // node 24(ICU 78)의 분절
  assert.strictEqual(run('昨日·は·寿司·を·食·べ·ま·した'), '昨日|は|寿司|を|食べました');
  assert.strictEqual(run('行·って·き·ます'), '行ってきます');
  assert.strictEqual(run('日本語·を·勉強·し·てい·ます'), '日本語|を|勉強しています');
  assert.strictEqual(run('それ·は·知·ら·なか·っ·たん·だけど'), 'それ|は|知らなかったん|だけど');
  assert.strictEqual(run('東京·スカイ·ツリー·に·行き·たい·です'), '東京|スカイ|ツリー|に|行きたい|です');
  assert.strictEqual(run('この·映画·は·とても·面白·か·っ·た·です'), 'この|映画|は|とても|面白かった|です');
  // 조사와 같은 꼴의 어미(か/が/から)
  assert.strictEqual(run('分·か·り·ま·せん'), '分かりません');
  assert.strictEqual(run('全然·分·から·ない'), '全然|分からない');
  assert.strictEqual(run('道·が·曲·が·って·いる'), '道|が|曲がっている');
  assert.strictEqual(run('何·か·食·べた·い'), '何|か|食べたい');
  // 조사·계사·부사에서는 멈춘다
  assert.strictEqual(run('大丈夫·です·か'), '大丈夫|です|か');
  assert.strictEqual(run('私·ちょっと·疲れ·た'), '私|ちょっと|疲れた');
  assert.strictEqual(run('今日·また·会·いま·しょう'), '今日|また|会いましょう');
  assert.strictEqual(run('元気·な·子供·たち·が·公園·で·遊·んで·いる'), '元気|な|子供|たち|が|公園|で|遊んでいる');
  // 알려진 한계: 엔진이 'がい'로 자르면 명사와 붙는다(팝업의 범위 조절로 바로잡음)
  assert.strictEqual(run('走·って·いる·人·がい·ます'), '走っている|人がいます');
});

// 아래는 node의 ICU 분절에 의존한다(ICU가 바뀌어 깨지면 기대값을 다시 확인할 것).
test('segmentWords: 언어별 샘플 문장', () => {
  const w = (text, lang) => {
    const segs = segmentWords(text, lang);
    assert.strictEqual(segs.map((s) => s.text).join(''), text);
    return words(segs);
  };
  assert.deepStrictEqual(w('昨日は寿司を食べました', 'ja'), ['昨日', 'は', '寿司', 'を', '食べました']);
  assert.deepStrictEqual(w('日本語を勉強しています', 'ja-JP'), ['日本語', 'を', '勉強しています']);
  assert.deepStrictEqual(w('今日　は [音楽] いい天気', 'ja'), ['今日', 'は', '音楽', 'いい', '天気']);
  assert.deepStrictEqual(w('他们正在学习中文', 'zh-Hans'), ['他们', '正在', '学习', '中文']);
  assert.deepStrictEqual(w('我昨天吃了壽司', 'zh-Hant'), ['我', '昨天', '吃了', '壽司']);
  assert.deepStrictEqual(w('어제는 초밥을 먹었습니다', 'ko'), ['어제는', '초밥을', '먹었습니다']);
  assert.deepStrictEqual(w("I don't know, it's a well-known fact", 'en'), ['I', "don't", 'know', "it's", 'a', 'well', 'known', 'fact']);
  // 일본어 후처리는 일본어에만 적용
  assert.deepStrictEqual(w('行ってきます', 'zh-Hans'), ['行', 'って', 'き', 'ます']);
});

test('selectionUnits/moveEdge: 선택 범위 넓히기·줄이기', () => {
  const u = selectionUnits('Please pick up, the phone', 'en');
  assert.strictEqual(u.map((x) => x.text).join(''), 'Please pick up, the phone');
  const text = ([a, b]) => u.slice(a, b).map((x) => x.text).join('');
  const pick = u.findIndex((x) => x.text === 'pick');
  let r = moveEdge(u, pick, pick + 1, 'end', 1);
  assert.strictEqual(text(r), 'pick up');
  r = moveEdge(u, r[0], r[1], 'end', 1); // 문장부호·공백은 건너뛴다
  assert.strictEqual(text(r), 'pick up, the');
  r = moveEdge(u, r[0], r[1], 'start', -1);
  assert.strictEqual(text(r), 'Please pick up, the');
  r = moveEdge(u, r[0], r[1], 'start', 1);
  r = moveEdge(u, r[0], r[1], 'end', -1);
  assert.strictEqual(text(r), 'pick up');
  // 더 못 옮기는 경우
  assert.strictEqual(moveEdge(u, 0, 1, 'start', -1), null);
  assert.strictEqual(moveEdge(u, pick, pick + 1, 'start', 1), null);
  assert.strictEqual(moveEdge(u, pick, pick + 1, 'end', -1), null);
  assert.strictEqual(moveEdge(u, u.length - 1, u.length, 'end', 1), null);

  // 한자·가나는 글자 단위: 잘못 묶인 我想去에서 想만 고를 수 있다
  const zh = selectionUnits('我想去北京。', 'zh-Hans');
  assert.deepStrictEqual(zh.map((x) => x.text), ['我', '想', '去', '北', '京', '。']);
  r = moveEdge(zh, 0, 3, 'start', 1);
  r = moveEdge(zh, r[0], r[1], 'end', -1);
  assert.deepStrictEqual(r, [1, 2]);
  assert.strictEqual(moveEdge(zh, 3, 5, 'end', 1), null); // 마침표는 단어가 아니다
  // 넓힐 때는 세그먼트 단위: 想 -> 想去(잘린 세그먼트의 나머지) -> 想去北京
  assert.deepStrictEqual(moveEdge(zh, 1, 2, 'end', 1), [1, 3]);
  assert.deepStrictEqual(moveEdge(zh, 1, 3, 'end', 1), [1, 5]);
  assert.deepStrictEqual(moveEdge(zh, 3, 5, 'start', -1), [0, 5]);
  // 일본어: 조각을 탭했어도 한 번에 다음 단위까지
  const ja = selectionUnits('寿司を食べました', 'ja');
  assert.deepStrictEqual(moveEdge(ja, 2, 3, 'end', 1), [2, ja.length]); // を -> を食べました
});
