# 오케스트레이션 plan — SubAudioOnly (Firefox 익스텐션)

작성일: 2026-11-14 · 오케스트레이터: 메인 세션 · 하위 에이전트: 워크트리 격리, 최대 4개

## 1. 요구사항 구체화와 완료 기준

| # | 요구사항 | 구체화 | 완료 기준(검증 가능) |
|---|---|---|---|
| R1 | 오디오 전용 재생 (기본 ON) | m.youtube.com에서 영상 스트림 바이트를 받지 않거나(1순위) 최소 화질로 강제(폴백)하고, 플레이어 영역은 검은 화면 + 자막만 표시 | `audioOnly=true`일 때 영상 픽셀이 보이지 않고 소리가 재생됨. 네트워크 탭에서 video mime 요청이 없거나(1순위) 144p만 요청됨(폴백). 토글 OFF 시 새로고침 없이 또는 새로고침 1회로 원래 재생으로 복귀. SPA 영상 이동 후에도 유지 |
| R2 | 이중 자막 (기본 ON) | 학습 언어 자막(위) + 자국어 자막(아래)을 자체 오버레이로 표시. YouTube 기본 자막 창은 숨김 | `dualSubs=true`일 때 현재 재생 시각에 맞는 두 줄이 표시되고 seek/영상 이동에 따라 갱신됨. 자막 트랙이 전혀 없으면 조용히 아무것도 표시하지 않음 |
| R3 | 자막 소스 선택/번역 | 두 언어 수동 자막이 다 있으면 그대로 사용. 한쪽만 있거나 다른 언어만 있으면 **YouTube 자동번역(`tlang`)** 으로 없는 쪽 생성(사용자 선택) | `pickTracks()` 순수 함수가 node 테스트로 4가지 경우(둘 다/학습어만/자국어만/제3언어만)를 통과. 실제 영상에서 번역 줄이 표시됨 |
| R4 | 단어 클릭 사전 (기본 ON) | 학습 언어 자막의 단어를 탭하면 자국어 뜻 팝업. 소스: Google 번역 무료 엔드포인트의 사전 응답(`dt=bd`) (사용자 선택) | 단어 탭 → 2초 내 팝업에 번역 + 품사별 뜻 표시. 실패 시 팝업에 오류 문구. `dictionary=false`면 무반응 |
| R5 | 단어장 추가 | 사전 팝업의 "단어장에 추가" 버튼 → 단어/뜻/문장/문장 번역/영상/시각 저장 | 추가 후 `SAO.vocab.list()`에 항목 존재, 같은 단어 재추가 시 중복 없음, 버튼이 "추가됨" 상태로 바뀜 |
| R6 | 단어장 텍스트 출력 | 단어장 페이지에서 마크다운 표로 복사(노션 붙여넣기 시 표로 변환됨) | "복사" 버튼 → 클립보드에 `SAO.vocab.toMarkdown()` 결과. 텍스트 영역에도 표시되어 수동 복사 가능. 개별 삭제/전체 삭제 가능 |
| R7 | 설정 | 자국어, 학습 언어, 오디오 전용/이중 자막/사전 토글, 자막 크기 | 옵션 페이지에서 변경 → `storage.local.settings`에 저장 → 열려 있는 YouTube 탭에 즉시 반영(`onSettingsChanged`). 팝업에서 3개 토글 빠른 전환 |

## 2. 가정 및 미결 사항

가정
- 기본값: 자국어 `ko`, 학습 언어 `en`.
- Manifest V2 (Firefox는 MV2 지원 유지, blocking webRequest와 호스트 권한이 단순함). Firefox for Android 125+ (`Intl.Segmenter` 필요).
- 빌드 단계 없음: 순수 JS/CSS/HTML, 의존성 0. 타입체크는 해당 없음(대신 `node --check` 문법 검사 + `web-ext lint`).
- `*.youtube.com` 전체에 매치(모바일이 주 대상, 데스크톱 www는 "깨지지만 않으면 됨").
- UI 문구는 한국어 고정(`_locales` 생략). 다국어 UI가 필요해지면 추가.
- 단어 분리는 `Intl.Segmenter`(일본어/중국어 포함 네이티브 지원).
- 번역 엔진은 YouTube 자동번역 1종만 구현(사용자 선택). 엔진 선택 설정은 만들지 않음.
- 내보내기 형식은 마크다운 표 1종.

미결/리스크
- **R1 리스크**: YouTube가 SABR/UMP 스트리밍으로 전환 중이라 "오디오 URL만 뽑아 `video.src`로 교체"하는 고전 기법이 안 먹힐 수 있음. audio 에이전트가 현황을 조사해 1순위(영상 요청 차단/오디오 전용 소스) → 폴백(최저 화질 강제 + 검은 화면)을 결정하고 plan에 근거를 남김.
- **R3 리스크**: timedtext URL에 PO 토큰(`pot`)이 요구될 수 있음. subs 에이전트가 플레이어 자체 요청 URL 재사용 등 우회책을 조사.
- 실기기(Firefox Android) E2E는 자동화 불가 → 수동 체크리스트로 대체(5절).

