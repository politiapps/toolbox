import { Capacitor } from "@capacitor/core";
import type { StorageAdapter } from "./types";
import { CapacitorSafAdapter } from "./capacitorSaf";
import { WebFileAdapter } from "./webFile";

export type { StorageAdapter, TasksFileRef } from "./types";

let cached: StorageAdapter | null = null;

/** The storage adapter for the current platform (native SAF, or browser dev). */
export function getStorage(): StorageAdapter {
	if (!cached) {
		cached = Capacitor.isNativePlatform() ? new CapacitorSafAdapter() : new WebFileAdapter();
	}
	return cached;
}
