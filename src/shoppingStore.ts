import { App, TFile } from "obsidian";
import { ShoppingStore, SHOPPING_PATH } from "@toolbox/task-core";
export function vaultShoppingStore(app: App): ShoppingStore {
	return new ShoppingStore(
		async () => {
			const file = app.vault.getAbstractFileByPath(SHOPPING_PATH);
			if (!file) return null;
			if (!(file instanceof TFile))
				throw new Error("Shopping path is a folder.");
			return app.vault.read(file);
		},
		async (text) => {
			const file = app.vault.getAbstractFileByPath(SHOPPING_PATH);
			if (file instanceof TFile) await app.vault.modify(file, text);
			else if (!file) await app.vault.create(SHOPPING_PATH, text);
			else throw new Error("Shopping path is a folder.");
		},
	);
}
