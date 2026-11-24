// Pure logic shared by the content script, the options page and the tests.
(function (root) {
  const DEFAULT_PATTERNS = [
    '# One pattern per line, gitignore-style. Matching is case-insensitive.',
    '# "name" matches at any depth, "dir/name" is anchored to the repo root,',
    '# "*" stays within a path segment, "**" crosses segments, "dir/" means everything below.',
    'flake.lock',
    'Cargo.lock',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'go.sum',
    'poetry.lock',
    'uv.lock',
    'Gemfile.lock',
    'composer.lock',
  ].join('\n');

  function escapeRegex(s) {
    return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  // Converts one gitignore-style pattern into a RegExp over repo-relative paths.
  function globToRegExp(pattern) {
    let p = pattern.trim();
    if (!p || p.startsWith('#')) return null;

    let dirOnly = false;
    if (p.endsWith('/')) {
      dirOnly = true;
      p = p.replace(/\/+$/, '');
    }
    const anchored = p.startsWith('/') || p.includes('/');
    p = p.replace(/^\/+/, '');

    let re = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '*') {
        if (p[i + 1] === '*') {
          i++;
          if (p[i + 1] === '/') {
            i++;
            re += '(?:.*/)?';
          } else {
            re += '.*';
          }
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else {
        re += escapeRegex(c);
      }
    }

    const prefix = anchored ? '' : '(?:.*/)?';
    const suffix = dirOnly ? '/.*' : '(?:/.*)?';
    return new RegExp('^' + prefix + re + suffix + '$', 'i');
  }

  function parsePatterns(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(globToRegExp)
      .filter(Boolean);
  }

  function isExcluded(path, matchers) {
    return matchers.some((m) => m.test(path));
  }

  // pr: { additions, deletions, changed_files }, files: [{ filename, additions, deletions }]
  // viewed: optional Set of paths the viewer has marked as "Viewed" (null when unknown).
  function computeStats(pr, files, matchers, viewed) {
    const excluded = { additions: 0, deletions: 0, files: [] };
    const kept = [];
    for (const f of files) {
      const entry = { filename: f.filename, additions: f.additions, deletions: f.deletions };
      if (isExcluded(f.filename, matchers)) {
        excluded.additions += f.additions;
        excluded.deletions += f.deletions;
        excluded.files.push(entry);
      } else {
        kept.push(entry);
      }
    }
    const keptFiles = kept.length;
    // The files endpoint lists at most 3000 files; subtracting from the PR totals
    // keeps the result right for the files we did not see (they count as kept).
    const truncated = files.length < pr.changed_files;
    const unseen = Math.max(0, pr.changed_files - files.length);
    const filtered = {
      additions: pr.additions - excluded.additions,
      deletions: pr.deletions - excluded.deletions,
    };
    // Nothing worth showing: no file matched, or every file matched.
    const relevant = excluded.files.length > 0 && keptFiles + unseen > 0;
    return {
      total: { additions: pr.additions, deletions: pr.deletions },
      excluded,
      filtered,
      keptFiles: keptFiles + unseen,
      truncated,
      relevant,
      // What is left to review is measured against the numbers on display: the filtered
      // ones when the filter applies, otherwise the PR totals.
      review: viewed
        ? computeReview(relevant ? filtered : pr, relevant ? kept : kept.concat(excluded.files), unseen, viewed)
        : null,
    };
  }

  // base: { additions, deletions } of the files under review; unseen files count as not viewed.
  // Returns null when none of the files is viewed, so there is nothing to add to the diffstat.
  function computeReview(base, files, unseen, viewed) {
    const viewedFiles = files.filter((f) => viewed.has(f.filename));
    if (viewedFiles.length === 0) return null;
    const sum = (key) => viewedFiles.reduce((n, f) => n + f[key], 0);
    const totalFiles = files.length + unseen;
    const left = {
      additions: base.additions - sum('additions'),
      deletions: base.deletions - sum('deletions'),
      files: totalFiles - viewedFiles.length,
    };
    const lines = base.additions + base.deletions;
    return {
      viewedFiles,
      totalFiles,
      left,
      done: left.files === 0,
      // Share of the work already viewed, by lines (by files when there are no lines, e.g. renames).
      progress: lines > 0 ? (lines - left.additions - left.deletions) / lines : viewedFiles.length / totalFiles,
    };
  }

  function parseCount(text) {
    const m = String(text).trim().match(/^[+\-−]?\s*([\d,]+)$/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  }

  // Matches /owner/repo/pull/123 and any sub-page (/files, /commits, /changes, ...).
  function parsePullUrl(pathname) {
    const m = pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/);
    return m ? { owner: m[1], repo: m[2], number: Number(m[3]) } : null;
  }

  const api = { DEFAULT_PATTERNS, globToRegExp, parsePatterns, isExcluded, computeStats, parseCount, parsePullUrl };
  root.DiffstatCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
