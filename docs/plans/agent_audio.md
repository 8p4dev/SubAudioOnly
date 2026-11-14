# agent_audio plan — R1 오디오 전용 재생

## 조사 결과 (2026-11-14)

- **고전 기법(webRequest로 `mime=audio` URL 가로채 `video.src` 교체)은 사실상 죽었다.**
  - craftwar/youtube-audio 이슈 #16 "Stopped working"(2024-06~, 미해결). 웹 플레이어가 SABR/UMP(POST `videoplayback`, URL에 mime 없음, 오디오·비디오가 한 UMP 응답에 섞임)로 넘어감.
  - yt-dlp 쪽도 web 계열 클라이언트는 "formats missing a URL (SABR-only)" 상태.
- **현재(2026-09) 살아 있는 Firefox Android용 오픈소스**: Tube Audio Options+ (schdie/we_firefox_ytop_mv3, v54). webRequest를 아예 안 쓰고, content script에서 `youtubei/v1/player`를 비-웹 클라이언트(VISIONOS)로 호출해 직접 URL이 달린 오디오 포맷을 받아 `video.src`에 넣는다. 릴리스 노트가 "temporary fix", "updated client to work around 403"의 반복 → 하드코딩된 클라이언트 버전이 주기적으로 썩는 방식.
- **CY Fung "YouTube: Audio Only" 유저스크립트**(150KB): `deviceIsAudioOnly` 플래그 + `MediaSource.addSourceBuffer` 가짜 SourceBuffer 등 플레이어 내부 깊숙한 패치. 실기기 검증 없이 축소 이식하기엔 위험(실패 모드가 "재생 정지").
- UMP 응답을 `filterResponseData`로 걸러 영상 파트 제거: 바이트는 이미 받은 뒤라 절약이 없고 MSE 영상 버퍼가 굶어 정지 → 기각.
- 단순 cancel: 플레이어 정지 → 기각.

## 접근 방식

2계층. 아래층은 항상 켜지고, 위층은 실패해도 아래층으로 떨어진다.

1. **기본(항상, 안전)**: `html.sao-audio-only` 클래스 + CSS로 `<video>` 투명/검은 배경, `#movie_player.wrappedJSObject.setPlaybackQualityRange('tiny','tiny')`로 144p 강제(페이지 월드 스크립트 주입 불필요). `<video>`의 `loadstart`/`playing`(document 캡처)마다 재적용 → SPA 이동·광고 후에도 유지.
2. **최선 노력(영상 바이트 0)**: `/watch`에서 본편이 `playing`이 되면 content script가 same-origin `youtubei/v1/player`(VISIONOS 클라이언트, Tube Audio Options+ v54와 동일 구성)를 호출 → `adaptiveFormats` 중 직접 `url`이 있는 오디오 포맷을 골라 `video.src` 교체(시각·배속 유지). `<video>` 요소는 그대로.
   - 건너뛰는 경우(→ 1번만 적용): 광고 중(`.ad-showing`), 라이브, `/watch` 아님(쇼츠 등), 응답에 직접 URL 없음, fetch 실패.
   - 영상당 1회만 시도. 플레이어가 src를 blob으로 되돌리면 다시 덮어쓰지 않는다(싸움 금지).
   - 교체 후 `<video>` error 또는 10초 내 로드 실패 → `sessionStorage.sao_audio_noswap=1` 후 현재 시각 `t=`로 리로드 1회 → 그 탭은 이후 1번(최저 화질)만 사용. 리로드 루프 없음.
- 토글 OFF: 클래스 제거 + 화질 범위 `auto` 복원. 교체된 상태였다면 리로드 1회(MSE 소스는 되살릴 수 없음).
- background(`background/audio.js`)는 할 일이 없다(webRequest 기법 폐기, fetch는 Origin 때문에 content에서). 주석만 남김. `SAO.MSG.AUDIO` 미사용.

트레이드오프: 2번은 YouTube가 클라이언트 버전을 막으면 조용히 1번으로 떨어진다(기능 저하이지 고장은 아님). 교체 전 초반 몇 초는 144p 영상 바이트를 받는다.

## 수정/생성 파일

- `extension/content/audio.js` — 전체 로직 + 순수 함수 `pickAudio`
- `extension/content/audio.css` — 검은 화면
- `extension/background/audio.js` — 주석(로직 없음)
- `tests/audio.test.js` — `pickAudio` 테스트
- 소유 범위 밖 파일·권한 추가 필요 없음.

## 단계

- [x] 조사 및 plan 작성
- [x] `audio.css`: video 투명 + 검은 배경 + 썸네일 숨김
- [x] `content/audio.js`: 설정 반영(클래스 토글), 최저 화질 강제, OFF 복원
- [x] `content/audio.js`: `pickAudio` + 직접 오디오 URL 교체 + 실패 시 복구
- [x] `tests/audio.test.js`
- [x] `background/audio.js` 주석 정리
- [x] `npm test`, `npm run lint` 통과, 커밋

## 검증 방법

- `pickAudio`: `node --test` (오디오만 선택, url 없는/재생 불가 포맷 제외, 기본 트랙·최고 비트레이트 우선, 없으면 null).
- 문법/manifest: `npm test`, `npm run lint`(오류 0).
- 실기기 E2E(Firefox Android + m.youtube.com)는 이 환경에서 불가 → 최종 보고에 미검증으로 명시, 수동 체크리스트 인계.

## 결과 (2026-11-14)

- 검증함: `npm test` 5/5 통과(pickAudio 3건 포함), `npm run lint` 오류 0(경고 1: manifest `data_collection_permissions` 누락 — 오케스트레이터 소유).
- 미검증(실브라우저 E2E 불가): mweb에서 `setPlaybackQualityRange('tiny','tiny')`/`('auto','auto')` 동작, VISIONOS 응답에 직접 오디오 URL이 실제로 오는지, src 교체 후 mweb 플레이어 반응(오류 오버레이·src 되돌림 여부), CSS 선택자(`.html5-video-player`, `.ytp-cued-thumbnail-overlay-image`)가 현재 mweb DOM과 맞는지, 광고/라이브/쇼츠 동작.
