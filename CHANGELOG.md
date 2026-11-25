# Changelog

## 0.2.0 (2026-11-25)

First tagged release.

### Added

- **Left to review**: once files are marked as *Viewed*, a pill to the left of the diffstat
  shows the line counts without the viewed files and a pie with the share of lines already
  reviewed. It turns into a green *✓ viewed* when nothing is left. Needs a token, and can be
  switched off in the options. (#1, #2)
- **Tokens for specific organizations**: one token per organization or user name, used for
  every request about a PR in that owner's repositories. The default token is used everywhere
  else. *Check tokens* tests all of them, and the ⚠ tooltip says which token was used. (#3)

### Changed

- The options open as a popup from the extension's toolbar icon instead of in a full tab. (#4)

## 0.1.0 (2026-09-21)

Initial version, not tagged.

- Replaces GitHub's PR line counts with counts that leave out files matching gitignore-style
  patterns (common lockfiles by default). The original counts stay next to them in brackets.
- Optional GitHub token for more API headroom and for private repositories.
