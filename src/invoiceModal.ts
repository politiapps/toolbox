/**
 * invoiceModal.ts — Modal UI for generating an invoice from timesheet entries.
 */

import { App, Modal, Setting, Notice, TFile, setIcon } from "obsidian";
import type TasksPlugin from "./main";
import { TimesheetOrg } from "./settings";
import {
	generateInvoice,
	nextInvoiceLabel,
	aggregateEntries,
	customItemsTotal,
	CustomInvoiceItem,
} from "./invoiceGenerator";
import { parseTimesheet } from "./timesheetParser";

/** Format a Date as YYYY-MM-DD. */
function fmtDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/** Default "from" date: day after last invoice, or 30 days ago. */
function defaultDateFrom(org: TimesheetOrg): string {
	if (org.lastInvoiceDate) {
		const d = new Date(org.lastInvoiceDate);
		d.setDate(d.getDate() + 1);
		return fmtDate(d);
	}
	const d = new Date();
	d.setDate(d.getDate() - 30);
	return fmtDate(d);
}

export class InvoiceModal extends Modal {
	private plugin: TasksPlugin;
	private selectedOrg: TimesheetOrg | null = null;
	private dateFrom: string;
	private dateTo: string;
	private notes = "";
	private invoiceLabel = "";
	private invoiceNumber = 0;
	private serviceDescription = "Professional services";
	private customItems: CustomInvoiceItem[] = [];
	private previewEl: HTMLElement | null = null;

