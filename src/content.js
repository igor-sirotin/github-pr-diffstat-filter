(function () {
  const ext = globalThis.browser ?? globalThis.chrome;
  const core = globalThis.DiffstatCore;
  const BADGE_CLASS = 'ghdf-badge';
  const HIDDEN_CLASS = 'ghdf-hidden';
  const SUCCESS = '.fgColor-success, .color-fg-success';
  const DANGER = '.fgColor-danger, .color-fg-danger';
  const PULL_TTL_MS = 30_000;

  let settings = null; // { matchers, token }
  const pullCache = new Map(); // "o/r#n" -> { at, promise }
  const filesCache = new Map(); // "o/r#n@sha" -> promise<files>

  async function loadSettings() {
    const [sync, local] = await Promise.all([
      ext.storage.sync.get({ patterns: core.DEFAULT_PATTERNS }),
      ext.storage.local.get({ token: '' }),
    ]);
    settings = { matchers: core.parsePatterns(sync.patterns), token: local.token.trim() };
  }

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function gh(path) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
    const res = await fetch(`https://api.github.com${path}`, { headers });
    if (res.ok) return res.json();

    let message = `GitHub API responded ${res.status}`;
    if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
      message = settings.token
        ? 'GitHub API rate limit exceeded for this token.'
        : 'GitHub API rate limit exceeded (60 requests/hour without a token). Add a token in the extension options.';
    } else if (res.status === 401) {
      message = 'The token was rejected by GitHub (401). Check it in the extension options.';
    } else if (res.status === 404) {
      message = settings.token
        ? 'PR not found through the API. Does the token have access to this repository?'
        : 'PR not found through the API. For private repositories, add a token in the extension options.';
    }
    throw new ApiError(res.status, message);
  }

  function getPull({ owner, repo, number }) {
    const key = `${owner}/${repo}#${number}`;
    const hit = pullCache.get(key);
    if (hit && Date.now() - hit.at < PULL_TTL_MS) return hit.promise;
    const promise = gh(`/repos/${owner}/${repo}/pulls/${number}`);
    pullCache.set(key, { at: Date.now(), promise });
    promise.catch(() => pullCache.delete(key));
    return promise;
  }

  // Files are keyed by head SHA, so they are only refetched after new pushes.
  function getFiles({ owner, repo, number }, pull) {
    const key = `${owner}/${repo}#${number}@${pull.head.sha}`;
    if (!filesCache.has(key)) {
      const pages = Math.max(1, Math.ceil(Math.min(pull.changed_files, 3000) / 100));
      const promise = Promise.all(
        Array.from({ length: pages }, (_, i) =>
          gh(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${i + 1}`)),
      ).then((chunks) => chunks.flat());
      filesCache.set(key, promise);
      promise.catch(() => filesCache.delete(key));
    }
    return filesCache.get(key);
  }

  async function getStats(pr) {
    const pull = await getPull(pr);
    const files = await getFiles(pr, pull);
    return core.computeStats(pull, files, settings.matchers);
  }

  // Finds "+N" / "−M" sibling pairs, as used by both the React PR header and the classic #diffstat.
  function findDiffstatPairs() {
    const pairs = [];
    for (const add of document.querySelectorAll(SUCCESS)) {
      if (add.closest(`.${BADGE_CLASS}`)) continue;
      const del = add.nextElementSibling;
      if (!del || !del.matches(DANGER)) continue;
      if (!/^\s*\+/.test(add.textContent)) continue;
      const additions = core.parseCount(add.textContent);
      const deletions = core.parseCount(del.textContent);
      if (additions === null || deletions === null) continue;
      pairs.push({ add, del, additions, deletions });
    }
    return pairs;
  }

  const fmt = (n) => n.toLocaleString('en-US');

  function tooltip(stats) {
    const lines = [`Excluding ${stats.excluded.files.length} file(s) matching your patterns:`];
    const shown = stats.excluded.files.slice(0, 25);
    for (const f of shown) lines.push(`  ${f.filename}  +${fmt(f.additions)} −${fmt(f.deletions)}`);
    if (stats.excluded.files.length > shown.length) lines.push(`  …and ${stats.excluded.files.length - shown.length} more`);
    lines.push('', `Total with all files: +${fmt(stats.total.additions)} −${fmt(stats.total.deletions)}`);
    if (stats.truncated) lines.push('', 'GitHub lists at most 3000 files per PR; files beyond that are counted as kept.');
    return lines.join('\n');
  }

  function excludedLabel(files) {
    if (files.length > 2) return `${files.length} excluded files`;
    return files.map((f) => f.filename.split('/').pop()).join(', ');
  }

  function countSpan(like, text) {
    const span = document.createElement('span');
    span.className = like.className;
    span.classList.remove(HIDDEN_CLASS);
    span.textContent = text;
    return span;
  }

  // Takes the place of GitHub's own numbers (which get hidden) and keeps them in brackets:
  //   +71 −211 (with flake.lock, Cargo.lock: +25,202 −56,795)
  function renderBadge(pair, stats) {
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.title = tooltip(stats);

    const minus = pair.del.textContent.trim()[0] === '-' ? '-' : '\u2212';
    const orig = document.createElement('span');
    orig.className = 'ghdf-orig';
    orig.append(
      `(with ${excludedLabel(stats.excluded.files)}: `,
      countSpan(pair.add, `+${fmt(stats.total.additions)}`),
      ' ',
      countSpan(pair.del, `${minus}${fmt(stats.total.deletions)}`),
      ')',
    );
    badge.append(
      countSpan(pair.add, `+${fmt(stats.filtered.additions)}`),
      ' ',
      countSpan(pair.del, `${minus}${fmt(stats.filtered.deletions)}`),
      ' ',
      orig,
    );
    return badge;
  }

  function renderError(message) {
    const badge = document.createElement('span');
    badge.className = `${BADGE_CLASS} ghdf-error`;
    badge.title = `PR diffstat filter: ${message}`;
    badge.textContent = '⚠';
    return badge;
  }

  function placeBadge(pair, badge) {
    const existing = pair.del.nextElementSibling;
    if (existing && existing.classList.contains(BADGE_CLASS)) {
      if (existing.isEqualNode(badge)) return;
      existing.replaceWith(badge);
    } else {
      pair.del.after(badge);
    }
  }

  // Hides GitHub's own numbers while the badge shows the filtered ones in their place.
  function setHidden(pair, on) {
    pair.add.classList.toggle(HIDDEN_CLASS, on);
    pair.del.classList.toggle(HIDDEN_CLASS, on);
  }

  let generation = 0;

  async function update() {
    const pr = core.parsePullUrl(location.pathname);
    if (!pr || !settings) return;
    const pairs = findDiffstatPairs();
    if (pairs.length === 0) return;

    const gen = ++generation;
    let stats;
    try {
      stats = await getStats(pr);
    } catch (e) {
      if (gen !== generation) return;
      // Show the warning next to the biggest pair only (that is the PR total).
      const top = pairs.reduce((a, b) => (b.additions + b.deletions > a.additions + a.deletions ? b : a));
      setHidden(top, false);
      placeBadge(top, renderError(e.message || String(e)));
      return;
    }
    if (gen !== generation || core.parsePullUrl(location.pathname)?.number !== pr.number) return;

    for (const pair of pairs) {
      // Only the PR-wide diffstat is annotated; per-file stats never equal the totals.
      if (pair.additions !== stats.total.additions || pair.deletions !== stats.total.deletions) continue;
      if (stats.relevant) {
        placeBadge(pair, renderBadge(pair, stats));
        setHidden(pair, true);
      } else {
        setHidden(pair, false);
        const existing = pair.del.nextElementSibling;
        if (existing && existing.classList.contains(BADGE_CLASS)) existing.remove();
      }
    }
  }

  let timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  }

  // Our own badge insertions also trigger the observer; placeBadge is a no-op when
  // nothing changed, so this settles after one extra pass.
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType === 1 && !n.classList.contains(BADGE_CLASS)) return schedule();
        if (n.nodeType === 3) return schedule();
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  ext.storage.onChanged.addListener(async () => {
    pullCache.clear();
    filesCache.clear();
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((b) => b.remove());
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((e) => e.classList.remove(HIDDEN_CLASS));
    await loadSettings();
    schedule();
  });

  loadSettings().then(schedule);
})();
