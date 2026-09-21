# GitHub PR Diffstat Filter

A browser extension (Chrome/Chromium and Firefox, Manifest V3) that adds a second diffstat next to
GitHub's PR line counts. The second count leaves out files that match your patterns, such as lockfiles:

```
+25,202 −56,795 (+71 −211 w/o 2 files)
```

Hover over the added part to see which files were excluded and their line counts. The extra count
appears only when at least one file matches **and** at least one doesn't, so a PR that only
bumps `flake.lock` keeps GitHub's plain numbers.

It works in the PR header on every PR tab (conversation, commits, checks) and in the classic
"Files changed" diffstat.

## Install

Chrome / Chromium / Brave / Edge:
1. `chrome://extensions` → enable *Developer mode* → *Load unpacked* → pick this directory.

Firefox (121+):
1. `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick `manifest.json`.
   This install is removed when Firefox restarts. For a permanent install, sign the add-on
   through addons.mozilla.org (it can stay unlisted), e.g. with `web-ext sign`.

Then open the extension's options to adjust the patterns and, optionally, add a token.

## Options

**Excluded paths**: one gitignore-style pattern per line. Matching is case-insensitive.

| Pattern             | Matches                                           |
|---------------------|---------------------------------------------------|
| `flake.lock`        | `flake.lock` in any directory                     |
| `nix/flake.lock`    | only at that path from the repo root              |
| `*.snap`            | any `.snap` file, at any depth                    |
| `vendor/`           | everything under any `vendor` directory           |
| `docs/**/gen.md`    | `docs/gen.md`, `docs/a/b/gen.md`, …               |

Defaults: common lockfiles (`flake.lock`, `Cargo.lock`, `package-lock.json`, `yarn.lock`,
`pnpm-lock.yaml`, `bun.lock`, `go.sum`, `poetry.lock`, `uv.lock`, `Gemfile.lock`, `composer.lock`).

**GitHub token**: optional. The extension calls the REST API: `GET /pulls/:n` on each PR view,
and `GET /pulls/:n/files` (one request per 100 files) only when the head commit changes. Without
a token that works for public repos up to the 60 requests/hour limit. For more headroom or for
private repos, create a
[fine-grained token](https://github.com/settings/personal-access-tokens/new) with read-only
access:
- public repos only: *Repository access → Public repositories*, no permissions needed;
- private repos: select them and grant *Pull requests: Read-only*.

The token lives in `storage.local` (never synced) and is only sent to `api.github.com`.

## Notes

- GitHub's files API lists at most 3000 files. The extension subtracts the excluded files from
  the PR totals, so any files past that limit count as kept (the tooltip says when that happens).
- Only github.com is supported. GitHub Enterprise would need its own host in `manifest.json` and
  its own API base URL.
- If a request fails (rate limit, private repo without a token, bad token), a ⚠ appears next to
  the diffstat. Its tooltip gives the reason.
- The extension finds the diffstat by GitHub's success/danger colour classes and only annotates
  pairs whose numbers equal the PR totals from the API. If GitHub changes its markup,
  `findDiffstatPairs` in `src/content.js` is the place to update.

## Development

```sh
npm install        # Playwright, only needed for the e2e check
npm test           # unit tests for pattern matching and the arithmetic
GH_TOKEN=... npm run e2e -- https://github.com/logos-co/logos-chat-module/pull/76
npm run package    # zip for store upload
```
