# agent_subs plan — R2 이중 자막, R3 자막 소스 선택/번역

## 접근 방식

- **트랙 목록**: content script가 `#movie_player.wrappedJSObject.getPlayerResponse()`(폴백: `window.wrappedJSObject.ytInitialPlayerResponse`)에서 `captionTracks`를 읽는다. `videoDetails.videoId`가 현재 URL의 `v`와 일치할 때만 사용(SPA stale 방지), `JSON.parse(JSON.stringify())`로 복사 후 형식 검증. 준비 전이면 0.5초 간격으로 최대 10초 재시도.
- **트랙 선택(R3)**: 순수 함수 `pickTracks()` — 언어 키(기본 코드, 중국어는 간체/번체 구분) 매칭, 수동 > asr, 없는 쪽은 `tlang`.
- **자막 본문**: `baseUrl + fmt=json3 (+ tlang)`를 content script에서 `credentials:'include'`로 fetch.
- **PO 토큰 폴백**: 조사 결과(2025 중반 이후) web 클라이언트의 timedtext는 `pot`(영상 ID에 바인딩) + `c=WEB` 없이는 200/빈 본문을 돌려주며 쿠키만으로는 해결되지 않는다. 그래서 빈 응답이면
  1. content가 플레이어 자막을 프로그램적으로 켜서(`loadModule('captions')`, `setOption('captions','track',…)`, `toggleSubtitlesOn()`) 플레이어가 직접 timedtext 요청을 보내게 하고,
  2. background(`captions.js`)가 `webRequest.onBeforeRequest`로 `pot`이 든 `/api/timedtext` URL을 videoId별로 기록, `SAO.MSG.CAPTIONS {videoId}` 요청에 (최대 3초 대기 후) 돌려주고,
  3. content가 그 URL의 파라미터 중 baseUrl에 없는 것(`pot`, `c`, `cver` …)을 baseUrl에 합쳐 재요청한다(`lang`/`kind`/`name`/서명은 baseUrl 것 유지).
- **표시(R2)**: `document`에 capture 단계 `timeupdate`/`seeking`/`seeked` 리스너(`<video>`가 교체돼도 동작, video는 읽기만). 큐는 이진 탐색. 텍스트가 바뀔 때만 DOM 갱신. 학습 언어 줄은 `Intl.Segmenter`로 `.sao-word` span 분리, 전부 `createTextNode`/`textContent`.
- **기본 자막 숨김**: 큐를 실제로 확보했을 때만 `html.sao-overlay-on` 클래스를 붙여 CSS로 숨긴다(우리 fetch가 실패하면 기본 자막은 그대로 보임).
- **SPA 이동**: `state-navigateend`/`yt-navigate-finish` + 매 tick마다 `videoId|native|target` 키 비교(멱등 `load()`).

검토한 대안
- `performance.getEntriesByType('resource')`로 플레이어의 timedtext URL 읽기: background 불필요하지만 리소스 타이밍 버퍼(기본 250)가 googlevideo 요청으로 차면 누락됨 → webRequest가 더 견고.
- PO 토큰 직접 생성(BotGuard): 의존성/복잡도 과다, 기각.
- InnerTube transcript 패널 API: `tlang` 번역 불가, 기각.
- 페이지의 XHR/fetch 후킹: 페이지 컨텍스트 주입 필요, webRequest가 더 단순.

## 수정/생성 파일

- `extension/content/pick-tracks.js` — 순수 로직: `pickTracks`, `parseJson3`, `cueAt`, `segmentWords`, `timedtextUrl`
- `extension/content/subtitles.js` — 오버레이, 트랙 로드, 렌더
- `extension/content/subtitles.css`
- `extension/background/captions.js` — timedtext URL 관찰 + `SAO.MSG.CAPTIONS` 핸들러
- `tests/pick-tracks.test.js`
- `docs/plans/agent_subs.md`

소유 범위 밖 파일 수정 불필요(manifest 권한/등록 이미 충분).

## 단계

- [x] 1. `pick-tracks.js` 순수 함수 + `tests/pick-tracks.test.js` → `npm test`
- [x] 2. `background/captions.js` → `node --check`(npm test에 포함)
- [x] 3. `content/subtitles.js` + `subtitles.css` → `npm test`, `npm run lint`
- [x] 4. 최종 `npm test` + `npm run lint` 통과, 커밋

## 검증 방법

- 순수 로직(트랙 선택, json3 파싱/asr 겹침 처리, 큐 탐색, 단어 분리, URL 합성): node:test.
- 문법/매니페스트: `npm test`, `npm run lint`(오류 0).
- 실제 YouTube E2E(플레이어 API 넛지, pot 재사용, 모바일 DOM 위치): 이 환경에서 실행 불가 → 최종 보고에 미검증으로 명시.
