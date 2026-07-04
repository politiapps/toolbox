/**
 * The seam between the app and the user's Obsidian vault.
 *
 * The app holds a one-time SAF *folder* grant on the vault, so it can read both
 * the tasks file and the plugin's data.json (for categories) by relative path —
 * no per-file picking, and categories mirror Obsidian automatically. In a desktop
 * browser this is backed by localStorage so the whole UI is exercisable.
 */

/** A handle to the chosen vault folder: an opaque tree URI plus a display name. */
export interface VaultRef {
	uri: string;
	name: string;
}

/** Vault-relative path to the Obsidian Toolbox plugin's settings. */
export const DATA_JSON_PATH = ".obsidian/plugins/toolbox/data.json";

export interface StorageAdapter {
	/** True when running inside the native Android shell. */
	isNative(): boolean;

	/** Prompt the user to choose their vault folder. Null if they cancel. */
	pickVault(): Promise<VaultRef | null>;

	/** Whether we still hold read/write permission for `vault`. */
	hasVaultAccess(vault: VaultRef): Promise<boolean>;

	/** Read a vault-relative file as UTF-8 text, or null if it doesn't exist. */
	readFile(vault: VaultRef, relPath: string): Promise<string | null>;

	/** Overwrite a vault-relative file with `content` (UTF-8), creating it if needed. */
	writeFile(vault: VaultRef, relPath: string, content: string): Promise<void>;
}
