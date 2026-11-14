# agent_dict plan — R4 단어 클릭 사전, R5 단어장 추가

## 접근 방식

- **조회(background)**: `extension/background/dict.js`가 Google 번역 무료 엔드포인트(`translate_a/single?client=gtx&dt=t&dt=bd`)를 `fetch`하고 `SAO.handlers[SAO.MSG.LOOKUP]`에 등록. 응답 파싱은 순수 함수 `parseLookup(word, data)`로 분리해 `module.exports`로 node 테스트에 노출(브라우저에선 `module`이 없으므로 가드). 캐시는 `Map`(키 `from|to|word`, 성공만 저장).
  - 실제 응답 확인(curl, 2026-11-14): `run`(en→ko) → `[[["달리다","run",...]], [["noun",[terms...],[...],"run",1], ["verb",...]], "en", ...]`. 사전 항목이 없는 단어(`qwzxv`, ja `食べる`) → `[[["먹다","食べる",...]], null, "ja", ...]` — `[1]`이 `null`.
  - 설정 언어 코드 `zh-Hans`/`zh-Hant`는 Google 코드 `zh-CN`/`zh-TW`로 변환(그 외는 그대로).
- **UI(content)**: `extension/content/dict.js`가 `document`에 캡처 단계 `click` 리스너 하나로 모든 것을 위임 처리(단어 탭 / 팝업 안 버튼 / 팝업 밖 탭). 캡처 단계에서 `stopPropagation`하면 팝업 내부 버튼의 자체 리스너에 이벤트가 닿지 않으므로 버튼도 같은 리스너에서 `closest()`로 분기한다. YouTube 플레이어가 click 이외의 이벤트(touch/pointer/mouse)로 탭을 처리할 수 있으므로 `.sao-word`/`#sao-dict` 대상의 해당 이벤트도 캡처 단계에서 `stopPropagation`만(기본 동작은 유지 → click 합성/스크롤 정상).
- **팝업 위치**: JS 좌표 계산 없이 CSS만. 세로 화면은 하단 고정 시트(플레이어가 위쪽이라 자막을 가리지 않음), 가로 화면(`orientation: landscape`)은 상단 고정(자막이 하단). `max-height` + `overflow:auto`로 화면 밖으로 나가지 않음. 팝업은 `document.fullscreenElement || document.body`에 붙이고 `fullscreenchange` 때 다시 붙인다.
- 텍스트는 전부 `textContent`. 팝업 DOM은 `createElement`로 조립.

검토한 대안
- 탭한 단어 근처에 좌표 계산으로 띄우기: 화면 경계 처리 코드가 필요하고 작은 화면에서 자막을 가림 → CSS 고정 위치 채택.
- Shadow DOM으로 스타일 격리: 공유 계약이 `#sao-dict`/`sao-dict` 접두사 CSS 파일을 전제로 함 → 접두사 클래스 + 필요한 속성 명시로 충분.
- 버튼별 리스너: 캡처 단계 차단과 충돌 → 단일 위임 리스너.

## 수정/생성 파일

- `extension/background/dict.js` (스텁 교체)
- `extension/content/dict.js` (스텁 교체)
- `extension/content/dict.css` (스텁 교체)
- `tests/dict.test.js` (신규)
- `docs/plans/agent_dict.md` (본 문서)

소유 범위 밖 파일 수정 없음. 추가 권한 불필요(`https://translate.googleapis.com/*` 이미 있음).

## 단계별 작업

- [x] 1. 실제 엔드포인트 응답 형태 확인 (curl)
- [x] 2. `background/dict.js`: `parseLookup` + fetch 핸들러 + 캐시
- [x] 3. `tests/dict.test.js`: 사전 항목 있음/없음/깨진 응답
- [x] 4. `content/dict.js`: 위임 리스너, 팝업, 일시정지/재개, 단어장 추가
- [x] 5. `content/dict.css`: 팝업 스타일(터치 타깃 44px, 세로/가로)
- [x] 6. 임시 HTML 하네스(스크래치패드, `browser` 스텁)로 헤드리스 브라우저 동작/스크린샷 확인
- [x] 7. `npm test`, `npm run lint` 통과 후 커밋

## 검증 방법

- 2·3: `npm test` (node:test) — 파서 3가지 경우 + 전 JS `node --check`.
- 2: node에서 실제 엔드포인트를 `parseLookup`에 통과시켜 결과 확인(1회).
- 4·5·6: 계약 DOM을 흉내 낸 임시 HTML에 `contract.js` + `content/dict.js` + `dict.css`를 로드하고 `browser`를 스텁해 헤드리스 브라우저로 클릭 시나리오 실행(상태 assert + 세로/가로 스크린샷).
- 7: `npm test`, `npm run lint`(오류 0).
- 실제 YouTube 모바일(Firefox Android) E2E는 이 환경에서 불가 → 최종 보고에 미검증으로 명시.

## 변경 사항

- 검증 6의 하네스는 `file://`가 아니라 로컬 node http 서버로 제공(`history.replaceState`로 `?v=`/`/shorts/` URL을 흉내 내려면 http origin 필요). Firefox 미설치라 헤드리스 **Chrome**으로 실행(`browser`는 스텁).
- CSS 규칙을 전부 `#sao-dict .sao-dict-*`로 올림: `#sao-dict * { font: inherit; color: inherit }` 리셋이 클래스 단독 선택자를 덮어써 굵기/색이 적용되지 않았음(스크린샷으로 발견).

## 검증 결과

- `npm test`: 5/5 통과(파서 3건 포함). `npm run lint`: 오류 0.
- node에서 실제 엔드포인트 호출: `run`(en→ko) → 번역 `달리다`, noun 25개/verb 52개. `学习`(zh-Hans→ko, `zh-CN` 변환) → `공부하다`, 항목 없음. 재조회 시 캐시 객체 반환.
- 헤드리스 Chrome 하네스 27개 assert 통과: 로딩 상태, 일시정지/재개(원래 정지면 재개 안 함), click·pointerup 전파 차단, 번역/품사 표시, HTML 문자열이 텍스트로만 표시, 단어장 항목 필드, "추가됨" 상태, 이미 있는 단어, 다른 단어 전환, 밖 탭/닫기 버튼, 오류 문구, 쇼츠 videoId, `dictionary=false`, 팝업이 뷰포트 안(504x704, 782x264), 버튼 44px.
- **미검증**: Firefox(데스크톱/Android)에서의 실제 로드, 실제 m.youtube.com 플레이어와의 탭 충돌, 전체화면에서의 표시, subs 에이전트의 실제 오버레이와의 결합.
