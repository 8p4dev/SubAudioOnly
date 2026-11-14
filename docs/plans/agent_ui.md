# agent_ui plan — 설정 / 팝업 / 단어장 페이지 (R6, R7)

## 접근 방식
- 순수 HTML/CSS/JS, 빌드·의존성 없음. 각 페이지는 `../shared/contract.js` → 자기 JS 순으로 로드하고 `SAO.*`만 사용.
- **렌더링 단일 경로**: 입력 `change` → `SAO.setSettings({key: value})`만 호출. 화면 갱신은 최초 `getSettings()`와 `SAO.onSettingsChanged(render)` 한 곳에서만 한다(자기 변경도 storage 이벤트로 돌아오므로 팝업↔옵션 동기화가 같은 코드로 해결됨). 단어장도 동일: 삭제/전체 삭제는 `SAO.vocab.*`만 호출하고 `storage.onChanged`(키 `vocab`)에서 다시 그린다.
- **언어 이름**: 코드 목록(BCP-47)만 `options.js`에 두고 표시 이름은 `Intl.DisplayNames(['ko'], {type:'language'})`로 생성. 팝업의 언어 쌍 표시도 같은 API라 목록 공유 파일이 필요 없음.
  - 대안: 이름까지 손으로 적은 표 → 팝업과 공유 파일이 필요해져 기각.
- **토글**: 네이티브 `<input type="checkbox">`를 CSS(`appearance:none` + 배경 그라디언트 손잡이)로 스위치 모양. 행 전체가 `<label>`이라 터치 타깃 44px 이상, 키보드/스크린리더는 네이티브 동작 그대로.
  - 대안: div+JS 커스텀 스위치 → ARIA/키보드 재구현 필요해 기각.
- **공통 스타일**: `extension/options/base.css` 하나를 세 페이지가 상대 경로로 참조. 색은 `light-dark()` + `color-scheme: light dark`(Firefox 120+, 최소 버전 125)로 다크 모드 대응. 페이지별 CSS는 그 페이지 고유 규칙만.
- **XSS**: 사용자 데이터는 전부 `textContent`/`createElement`. `innerHTML` 사용 안 함. 출처 링크는 `encodeURIComponent(videoId)`.
- 단어장 언어 필터는 생략(선택 사항). 필요해지면 `lang`으로 `items.filter` 한 줄 + select 추가.

## 수정/생성 파일
- `extension/options/base.css` (신규, 공통)
- `extension/options/options.html` (스텁 교체), `options.js`, `options.css` (신규)
- `extension/popup/popup.html` (스텁 교체), `popup.js`, `popup.css` (신규)
- `extension/vocab/vocab.html`, `vocab.js`, `vocab.css` (신규)
- `docs/plans/agent_ui.md` (본 문서)
- 소유 범위 밖 파일 수정 없음.

## 단계별 작업
- [x] 1. `base.css` — 색 토큰, 카드/행/버튼/스위치/select 공통 스타일
- [x] 2. 설정 페이지 — 언어 select 2개, 토글 3개, 자막 크기 range, 같은 언어 경고, 기본값 되돌리기, 단어장 링크
- [x] 3. 팝업 — 토글 3개, 언어 쌍, 단어장/설정 열기
- [x] 4. 단어장 — 목록, 개별 삭제, 마크다운 복사 + textarea, 전체 삭제, 빈 상태, storage 변경 반영
- [x] 5. 검증 — `npm test`, `npm run lint`, 메모리 `browser` 목을 끼운 스크래치 복사본으로 헤드리스 브라우저 동작/레이아웃 확인(320px, 다크)
- [x] 6. 커밋

## 검증 방법
- 1~4: `npm test`(전 JS `node --check` + manifest 참조 파일), `npm run lint`(오류 0).
- 5: 워크트리 밖 스크래치에 extension 복사 + `browser` 목 스크립트 주입 → 헤드리스 Chromium 계열로 스크린샷(320px 폭, 라이트/다크)과 시나리오 스크립트(설정 저장·재로드·교차 반영, 단어 삭제/복사/전체 삭제, XSS 문자열이 텍스트로 남는지) 실행 결과 확인.
- Firefox 미설치 환경이라 실제 익스텐션 로드(web-ext run), Firefox Android 실기기 확인은 미검증으로 보고.

## 변경 사항
- 검증 중 320px에서 한국어가 어절 중간에서 끊겨 `base.css`에 `word-break: keep-all` 추가(긴 외국어 단어는 `overflow-wrap: anywhere`가 처리).
- 단어장의 출처 링크/설정 링크가 44px 미만으로 측정되어 패딩 확대, 설정 링크를 `.btn`으로 변경.
- 헤드리스 Chrome은 창 폭을 504px 미만으로 줄이지 못해, 320px 폭 iframe 래퍼(스크래치)로 측정/스크린샷.

## 검증 결과
- `npm test` 통과, `npm run lint` 오류 0(경고 1: manifest `data_collection_permissions` 누락 — 오케스트레이터 소유).
- 메모리 `browser` 목 + 헤드리스 Chrome: 설정 저장/저장값 표시/외부 변경 반영/같은 언어 경고/되돌리기, 팝업 토글·언어 쌍·열기 호출, 단어장 표시/삭제/추가 반영/복사 성공·실패/전체 삭제(취소·확인)/빈 상태, HTML 문자열이 텍스트로만 렌더링됨, videoId 인코딩, 320px 가로 넘침 없음, 터치 타깃 44px 이상, 라이트/다크 스크린샷 확인.
- 미검증: 실제 Firefox(데스크톱/Android)에 익스텐션으로 로드한 상태의 동작(이 환경에 Firefox 없음).
