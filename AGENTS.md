# Split Tile Card: Agent Instructions

Split Tile Card is a Home Assistant dashboard card: a tile split into a toggle and a chevron that opens a view, a more-info dialog or a pop-up of cards. It is for anyone running Home Assistant, ships through HACS as a Dashboard (plugin) repository, is MIT licensed, and builds on no shared kit.

## Standards

This repo follows the shared standards at https://github.com/Dynamic-Solutions-Canada/app-standards. Read the index for this stack, https://github.com/Dynamic-Solutions-Canada/app-standards/blob/main/stacks/home-assistant.md, then the topic file for the area you are changing. If `external/standards/` exists, it is the same content pinned for offline use. Where this file differs from the standards, this file wins and says why. The Home Assistant stack is written for an integration; this repo is a dashboard card, so the `custom_components/` layout, `manifest.json` and brand rules do not apply, and the HACS listing is `hacs.json` plus the README at the root.

## Architecture

| Area | Files |
| --- | --- |
| The card, its visual editor and the pop-up | `split-tile-card.js` |
| HACS listing | `hacs.json`, `README.md` |
| README screenshot | `store-assets/web/screenshots/` |
| The gate | `scripts/check.mjs` |
| Release notes | `release-notes/<version>.md` |
| CI and release | `.github/workflows/ci.yml`, `.github/workflows/release.yml` |

## Behaviour

- Two state indicators, set by `indicator` and reflected on the host as the `indicator` attribute: `icon` (the default, what most users expect from Home Assistant tiles: the icon in a circle, coloured when on) and `bar` (a bar down the left edge, grey optional icons). Both are supported long term; style changes must keep both working.
- A tile counts as on when any configured entity's state is `on`. The editor offers only the domains in `DOMAINS`, because other domains (covers, media players) never read as on.
- Room tiles (with `navigation_path`) turn lights on at `brightness_pct` 100 by default; other tiles turn them on with no brightness, so they come back at their last level. `brightness_pct: null` keeps the last level on a room tile, and the editor preserves it.
- The pop-up is appended to `document.body` so no layout clips it. Events its cards fire are re-dispatched from the card (`FORWARDED`), because Home Assistant only listens inside its own tree. A card event added to Home Assistant later may need adding there.
- The custom element names and the `--split-tile-on-color` variable are public: users' dashboards and themes refer to them, so they are never renamed.

## Conventions and gotchas

- One file, no build step and no dependencies: HACS serves `split-tile-card.js` as committed. Keep it that way unless a build becomes necessary.
- The `VERSION` constant in the card must equal `version` in `package.json`; the gate fails otherwise.
- Elements are defined only if not already defined, so a second copy (HACS plus a leftover `/local/` resource) does not throw.
- User-facing strings are in `STRINGS` at the top of the card. Entity states use `hass.formatEntityState`, so they follow the user's language.

## Commands

| Command | Proves | Does not prove |
| --- | --- | --- |
| `npm run validate` | The card parses, and its version matches `package.json` and `hacs.json` | That it renders or works in Home Assistant; load it as a dashboard resource and check by hand |

CI also runs the HACS action, which checks the repo layout and `hacs.json` the way the HACS default store does.

## Release

Bump `version` in `package.json` and `VERSION` in the card, write `release-notes/<version>.md` (user-facing bullets only), commit, and push an annotated `v<version>` tag. `.github/workflows/release.yml` runs the gate, checks the tag against `package.json` and the notes file, and creates the GitHub Release with the card attached. HACS offers the update from the Release.

## Guidance map

| Guide, doc, or skill | Read or use when | Governs |
| --- | --- | --- |
| `README.md` | Changing an option, its default or the install steps | What users read in HACS and on GitHub |

## Keeping docs current

| What changed | Update |
| --- | --- |
| An option, a default or a supported domain | The configuration table and examples in `README.md`, and the header comment in `split-tile-card.js` |
| The minimum Home Assistant version | `hacs.json` and `## Requirements` in `README.md` |
| How the tile looks | Both README screenshots in `store-assets/web/screenshots/`: `tiles.png` (icon indicator) and `tiles-bar.png` (bar) |
