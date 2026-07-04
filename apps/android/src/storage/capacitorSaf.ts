import { registerPlugin } from "@capacitor/core";
import type { StorageAdapter, TasksFileRef } from "./types";

/**
 * Native side of the SAF adapter. Implemented by the Kotlin `SafFiles` plugin
 * in android/app/src/main/java/.../SafFilesPlugin.kt.
 */
interface SafFilesPlugin {
	/** Opens ACTION_OPEN_DOCUMENT; resolves with the picked file or uri=null. */
	pickFile(): Promise<{ uri: string | null; name: string | null }>;
	/** True if we still hold a persisted read/write grant for `uri`. */
	hasPermission(options: { uri: string }): Promise<{ granted: boolean }>;
	readFile(options: { uri: string }): Promise<{ data: string }>;
	writeFile(options: { uri: string; data: string }): Promise<void>;
}

const SafFiles = registerPlugin<SafFilesPlugin>("SafFiles");

export class CapacitorSafAdapter implements StorageAdapter {
	isNative(): boolean {
		return true;
	}

	async pickFile(): Promise<TasksFileRef | null> {
		const res = await SafFiles.pickFile();
		if (!res.uri) return null;
		return { uri: res.uri, name: res.name ?? "tasks.md" };
	}

	async hasAccess(ref: TasksFileRef): Promise<boolean> {
		try {
			const { granted } = await SafFiles.hasPermission({ uri: ref.uri });
			return granted;
		} catch {
			return false;
		}
	}

	async read(ref: TasksFileRef): Promise<string> {
		const { data } = await SafFiles.readFile({ uri: ref.uri });
		return data;
	}

	async write(ref: TasksFileRef, content: string): Promise<void> {
		await SafFiles.writeFile({ uri: ref.uri, data: content });
	}
}
