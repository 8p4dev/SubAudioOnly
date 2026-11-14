// R1 오디오 전용 재생은 content/audio.js가 전부 처리한다.
// webRequest로 mime=audio URL을 가로채는 고전 기법은 SABR/UMP 전환으로 쓸 수 없어 background 로직이 없다
// (근거: docs/plans/agent_audio.md).
'use strict';