## 3. 작업 분할표 (단일 웨이브, 4개 병렬)

선행 공통 작업(오케스트레이터가 먼저 커밋): `extension/manifest.json`, `extension/shared/contract.js`, `extension/background/main.js`, 모든 스텁 파일, `package.json`, `tests/contract.test.js`, 본 문서.

| 에이전트 | 담당 요구사항 | 수정 소유 파일 | 읽기만 하는 파일 | 선행 의존성 |
|---|---|---|---|---|
| audio | R1 | `extension/background/audio.js`, `extension/content/audio.js`, `extension/content/audio.css`, `docs/plans/agent_audio.md` | contract.js, manifest.json, main.js | 선행 커밋 |
| subs | R2, R3 | `extension/background/captions.js`, `extension/content/pick-tracks.js`, `extension/content/subtitles.js`, `extension/content/subtitles.css`, `tests/pick-tracks.test.js`, `docs/plans/agent_subs.md` | 동일 | 선행 커밋 |
| dict | R4, R5 | `extension/background/dict.js`, `extension/content/dict.js`, `extension/content/dict.css`, `tests/dict.test.js`(선택), `docs/plans/agent_dict.md` | 동일 | 선행 커밋 (DOM 계약으로 subs와 분리) |
| ui | R6, R7 | `extension/options/*`, `extension/popup/*`, `extension/vocab/*`, `docs/plans/agent_ui.md` | 동일 | 선행 커밋 |

수정 금지(전 에이전트): `manifest.json`, `shared/contract.js`, `background/main.js`, `package.json`, `tests/contract.test.js`, 다른 에이전트 소유 파일. 필요하면 멈추고 보고.

## 4. 공유 계약

### 4.1 `SAO` 전역 (`extension/shared/contract.js` — 코드가 기준)
- `SAO.DEFAULTS` = `{nativeLang:'ko', targetLang:'en', audioOnly:true, dualSubs:true, dictionary:true, subtitleScale:1}`
- `SAO.getSettings(): Promise<Settings>` / `SAO.setSettings(patch): Promise<Settings>` / `SAO.onSettingsChanged(cb(settings))`
- `SAO.send(type, payload): Promise<any>` — background 핸들러가 throw하면 reject
- `SAO.handlers[type] = async (msg, sender) => result` — background 스크립트에서 등록
- `SAO.MSG.LOOKUP` = `'sao:lookup'`: 요청 `{word, from, to}` → 응답 `{word, translation, entries:[{pos, terms:string[]}]}`
- `SAO.MSG.CAPTIONS`, `SAO.MSG.AUDIO`: 각 담당 에이전트 내부용(페이로드 자유)
- `SAO.vocab.list() / add(item) / remove(id) / clear() / toMarkdown(items)`
- `VocabItem` = `{id, word, meaning, context, contextTranslation, lang, videoId, videoTitle, time, addedAt}`
- 저장소: `browser.storage.local` 키 `settings`, `vocab`. 그 외 키가 필요하면 `sao_<에이전트>_` 접두사.

### 4.2 DOM 계약 (content script 간 경계)
- audio: `audioOnly` 활성 시 `document.documentElement`에 클래스 `sao-audio-only`. `<video>` 요소만 가리고(검은 배경) 플레이어 컨테이너의 다른 자식은 가리지 않는다. `<video>` 요소 자체를 제거/교체하지 않는다(다른 에이전트가 `document.querySelector('video')`의 `currentTime`/`timeupdate`를 사용).
- subs: 플레이어 영역 안에 아래 구조를 만든다. `dualSubs=false`면 `#sao-overlay`를 제거하거나 `hidden`.
  ```html
  <div id="sao-overlay">
    <div class="sao-line sao-line-target" lang="en"><span class="sao-word">Hello</span>, <span class="sao-word">world</span></div>
    <div class="sao-line sao-line-native" lang="ko">안녕, 세상</div>
  </div>
  ```
  - `.sao-word`의 `textContent`가 조회할 단어. 구두점/공백은 span 밖 텍스트 노드.
  - 오버레이는 `pointer-events:none`, `.sao-word`만 `pointer-events:auto`.
- dict: `document`에 위임 클릭 리스너로 `.sao-word`를 처리. 문장 = `closest('.sao-line-target').textContent`, 문장 번역 = `#sao-overlay .sao-line-native`의 `textContent`, 언어 = 설정값. 팝업 루트는 `#sao-dict`(body 직속, 최상위 z-index). subs는 `#sao-dict`를 건드리지 않는다.
- CSS 클래스/ID 접두사: audio `sao-audio-`, subs `sao-overlay`/`sao-line`/`sao-word`, dict `sao-dict`.
- z-index: 오버레이 2147483000, 사전 팝업 2147483600.

