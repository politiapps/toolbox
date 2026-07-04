import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// The app reuses the plugin's Obsidian-free task logic straight from source via
// an alias, so Vite compiles it as first-party code (no separate build step) and
// the app can never drift from @toolbox/task-core.
const taskCore = fileURLToPath(new URL("../../packages/task-core/src/index.ts", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@toolbox/task-core": taskCore,
		},
	},
	server: {
		// Allow Vite to serve files from the monorepo (task-core lives above the app).
		fs: { allow: [repoRoot] },
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "es2020",
	},
});
