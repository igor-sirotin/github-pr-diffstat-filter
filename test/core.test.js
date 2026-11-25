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

const reviewFiles = [
  { filename: 'flake.lock', additions: 25130, deletions: 56583 },
  { filename: 'src/main.cpp', additions: 70, deletions: 200 },
  { filename: 'README.md', additions: 2, deletions: 12 },
];
const reviewPr = { additions: 25202, deletions: 56795, changed_files: 3 };

test('review is null when viewed state is unknown or nothing kept is viewed', () => {
  const ms = m(core.DEFAULT_PATTERNS);
  assert.strictEqual(core.computeStats(reviewPr, reviewFiles, ms).review, null);
  assert.strictEqual(core.computeStats(reviewPr, reviewFiles, ms, new Set()).review, null);
  // A viewed lockfile is already excluded, so it does not count as review progress.
  assert.strictEqual(core.computeStats(reviewPr, reviewFiles, ms, new Set(['flake.lock'])).review, null);
});

test('viewed files are subtracted from the filtered numbers', () => {
  const s = core.computeStats(reviewPr, reviewFiles, m(core.DEFAULT_PATTERNS), new Set(['flake.lock', 'README.md']));
  assert.deepStrictEqual(s.filtered, { additions: 72, deletions: 212 });
  assert.deepStrictEqual(s.review.left, { additions: 70, deletions: 200, files: 1 });
  assert.deepStrictEqual(s.review.viewedFiles.map((f) => f.filename), ['README.md']);
  assert.strictEqual(s.review.totalFiles, 2);
  assert.strictEqual(s.review.done, false);
  assert.strictEqual(s.review.progress, 14 / 284);
});

test('review is done when every kept file is viewed', () => {
  const s = core.computeStats(reviewPr, reviewFiles, m(core.DEFAULT_PATTERNS), new Set(['src/main.cpp', 'README.md']));
  assert.deepStrictEqual(s.review.left, { additions: 0, deletions: 0, files: 0 });
  assert.strictEqual(s.review.done, true);
  assert.strictEqual(s.review.progress, 1);
});

test('without a shown filter, review is measured against the PR totals', () => {
  const s = core.computeStats(reviewPr, reviewFiles, [], new Set(['flake.lock']));
  assert.strictEqual(s.relevant, false);
  assert.deepStrictEqual(s.review.left, { additions: 72, deletions: 212, files: 2 });
  // Also when every file matches the patterns and the filter is therefore not shown.
  const pr = { additions: 10, deletions: 5, changed_files: 2 };
  const locks = [
    { filename: 'flake.lock', additions: 5, deletions: 5 },
    { filename: 'Cargo.lock', additions: 5, deletions: 0 },
  ];
  const t = core.computeStats(pr, locks, m(core.DEFAULT_PATTERNS), new Set(['Cargo.lock']));
  assert.deepStrictEqual(t.review.left, { additions: 5, deletions: 5, files: 1 });
});

test('unseen files of a truncated listing count as not viewed', () => {
  const pr = { additions: 100, deletions: 100, changed_files: 5 };
  const files = [
    { filename: 'flake.lock', additions: 90, deletions: 90 },
    { filename: 'a.rs', additions: 4, deletions: 6 },
  ];
  const s = core.computeStats(pr, files, m('flake.lock'), new Set(['a.rs']));
  assert.deepStrictEqual(s.review.left, { additions: 6, deletions: 4, files: 3 });
  assert.strictEqual(s.review.done, false);
});

test('progress falls back to file counts when no lines changed', () => {
  const pr = { additions: 0, deletions: 0, changed_files: 2 };
  const files = [
    { filename: 'a.png', additions: 0, deletions: 0 },
    { filename: 'b.png', additions: 0, deletions: 0 },
  ];
  assert.strictEqual(core.computeStats(pr, files, [], new Set(['a.png'])).review.progress, 0.5);
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

test('normalizeOwner accepts the usual ways of writing an owner', () => {
  for (const s of ['acme', ' Acme ', '@acme', 'acme/', 'acme/repo', 'https://github.com/Acme/repo', 'github.com/acme']) {
    assert.strictEqual(core.normalizeOwner(s), 'acme', s);
  }
  assert.strictEqual(core.normalizeOwner(''), '');
  assert.strictEqual(core.normalizeOwner(undefined), '');
});

test('parseOwnerTokens drops incomplete entries and normalizes owners', () => {
  assert.deepStrictEqual(
    core.parseOwnerTokens([
      { owner: 'Acme', token: ' t1 ' },
      { owner: '', token: 't2' },
      { owner: 'other', token: '' },
      null,
    ]),
    { acme: 't1' },
  );
  assert.deepStrictEqual(core.parseOwnerTokens(undefined), {});
});

test('tokenFor prefers the owner token and falls back to the default', () => {
  const map = core.parseOwnerTokens([{ owner: 'acme', token: 'org' }]);
  assert.strictEqual(core.tokenFor('ACME', 'def', map), 'org');
  assert.strictEqual(core.tokenFor('someone', 'def', map), 'def');
  assert.strictEqual(core.tokenFor('someone', '', map), '');
  assert.strictEqual(core.tokenFor('acme', '', map), 'org');
  // Owner names must not reach Object.prototype.
  assert.strictEqual(core.tokenFor('constructor', 'def', {}), 'def');
  assert.strictEqual(core.tokenFor('acme', 'def', undefined), 'def');
});