### 4.3 UI 페이지 계약
- options/popup/vocab HTML은 `<script src="../shared/contract.js">`를 먼저 로드하고 `SAO.*`만 사용(인라인 스크립트 금지 — CSP).
- 단어장 페이지 경로: `extension/vocab/vocab.html` (popup에서 `browser.tabs.create({url: browser.runtime.getURL('vocab/vocab.html')})`로 연다).

## 5. 머지 순서와 통합 검증

머지 순서(파일이 배타적이라 충돌 없음 예상): audio → subs → dict → ui.

통합 검증
1. `npm test` (계약 테스트 + manifest 참조 파일 존재 + 전 JS 문법 검사 + 에이전트 테스트)
2. `npm run lint` (`web-ext lint`, 오류 0)
3. 기동 확인: `web-ext run`으로 데스크톱 Firefox에 로드 가능하면 로드 오류 없음 확인(Firefox 미설치 시 lint/build로 대체하고 명시)
4. E2E(수동, 1회): 자막 있는 영상에서 재생 → 검은 화면+소리 → 이중 자막 → 단어 탭 → 사전 → 단어장 추가 → 단어장 페이지에서 마크다운 복사. 자동화 불가 시 사용자 체크리스트로 인계.

## 6. 결과 기록

작성일: 2026-11-14

### 완료 항목
- 4개 브랜치를 audio → subs → dict → ui 순서로 머지. 충돌 없음(파일 소유권 배타).
- `npm test`: 16/16 통과 (계약 2, audio 3, subs 8, dict 3).
- `npm run lint`: 오류 0, 경고 1(`data_collection_permissions` 누락 — AMO 제출 시 필요).
- `npm run build`: `dist/subaudioonly-0.1.0.zip` 생성.
- 오케스트레이터가 content script 4개와 `background/captions.js`를 읽어 계약 준수 확인: DOM 구조(`#sao-overlay`/`.sao-word`/`#sao-dict`), `<video>` 비교체, 전역 이름 충돌 없음(모두 IIFE), 중국어 코드 매핑(subs는 `zh-Hans` 그대로 `tlang`, dict는 `zh-CN`/`zh-TW`로 변환).

### 미완료 항목
- **기동 확인과 E2E 미실행**: 이 PC에 Firefox가 없어 익스텐션 로드조차 해 보지 못함. 실제 m.youtube.com에서의 동작(R1~R5)은 전부 미검증. dict 팝업과 UI 3페이지는 `browser` 목을 끼운 헤드리스 Chrome에서만 확인.
- 수동 E2E 체크리스트(Firefox Android): ① 자막 있는 영상 재생 → 검은 화면 + 소리 ② 이중 자막 표시, seek 시 갱신 ③ 단어 탭 → 사전 팝업, 영상 일시정지 ④ 단어장에 추가 ⑤ 팝업 → 단어장 → 마크다운 복사 → 노션 붙여넣기 ⑥ 설정에서 언어/토글 변경이 즉시 반영 ⑦ 다음 영상으로 이동 후 ①② 유지.

### 계획 대비 변경점
- 워크트리: 세션 시작 시 git 저장소가 아니어서 자동 격리가 거부됨 → 별도 워크트리를 수동 생성(머지 후 제거).
- R1: 힌트로 준 webRequest 오디오 URL 가로채기는 SABR 전환으로 폐기. 대신 ① 검은 화면 + 144p 강제(항상) ② VISIONOS 클라이언트 player API로 직접 오디오 URL을 받아 `video.src` 교체(최선 노력, 실패 시 ①만). `background/audio.js`는 주석뿐.
- R3: timedtext가 PO 토큰 없이 빈 응답일 때, 플레이어 자막을 켜서 나온 요청 URL을 background가 관찰해 재사용하는 폴백 추가.
- R6: 단어장 언어 필터 생략(선택 사항).

### 알려진 리스크(실기기에서 먼저 볼 것)
- audio의 `video.src` 교체가 플레이어 MSE를 끊으므로, subs의 PO 토큰 폴백(플레이어가 timedtext를 요청해야 함)과 다음 영상 자동 이동에 영향을 줄 수 있음. 문제가 되면 `content/audio.js`의 `trySwap` 호출을 끄고 144p 폴백만 사용.
- VISIONOS `clientVersion` 하드코딩은 YouTube가 막으면 조용히 144p 폴백으로 떨어짐.
- 모바일 DOM 선택자(`#player-container-id`, 기본 자막 창, 썸네일)와 플레이어 API(`setPlaybackQualityRange`, `toggleSubtitlesOn`) 존재 여부는 가정.
- subs: PO 토큰 폴백 실패가 영상별로 캐시되어 새로고침 전까지 재시도 없음. 동시 큐는 뒤의 것만 표시.
