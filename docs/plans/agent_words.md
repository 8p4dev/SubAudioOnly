# words 에이전트 plan — 영상 단어 목록 패널 (W2, W3)

## 접근 방식

- **단어 추출**: `content/wordlist.js` 상단의 순수 함수 `extractWords(target, native, lang)`.
  전역 `segmentWords`/`cueAt`(pick-tracks.js)만 사용. 키는 `toLowerCase()`(CJK에는 영향 없음), 표시는 처음 나온 형태,
  숫자만으로 된 토큰 제외. 문맥 번역은 target 큐 중간 시각의 native 큐.
- **패널**: `#sao-words`를 `document.fullscreenElement || document.body`에 붙이는 `position: fixed` 패널.
  세로는 플레이어 하단(`getBoundingClientRect().bottom`)을 CSS 변수 `--sao-words-top`으로 넘겨 그 아래를 덮고,
  가로는 미디어 쿼리로 오른쪽 45%. 루트 `all: initial`.
- **성능/요청 제한**: 처음 100행만 그리고 "더 보기"로 100행씩 추가. 번역은 그려진 행만, 50개씩 순차 요청.
  - 대안: 전부 그리고 `content-visibility: auto` + IntersectionObserver로 보이는 행만 번역 → 코드가 더 많고
    빠르게 스크롤하면 요청이 몰린다. 페이지 방식이 DOM과 요청 수를 한 번에 제한하므로 채택.
- **스위치 연결**: toggle.js에 네 번째 버튼("≡ 단어", 켜짐/꺼짐 표시 없는 테두리 칩). 클릭 시 스위치를 접고
  `document`에 `sao:words-toggle` 이벤트. wordlist.js가 받아 열고 닫는다(로드 순서 무관).
- **이벤트 가로채기**: `document` 캡처에서 `#sao-words` 안의 click은 `preventDefault + stopPropagation`,
  pointer/touch/wheel 류는 `stopPropagation`만(스크롤 유지). dict.js가 먼저 처리한 클릭(`defaultPrevented`)은
  패널 버튼 동작을 하지 않는다(사전 팝업이 열려 있을 때 팝업 밖 탭은 팝업만 닫는 기존 동작 유지).
- **행 전체 탭**: `.sao-word` span의 `::after`를 행 전체로 늘려 행 어디를 탭해도 target이 span이 되게 한다.
- **일괄 번역**: `background/words.js`. 50개씩 줄바꿈으로 묶어 POST, 순차 처리, `Map` 캐시(성공한 것만).
  줄 수가 안 맞으면 반으로 나눠 한 번만 재시도, 그래도 안 맞으면 `''`. HTTP/네트워크 오류면 남은 묶음은 보내지 않고 `''`.

## 일괄 번역 엔드포인트 검증 (2026-11-16, node fetch로 실제 호출)

`translate_a/single?client=gtx&dt=t`에 단어를 `\n`으로 묶어 보내고 `[0][i][0]`을 이어 붙여 `\n`으로 나눔.

