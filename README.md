# Tasks Panel

An Obsidian sidebar panel to view, add, edit, complete, and delete tasks stored
in a single Obsidian Tasks plugin-compatible markdown file. See
[`documentation/ARCHITECTURE.md`](documentation/ARCHITECTURE.md) for the design.

## Development

```bash
npm install
npm run dev     # esbuild watch → rebuilds main.js on save
npm run build   # type-check + production build
```

To develop against a vault, junction the vault's plugin folder to this repo and
use [pjeby/hot-reload](https://github.com/pjeby/hot-reload):

```powershell
cmd /c mklink /J "C:\Path\To\DevVault\.obsidian\plugins\tasker" "C:\Projects\Coding_Projects\Tasks-plugin"
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
2. Bump `manifest.json` `version` if appropriate (e.g. `1.0.0`).
3. Create a GitHub Release:
   - **Target:** `beta`
   - **Tag:** a pre-release semver, e.g. `1.0.0-beta.1`
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
3. Repository: `politiapps/tasker`.
4. Choose the channel:
   - **Dev vault:** enable “Enable beta versions” so BRAT tracks the latest
     **pre-release** (`*-beta.*`) cut from `beta`.
   - **Main vault:** leave beta versions off so BRAT tracks the latest **stable**
     release cut from `main`.
5. BRAT installs it and checks for updates on Obsidian startup.

Manual install (no BRAT): copy `main.js`, `manifest.json`, and `styles.css` from
a release into `<vault>/.obsidian/plugins/tasker/`.
