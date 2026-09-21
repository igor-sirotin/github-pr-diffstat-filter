const test = require('node:test');
const assert = require('node:assert');
const core = require('../src/core.js');

const m = (patterns) => core.parsePatterns(patterns);

test('bare name matches at any depth, case-insensitively', () => {
  const ms = m('cargo.lock');
  assert.ok(core.isExcluded('Cargo.lock', ms));
  assert.ok(core.isExcluded('crates/foo/Cargo.lock', ms));
  assert.ok(!core.isExcluded('Cargo.lock.bak', ms));
  assert.ok(!core.isExcluded('notCargo.lock', ms));
});

test('pattern with a slash is anchored to the root', () => {
  const ms = m('nix/flake.lock');
  assert.ok(core.isExcluded('nix/flake.lock', ms));
  assert.ok(!core.isExcluded('sub/nix/flake.lock', ms));
  assert.ok(core.isExcluded('flake.lock', m('/flake.lock')));
  assert.ok(!core.isExcluded('sub/flake.lock', m('/flake.lock')));
});

test('wildcards and directories', () => {
  assert.ok(core.isExcluded('a/b/c.snap', m('*.snap')));
  assert.ok(core.isExcluded('vendor/x/y.go', m('vendor/')));
  assert.ok(core.isExcluded('pkg/vendor/x.go', m('vendor/')));
  assert.ok(!core.isExcluded('vendor', m('vendor/')));
  assert.ok(core.isExcluded('docs/a/b/gen.md', m('docs/**/gen.md')));
  assert.ok(core.isExcluded('docs/gen.md', m('docs/**/gen.md')));
  assert.ok(!core.isExcluded('src/docs/gen.md', m('docs/**/gen.md')));
  assert.ok(core.isExcluded('gen/a/b.rs', m('gen')));
  assert.ok(core.isExcluded('a.lock', m('?.lock')));
  assert.ok(!core.isExcluded('ab.lock', m('?.lock')));
});

test('comments, blanks and regex metacharacters', () => {
  assert.strictEqual(m('# comment\n\n  \n').length, 0);
  assert.ok(!core.isExcluded('fooXjson', m('foo.json')));
  assert.ok(core.isExcluded('a+b(c).txt', m('a+b(c).txt')));
});

test('computeStats subtracts excluded files', () => {
  const pr = { additions: 25202, deletions: 56795, changed_files: 3 };
  const files = [
    { filename: 'flake.lock', additions: 25130, deletions: 56583 },
    { filename: 'src/main.cpp', additions: 70, deletions: 200 },
    { filename: 'README.md', additions: 2, deletions: 12 },
  ];
  const s = core.computeStats(pr, files, m(core.DEFAULT_PATTERNS));
  assert.deepStrictEqual(s.filtered, { additions: 72, deletions: 212 });
  assert.strictEqual(s.excluded.files.length, 1);
  assert.strictEqual(s.relevant, true);
  assert.strictEqual(s.truncated, false);
});

test('not relevant when only excluded files changed, or none matched', () => {
  const pr = { additions: 10, deletions: 5, changed_files: 2 };
  const onlyLocks = [
    { filename: 'flake.lock', additions: 5, deletions: 5 },
    { filename: 'Cargo.lock', additions: 5, deletions: 0 },
  ];
  assert.strictEqual(core.computeStats(pr, onlyLocks, m(core.DEFAULT_PATTERNS)).relevant, false);
  const noLocks = [
    { filename: 'a.rs', additions: 5, deletions: 5 },
    { filename: 'b.rs', additions: 5, deletions: 0 },
  ];
  assert.strictEqual(core.computeStats(pr, noLocks, m(core.DEFAULT_PATTERNS)).relevant, false);
});

test('truncated file lists count unseen files as kept', () => {
  const pr = { additions: 100, deletions: 100, changed_files: 5 };
  const files = [{ filename: 'flake.lock', additions: 90, deletions: 90 }];
  const s = core.computeStats(pr, files, m('flake.lock'));
  assert.strictEqual(s.truncated, true);
  assert.strictEqual(s.relevant, true);
  assert.deepStrictEqual(s.filtered, { additions: 10, deletions: 10 });
});

test('parseCount and parsePullUrl', () => {
  assert.strictEqual(core.parseCount('+25,202'), 25202);
  assert.strictEqual(core.parseCount('\n  −56,795 '), 56795);
  assert.strictEqual(core.parseCount('-3'), 3);
  assert.strictEqual(core.parseCount('Files'), null);
  assert.deepStrictEqual(core.parsePullUrl('/logos-co/logos-chat-module/pull/76/files'),
    { owner: 'logos-co', repo: 'logos-chat-module', number: 76 });
  assert.deepStrictEqual(core.parsePullUrl('/o/r/pull/1'), { owner: 'o', repo: 'r', number: 1 });
  assert.strictEqual(core.parsePullUrl('/o/r/pulls'), null);
  assert.strictEqual(core.parsePullUrl('/o/r/issues/1'), null);
});
