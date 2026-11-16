# 오케스트레이션 plan — 단어 선택 개선 + 영상 단어 목록

작성일: 2026-11-16 · 구현 에이전트 2개(병렬, 워크트리 격리) + 리뷰 에이전트 1개(머지 후)

## 1. 요구사항 구체화와 완료 기준

| # | 요구사항 | 구체화 | 완료 기준 |
|---|---|---|---|
| W1 | 일본어 등에서 단어 선택이 잘 안 되는 문제 조사·해결 | 원인을 실제로 재현해 분류(분절 품질 / 탭 대상 크기 / 사전 응답 빈약)하고 각각 해결 | 조사 결과가 근거(재현 입력과 출력)와 함께 plan에 기록됨. 일본어·중국어·한국어·영어 샘플 문장에 대한 분절 결과가 node 테스트로 고정됨. 잘못 잘린 단어를 사용자가 팝업에서 바로잡을 수 있음(선택 범위 넓히기/줄이기). 사전 항목이 없을 때도 번역(+가능하면 읽는 법)이 표시됨 |
| W2 | 영상에 나오는 단어를 한 번에 보기 | 현재 영상의 학습 언어 자막 전체에서 단어를 뽑아 목록 패널로 표시. 단어별 뜻(일괄 번역), 탭하면 사전 팝업, 단어장 추가 가능 | 플레이어의 빠른 스위치에서 패널을 열고 닫음. 목록에 단어·뜻·등장 횟수가 보이고, 이미 단어장에 있는 단어가 표시됨. 단어를 탭하면 기존 사전 팝업이 그 단어가 처음 나온 문장을 문맥으로 열림. 자막이 없으면 안내 문구 |
| W3 | 레이아웃 고려 | 새 UI가 YouTube 화면과 기존 UI(자막, 사전, 스위치)를 가리거나 밀어내지 않게 배치 | 세로(390×844)·가로(844×390)에서 패널·팝업이 화면 밖으로 나가지 않고, 플레이어와 자막을 가리지 않음(세로: 플레이어 아래 영역, 가로: 한쪽 옆). 터치 대상 44px 이상. 스크린샷으로 확인 |

## 2. 가정 및 미결 사항

- 형태소 분석기(kuromoji 등, 사전 수십 MB)는 넣지 않는다. `Intl.Segmenter` + 가벼운 후처리 + 사용자가 범위를 조절하는 UI로 해결한다.
- 단어 목록의 뜻은 Google 번역 무료 엔드포인트로 일괄 번역한다(영상당 수 회 요청, 결과 캐시). 막히면 뜻 없이 단어만 표시.
- 단어 목록 정렬은 등장 순서 기본. 그 외 정렬·필터는 필요가 확인되면 추가.
- 실기기(Firefox Android) 검증은 사용자 몫. 에이전트는 node 테스트와 헤드리스 Chrome 하네스로 확인.

## 3. 작업 분할표

선행 공통 작업(오케스트레이터 커밋): `manifest.json`(새 파일 등록), `shared/contract.js`(메시지 타입, `reading` 필드), `content/subtitles.js`의 `SAO.subs` 공개, 스텁 파일, 본 문서.

| 에이전트 | 담당 | 수정 소유 파일 | 읽기만 | 선행 |
|---|---|---|---|---|
| select | W1, W3(사전 팝업·자막) | `content/pick-tracks.js`, `content/subtitles.js`, `content/subtitles.css`, `content/dict.js`, `content/dict.css`, `background/dict.js`, `tests/pick-tracks.test.js`, `tests/dict.test.js`, `docs/plans/agent_select.md` | 그 외 | 선행 커밋 |
| words | W2, W3(단어 목록·스위치) | `content/wordlist.js`, `content/wordlist.css`, `content/toggle.js`, `content/toggle.css`, `background/words.js`, `tests/words.test.js`, `docs/plans/agent_words.md` | 그 외 | 선행 커밋 |
| review (2차) | 머지된 결과 검토 | 없음(읽기 전용, 보고만) | 전체 | 머지 후 |

## 4. 공유 계약

- **자막 데이터**: `SAO.subs` = `null | {videoId, lang, target:Cue[], native:Cue[]}`, `Cue = {start, end, text}`(ms). 바뀔 때마다 `document`에 `sao:cues` 이벤트. (subtitles.js가 제공 — select는 이 동작을 유지해야 한다.)
- **분절**: 전역 `segmentWords(text, lang)` → `[{text, word:boolean}]`. 이어 붙이면 원문과 같아야 한다. select가 품질을 개선하되 이 형태는 유지. words는 이 함수만 사용.
- **사전 팝업 열기**: 문서 어디서든 `.sao-word` 요소를 탭하면 dict.js가 처리한다. 자막 오버레이 밖의 `.sao-word`는 자신 또는 조상에 다음 속성으로 문맥을 준다: `data-sao-context`(문장), `data-sao-context-translation`(문장 번역, 선택), `data-sao-time`(초, 선택). 속성이 있으면 dict.js는 오버레이 대신 이 값을 쓴다. (select가 읽기 구현, words가 설정.)
- **일괄 번역**: `SAO.send(SAO.MSG.TRANSLATE_BATCH, {texts, from, to})` → `string[]`(같은 길이, 실패 항목은 `''`). words가 `background/words.js`에 구현.
- **조회 결과**: `LookupResult.reading`(선택, 읽는 법/로마자). select가 구현.
- **DOM/z-index**: 자막 `#sao-overlay` 2147483000 < 스위치 `#sao-toggle` 2147483100 < 단어 목록 `#sao-words` 2147483300 < 사전 `#sao-dict` 2147483600. 클래스 접두사는 `sao-words-`, `sao-toggle-`, `sao-dict-`.
- **전체화면**: 패널/팝업은 `document.fullscreenElement || document.body`에 붙인다.
- 사전 팝업이 열려 있을 때 팝업 밖 탭은 dict.js가 삼키고 팝업만 닫는다(기존 동작 유지).

## 5. 머지와 검증

1. 머지 순서: select → words (파일 배타).
2. `npm test`, `npm run lint`, `npm run build`.
3. 리뷰 에이전트: 머지된 diff를 독립적으로 검토(정확성, 계약 위반, 레이아웃 스크린샷, XSS). 발견 사항은 오케스트레이터가 확인 후 수정.
4. 결과를 아래에 기록.

## 6. 결과 기록

(완료 후 작성)
