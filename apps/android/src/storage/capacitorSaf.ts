import { registerPlugin } from "@capacitor/core";
import type { StorageAdapter, VaultRef } from "./types";

/**
 * Native side of the SAF adapter. Implemented by the Kotlin/Java `SafFiles`
 * plugin. Uses a folder (tree) grant so files are addressed by relative path.
 */
interface SafFilesPlugin {
	/** Opens ACTION_OPEN_DOCUMENT_TREE; resolves with the picked folder or uri=null. */
	pickFolder(): Promise<{ uri: string | null; name: string | null }>;
	hasTreePermission(options: { uri: string }): Promise<{ granted: boolean }>;
	readTreeFile(options: { treeUri: string; path: string }): Promise<{ found: boolean; data: string | null }>;
	writeTreeFile(options: { treeUri: string; path: string; data: string }): Promise<void>;
}

const SafFiles = registerPlugin<SafFilesPlugin>("SafFiles");

export class CapacitorSafAdapter implements StorageAdapter {
	isNative(): boolean {
		return true;
	}

	async pickVault(): Promise<VaultRef | null> {
		const res = await SafFiles.pickFolder();
		if (!res.uri) return null;
		return { uri: res.uri, name: res.name ?? "Vault" };
	}

	async hasVaultAccess(vault: VaultRef): Promise<boolean> {
		try {
			return (await SafFiles.hasTreePermission({ uri: vault.uri })).granted;
		} catch {
			return false;
		}
	}

	async readFile(vault: VaultRef, relPath: string): Promise<string | null> {
		const res = await SafFiles.readTreeFile({ treeUri: vault.uri, path: relPath });
		return res.found ? (res.data ?? "") : null;
	}

	async writeFile(vault: VaultRef, relPath: string, content: string): Promise<void> {
		await SafFiles.writeTreeFile({ treeUri: vault.uri, path: relPath, data: content });
	}
}
