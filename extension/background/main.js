// 오케스트레이터 소유. SAO.handlers에 등록된 핸들러로 메시지를 디스패치한다.
'use strict';

browser.runtime.onMessage.addListener((msg, sender) => {
  const handler = msg && SAO.handlers[msg.type];
  if (!handler) return undefined;
  return Promise.resolve()
    .then(() => handler(msg, sender))
    .catch((e) => ({ __error: String((e && e.message) || e) }));
});