| 입력 | 결과 |
|---|---|
| en→ko 10/25/55/100/200/300단어 (GET) | 전부 줄 수 일치. URL 길이 143~2555 |
| ja→ko 10/25/41/100/200/300단어 (GET) | 전부 일치. URL 길이 289~7144(퍼센트 인코딩으로 단어당 ~24자) |
| zh-CN→ko 10/25/40/100/200/300단어 (GET) | 전부 일치. URL 길이 247~5626 |
| 같은 100/200/300단어를 POST(`application/x-www-form-urlencoded`, 본문 `q=`) | HTTP 200, 전부 일치 → POST 동작함 |
| en 1000단어 POST 1회 | 일치(1000줄) |
| 문장처럼 이어지는 영어 23단어("I do not know what ...") | 일치 — 문장으로 합쳐지지 않고 줄별 번역 |
| 일본어 조사/어미 17개(は が を … っ ー), 가나 조각 13개 | 일치 |
| 중국어 한 글자 13개(的 了 吗 …), zh-TW 5개, es 9개 | 일치. 단 응답 조각이 1개로 합쳐져 옴 → 조각 수가 아니라 이어 붙인 뒤 줄 수로 판단해야 함 |
| 구두점/공백 포함(U.S., Mr., e.g., New York, can't, COVID-19, 😀) | 일치 |
| ko→en, en→ja | 일치 |

- 줄 수 불일치는 한 번도 재현되지 않았다. 그래도 방어 코드(반으로 나눠 1회 재시도 → `''`)는 둔다.
- 묶음 크기: **50단어, 항상 POST**(GET은 일본어 300단어에서 URL 7KB까지 통과했지만 한도를 알 수 없으므로 POST로 통일).
  패널이 100행씩 그리므로 한 페이지당 요청 2회.
- 한계: 문맥 없는 단어 번역이라 품질은 거칠다(예: "are"→"이다", "about"→"약"). 정확한 뜻은 행을 탭해 사전 팝업으로.
- 차단(429) 조건은 확인하지 못했다(짧은 시간에 30여 회 호출까지는 정상).

## 수정/생성 파일

- `extension/content/wordlist.js` (구현)
- `extension/content/wordlist.css` (구현)
- `extension/content/toggle.js`, `extension/content/toggle.css` (네 번째 버튼)
- `extension/background/words.js` (일괄 번역 핸들러)
- `tests/words.test.js` (신규)
- `docs/plans/agent_words.md` (본 문서)

소유 범위 밖 파일 수정 없음.

## 단계별 작업

- [x] 1. 엔드포인트 실제 호출 검증, 결과 기록(위 표)
- [x] 2. `background/words.js`: `parseBatch`(순수) + `translateBatch` 핸들러
- [x] 3. `content/wordlist.js`: `extractWords`(순수)
- [x] 4. `tests/words.test.js`: extractWords, parseBatch, translateBatch(fetch 스텁) 테스트
- [x] 5. `content/wordlist.js` 패널 UI + `wordlist.css`
- [x] 6. `toggle.js`/`toggle.css` 네 번째 버튼
- [x] 7. 헤드리스 Chrome 하네스로 세로/가로 스크린샷 확인
- [x] 8. `npm test`, `npm run lint`, 커밋

## 변경 사항 (계획과 달라진 점)

- **패널 내부 리셋을 `all: unset`으로**: 처음에는 dict.css처럼 `font/color: inherit`만 지정했는데, 하네스에 넣은
  전역 `span{letter-spacing;text-transform}`/`div{text-indent}` 규칙이 그대로 새어 들어왔다. `#sao-words * { all: unset }`
  후 요소마다 display를 지정하는 방식으로 바꿨다.
- **가로 화면에서 자막 비키기**: 패널이 오른쪽 45%를 덮으면 중앙 정렬된 자막의 오른쪽이 가려진다. 패널이 열린 동안
  `<html>`에 `sao-words-open` 클래스를 달고, wordlist.css에서 가로일 때만 `#sao-overlay`의 `right`를 패널 폭만큼
  주었다. subtitles.css(소유 밖)는 수정하지 않았지만 다른 에이전트 요소에 대한 규칙이므로 리뷰 대상으로 보고한다.
- **안내 문구 분기**: 자막 설정(`dualSubs`)이 꺼져 있으면 `SAO.subs`가 항상 null이므로 "자막이 꺼져 있습니다"로 구분.
- **스위치 칩 좌우 여백 12px → 10px**: 버튼이 하나 늘어난 만큼 폭을 줄였다(펼친 스위치 전체 폭 266px).

## 검증 결과

- `npm test` 24개 통과(신규 8개), `npm run lint` 오류 0(기존 경고 2건).
- node에서 실제 핸들러로 호출: ja 15단어·zh-Hans 15단어·en 120단어(3묶음, 약 1.8초) 모두 채워짐, 재호출은 캐시(0ms).
- `extractWords` 3000큐 → 고유 3711단어 60ms(node).
- 헤드리스 Chrome 하네스(전역 button/span/div 규칙을 넣은 가짜 YouTube 페이지, `browser`·`SAO.subs` 스텁):
  - 세로 390×844(iframe): 패널 top = 플레이어 하단, 가로 넘침 없음, 버튼·행 최소 높이 44px, 스위치는 한 줄(266px).
  - 세로 320×640(iframe): 넘침 없음, 스위치 한 줄.
  - 가로 844×390: 패널이 오른쪽 45%, 자막은 왼쪽으로 좁혀짐.
  - 동작: 열기(스위치 접힘)/닫기, 정렬 전환, 더 보기(100→200행), 자막 교체 시 다시 그림, 다른 영상으로 이동 시 닫힘,
    단어 탭 → 사전 팝업, 팝업이 열린 상태에서 패널의 닫기 탭 → 팝업만 닫히고 패널 유지, 사전 꺼짐 안내,
    자막 없음 안내, 패널 안 클릭이 body까지 버블링되지 않음, 행 오른쪽 끝의 hit target이 `.sao-word`.
  - 고유 9026단어 자막에서도 100행만 그려지고 번역 요청은 2회.
- **미검증**: 실제 Firefox Android/m.youtube.com(터치 스크롤과 탭 가로채기, 플레이어 하단 위치 계산, 전체화면 재부착,
  safe-area), dict.js가 `data-sao-*` 속성을 읽는 부분(select 에이전트 구현 — 이 워크트리의 dict.js는 아직 읽지 않음),
  엔드포인트 차단 조건.

## 검증 방법

- 2~4: `npm test` (node --test)
- 5~6: 헤드리스 Chrome 하네스(워크트리 밖, `browser`/`SAO.subs` 스텁) 스크린샷 — 세로 390×844(iframe), 가로 844×390
- 8: `npm test`, `npm run lint` 오류 0
- 미검증으로 남는 것: 실제 Firefox Android/YouTube에서의 동작(탭 가로채기, 전체화면, 플레이어 위치 계산)
