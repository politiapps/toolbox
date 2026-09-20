import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { ShoppingStore, SHOPPING_PATH } from "@toolbox/task-core";
import { mountShopping } from "../packages/shopping-ui/panel";
export const VIEW_TYPE_SHOPPING = "toolbox-shopping";
export class ShoppingView extends ItemView {
	private cleanup?: () => void;
	constructor(
		leaf: WorkspaceLeaf,
		private store: ShoppingStore,
	) {
		super(leaf);
	}
	getViewType(): string {
		return VIEW_TYPE_SHOPPING;
	}
	getDisplayText(): string {
		return "Shopping list";
	}
	getIcon(): string {
		return "shopping-cart";
	}
	async onOpen(): Promise<void> {
		this.cleanup = mountShopping(this.contentEl, this.store);
	}
	async onClose(): Promise<void> {
		this.cleanup?.();
	}
}
export function vaultShoppingStore(app: ItemView["app"]): ShoppingStore {
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
