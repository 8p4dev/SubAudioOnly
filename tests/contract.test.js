'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

require('../extension/shared/contract.js');

test('toMarkdown: 표 형식 + 파이프/개행 이스케이프 + 타임스탬프 링크', () => {
  const md = SAO.vocab.toMarkdown([
    { word: 'a|b', meaning: '뜻', context: 'line1\nline2', contextTranslation: '', videoId: 'abc', videoTitle: 'T', time: 12.7 },
  ]);
  const lines = md.split('\n');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[2], '| a\\|b | 뜻 | line1 line2 |  | [T](https://youtu.be/abc?t=12) |');
});

test('manifest가 참조하는 파일이 모두 존재하고 모든 JS가 문법 오류 없음', () => {
  const root = path.join(__dirname, '..', 'extension');
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const cs = m.content_scripts.flatMap((c) => [...c.js, ...c.css]);
  for (const f of [...m.background.scripts, ...cs, m.browser_action.default_popup, m.options_ui.page]) {
    assert.ok(fs.existsSync(path.join(root, f)), `missing: ${f}`);
  }
  for (const f of fs.readdirSync(root, { recursive: true })) {
    if (f.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, f)]);
  }
});