	constructor(app: App, plugin: TasksPlugin) {
		super(app);
		this.plugin = plugin;

		const today = fmtDate(new Date());
		this.dateTo = today;

		// Pick first org with entries, or first org in list
		const orgs = plugin.settings.timesheetOrgs;
		if (orgs.length > 0) {
			this.selectedOrg = orgs[0];
			this.dateFrom = defaultDateFrom(this.selectedOrg);
			this.updateInvoiceLabel();
		} else {
			this.dateFrom = defaultDateFrom({
				lastInvoiceDate: null,
				invoicePrefix: "INV",
				invoiceStartNumber: 1,
				lastInvoiceNumber: null,
			} as TimesheetOrg);
		}

		this.setTitle("Generate Invoice");
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		if (this.plugin.settings.timesheetOrgs.length === 0) {
			contentEl.createEl("p", {
				text: "No organisations configured. Add one in Settings → Timesheet → Organisations first.",
			});
			return;
		}

		// Org selector
		new Setting(contentEl)
			.setName("Organisation")
			.addDropdown((dd) => {
				for (const org of this.plugin.settings.timesheetOrgs) {
					dd.addOption(org.id, org.name);
				}
				dd.setValue(this.selectedOrg?.id ?? "");
				dd.onChange((val) => {
					const org = this.plugin.settings.timesheetOrgs.find(
						(o) => o.id === val,
					);
					if (org) {
						this.selectedOrg = org;
						this.dateFrom = defaultDateFrom(org);
						this.dateTo = fmtDate(new Date());
						this.updateInvoiceLabel();
						this.onOpen();
					}
				});
			});

		if (!this.selectedOrg) return;

		// Date from
		new Setting(contentEl)
			.setName("From date")
			.setDesc("Include entries on or after this date.")
			.addText((text) =>
				text
					.setValue(this.dateFrom)
					.setPlaceholder("YYYY-MM-DD")
					.onChange((val) => {
						this.dateFrom = val;
						this.updatePreview();
					}),
			);

		// Date to
		new Setting(contentEl)
			.setName("To date")
			.setDesc("Include entries on or before this date.")
			.addText((text) =>
				text
					.setValue(this.dateTo)
					.setPlaceholder("YYYY-MM-DD")
					.onChange((val) => {
						this.dateTo = val;
						this.updatePreview();
					}),
			);

		// Invoice number (read-only display)
		new Setting(contentEl)
			.setName("Invoice number")
			.setDesc("Auto-generated from org settings.")
			.addText((text) =>
				text.setValue(this.invoiceLabel).setDisabled(true),
			);

		// Description used for each tracked-hours line
		new Setting(contentEl)
			.setName("Line item description")
			.setDesc("Shown against each tracked-hours line on the invoice.")
			.addText((text) =>
				text
					.setValue(this.serviceDescription)
					.setPlaceholder("Professional services")
					.onChange((val) => {
						this.serviceDescription = val;
					}),
			);

		// Custom line items — anything beyond tracked hours
		contentEl.createEl("div", { cls: "invoice-items-label", text: "Custom items" });
		const itemsWrap = contentEl.createDiv({ cls: "invoice-items" });
		this.renderCustomItems(itemsWrap);
		const addItemBtn = contentEl.createEl("button", {
			cls: "invoice-items-add",
			text: "+ Add item",
		});
		addItemBtn.addEventListener("click", () => {
			this.customItems.push({ description: "", quantity: 1, rate: this.selectedOrg?.rate ?? 0 });
			this.renderCustomItems(itemsWrap);
			this.updatePreview();
		});

		// Notes
		new Setting(contentEl)
			.setName("Notes")
			.setDesc("Optional notes to include on the invoice.")
			.addTextArea((text) =>
				text
					.setValue(this.notes)
					.setPlaceholder("Payment terms, thank you message, etc.")
					.onChange((val) => {
						this.notes = val;
					}),
			);

		// Preview area — update on next tick so inputs are settled
		this.previewEl = contentEl.createDiv({ cls: "invoice-preview" });
		setTimeout(() => this.updatePreview(), 50);

		// Generate button
		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Generate Invoice")
				.setCta()
				.onClick(async () => {
					await this.doGenerate();
				}),
		);
	}

	private renderCustomItems(wrap: HTMLElement): void {
		wrap.empty();
		if (this.customItems.length === 0) {
			wrap.createDiv({
				cls: "invoice-items-empty",
				text: "Nothing extra. Add an item for anything beyond tracked hours.",
			});
			return;
		}
		this.customItems.forEach((item, i) => {
			const row = wrap.createDiv({ cls: "invoice-item-row" });

			const desc = row.createEl("input", { cls: "invoice-item-desc", type: "text" });
			desc.value = item.description;
			desc.placeholder = "Description";
			desc.addEventListener("input", () => {
				item.description = desc.value;
				this.updatePreview();
			});

			const qty = row.createEl("input", { cls: "invoice-item-num", type: "number" });
			qty.value = String(item.quantity);
			qty.min = "0";
			qty.step = "any";
			qty.setAttr("aria-label", "Quantity");
			qty.addEventListener("input", () => {
				item.quantity = parseFloat(qty.value) || 0;
				this.updatePreview();
			});

			const rate = row.createEl("input", { cls: "invoice-item-num", type: "number" });
			rate.value = String(item.rate);
			rate.min = "0";
			rate.step = "any";
			rate.setAttr("aria-label", "Rate");
			rate.addEventListener("input", () => {
				item.rate = parseFloat(rate.value) || 0;
				this.updatePreview();
			});

			const del = row.createEl("button", { cls: "invoice-item-del" });
			setIcon(del, "x");
			del.setAttr("aria-label", "Remove item");
			del.addEventListener("click", () => {
				this.customItems.splice(i, 1);
				this.renderCustomItems(wrap);
				this.updatePreview();
			});
		});
	}

	private updateInvoiceLabel(): void {
		if (!this.selectedOrg) return;
		const { number, label } = nextInvoiceLabel(this.selectedOrg);
		this.invoiceNumber = number;
		this.invoiceLabel = label;
	}

	private async updatePreview(): Promise<void> {
		if (!this.previewEl || !this.selectedOrg) return;
		this.previewEl.empty();

		const file = this.app.vault.getAbstractFileByPath(
			this.plugin.settings.timesheetFilePath,
		);
		if (!(file instanceof TFile)) {
			this.previewEl.createEl("p", {
				text: "No timesheet file yet. Track some time, or set the path in settings.",
				cls: "invoice-preview-empty",
			});
			return;
		}

		const content = await this.app.vault.read(file);
		const parsed = parseTimesheet(content);

		const { entries, totalHours, totalAmount } = aggregateEntries(
			parsed,
			this.selectedOrg.name,
			this.dateFrom,
			this.dateTo,
			this.selectedOrg.rate,
		);

		const customRows = this.customItems.filter((it) => it.description.trim());
		if (entries.length === 0 && customRows.length === 0) {
			this.previewEl.createEl("p", {
				text: "No entries for this org in this date range. Adjust the dates, or add a custom item.",
				cls: "invoice-preview-empty",
			});
			return;
		}

		const grandTotal = totalAmount + customItemsTotal(this.customItems);
		const parts: string[] = [];
		if (entries.length > 0) {
			parts.push(`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`);
		}
		if (customRows.length > 0) {
			parts.push(`${customRows.length} item${customRows.length === 1 ? "" : "s"}`);
		}
		parts.push(`${totalHours.toFixed(1)} h`);

		this.previewEl.createEl("span", { cls: "invoice-preview-eyebrow", text: "Preview" });
		const line = this.previewEl.createDiv({ cls: "invoice-preview-line" });
		line.createSpan({ cls: "invoice-preview-meta", text: parts.join(" · ") });
		line.createSpan({
			cls: "invoice-preview-amount",
			text: `$${grandTotal.toFixed(2)}`,
		});
	}

	private async doGenerate(): Promise<void> {
		if (!this.selectedOrg) {
			new Notice("Select an organisation first.");
			return;
		}

		if (!this.dateFrom || !this.dateTo) {
			new Notice("Set both From and To dates.");
			return;
		}

		if (this.dateFrom > this.dateTo) {
			new Notice("From date must be before or equal to To date.");
			return;
		}

		this.updateInvoiceLabel();

		try {
			const file = await generateInvoice(this.plugin, {
				org: this.selectedOrg,
				clientName: this.selectedOrg.clientName || this.selectedOrg.name,
				clientAddress: this.selectedOrg.clientAddress,
				dateFrom: this.dateFrom,
				dateTo: this.dateTo,
				invoiceNumber: this.invoiceNumber,
				invoiceLabel: this.invoiceLabel,
				notes: this.notes,
				serviceDescription: this.serviceDescription || "Professional services",
				customItems: this.customItems.filter((it) => it.description.trim()),
			});
			new Notice(`Invoice saved to ${file.path}`);
			this.close();
			// Open the PDF straight away in Obsidian's viewer.
			await this.app.workspace.getLeaf(true).openFile(file);
		} catch (err) {
			new Notice(err instanceof Error ? err.message : String(err));
		}
	}
}
