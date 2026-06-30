# Toolbox

Toolbox is an Obsidian plugin that bundles several utilities:

- **Tasks panel** — a sidebar to view, add, edit, complete, and delete tasks
  stored in an Obsidian Tasks plugin-compatible markdown file.
- **Timesheet** — a sidebar panel with a running timer, today's entries, and
  a weekly summary with hours, fractional days, and earnings by organisation.
- **Editable Columns** — Live Preview multi-column layouts using `%% columns %%`
  comment markers, with click-to-edit embeds.
- **Today's calendar** — merge one or more iCalendar (.ics) feeds into a compact
  sidebar list.

See [`documentation/ARCHITECTURE.md`](documentation/ARCHITECTURE.md) for the design.

## Development

```bash
npm install
npm run dev     # esbuild watch → rebuilds main.js on save
npm run build   # type-check + production build
```

To develop against a vault, junction the vault's plugin folder to this repo and
use [pjeby/hot-reload](https://github.com/pjeby/hot-reload):

```powershell
cmd /c mklink /J "C:\Path\To\DevVault\.obsidian\plugins\toolbox" "C:\Projects\Coding_Projects\Toolbox"
```

## Branch model

| Branch | Purpose                              | Release tag       | Pre-release |
| ------ | ------------------------------------ | ----------------- | ----------- |
| `main` | Stable releases for the main vault   | `1.0.1`, `1.1.0`  | No          |
| `beta` | Development / pre-release testing    | `1.0.0-beta.1`    | Yes         |

Day-to-day work happens on `beta`. When a beta is solid, merge `beta` → `main`
and cut a stable release.

## Releasing

Releases are automated by [`.github/workflows/release.yml`](.github/workflows/release.yml).
When you **publish a GitHub Release**, the workflow checks out the tagged commit,
runs `npm run build`, and attaches `main.js`, `manifest.json`, and `styles.css`
to that release. You never upload build artifacts by hand.

### Cut a beta (pre-release)

1. Push your work to `beta`.
2. Set `manifest.json` `version` to the **same string as the tag** below, and
   make sure it is **strictly greater** than the last released version. BRAT only
   updates when the manifest version increases, and prereleases rank below their
   release (`1.0.1-beta.1` < `1.0.1` but > `1.0.0`), so a beta series toward
   stable `1.0.1` goes `1.0.1-beta.1`, `1.0.1-beta.2`, … then `1.0.1`.
3. Create a GitHub Release:
   - **Target:** `beta`
   - **Tag:** the same pre-release semver, e.g. `1.0.1-beta.1`
   - **Set as a pre-release:** ✅ checked
4. Publish. CI attaches the three assets.

### Cut a stable release

1. Merge `beta` → `main`.
2. Set `manifest.json` `version` to the stable version (e.g. `1.0.1`) and add it
   to `versions.json` with the supported `minAppVersion`. `npm version patch`
   does both via `version-bump.mjs`.
3. Create a GitHub Release:
   - **Target:** `main`
   - **Tag:** the stable version, e.g. `1.0.1` (no `v` prefix — Obsidian convention)
   - **Set as a pre-release:** ⬜ unchecked
4. Publish. CI attaches the three assets.

> The release **tag** should match `manifest.json` `version` for stable releases.
> For betas, BRAT installs the latest pre-release regardless, but keeping them
> aligned avoids confusion.

## Installing with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs and auto-updates
plugins straight from GitHub releases.

1. Install **Obsidian42 - BRAT** from Community Plugins and enable it.
2. BRAT → **Add Beta Plugin**.
3. Repository: `politiapps/toolbox`.
4. Choose the channel:
   - **Dev vault:** enable “Enable beta versions” so BRAT tracks the latest
     **pre-release** (`*-beta.*`) cut from `beta`.
   - **Main vault:** leave beta versions off so BRAT tracks the latest **stable**
     release cut from `main`.
5. BRAT installs it and checks for updates on Obsidian startup.

Manual install (no BRAT): copy `main.js`, `manifest.json`, and `styles.css` from
a release into `<vault>/.obsidian/plugins/toolbox/`.
