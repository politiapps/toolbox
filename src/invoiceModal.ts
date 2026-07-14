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

/** Friendly long date for the picker chip, e.g. "Wednesday, 1 July 2026". */
function formatNiceDate(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	if (!y || !m || !d) return iso;
	return new Date(y, m - 1, d).toLocaleDateString(undefined, {
		weekday: "long",
		day: "numeric",
		month: "long",
		year: "numeric",
	});
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
	private issueDate: string;
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
		this.issueDate = today;

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

		// Date range — real date pickers (same chip used in the timesheet form) so
		// the value is always a valid zero-padded YYYY-MM-DD. Typing an unpadded
		// date like "2026-07-1" here previously broke the string-based filter.
		this.buildDateField(
			contentEl,
			"From date",
			() => this.dateFrom,
			(v) => (this.dateFrom = v),
		);
		this.buildDateField(
			contentEl,
			"To date",
			() => this.dateTo,
			(v) => (this.dateTo = v),
		);

		// Issue date — the date printed on the invoice (defaults to today, editable).
		this.buildDateField(
			contentEl,
			"Invoice date",
			() => this.issueDate,
			(v) => (this.issueDate = v),
		);

		// Invoice number — editable so you can reissue/redo an invoice (e.g. set it
		// back to 001) instead of the number only ever advancing.
		new Setting(contentEl)
			.setName("Invoice number")
			.setDesc("Editable — change it to reissue a previous invoice.")
			.addText((text) =>
				text
					.setValue(String(this.invoiceNumber))
					.onChange((val) => {
						const n = parseInt(val, 10);
						if (!isNaN(n) && n > 0) {
							this.invoiceNumber = n;
							this.invoiceLabel = this.labelFor(n);
						}
					}),
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

	/** Build an invoice label for a given number using the selected org's prefix. */
	private labelFor(n: number): string {
		const prefix = this.selectedOrg?.invoicePrefix || "INV";
		return `${prefix}-${String(n).padStart(3, "0")}`;
	}

	/**
	 * Render a clickable date-picker chip (reusing the timesheet form's styling).
	 * The native `type="date"` input guarantees a valid zero-padded YYYY-MM-DD,
	 * which the string-based date filter relies on.
	 */
	private buildDateField(
		parent: HTMLElement,
		labelText: string,
		get: () => string,
		set: (v: string) => void,
	): void {
		parent.createEl("div", { cls: "timesheet-form-label", text: labelText });
		const field = parent.createDiv({ cls: "timesheet-date-field" });
		setIcon(field.createSpan({ cls: "timesheet-date-icon" }), "calendar");
		const display = field.createSpan({ cls: "timesheet-date-display" });
		setIcon(field.createSpan({ cls: "timesheet-date-caret" }), "chevron-down");
		const input = field.createEl("input", { cls: "timesheet-date-input", type: "date" });
		input.value = get();
		const sync = (): void => {
			display.textContent = formatNiceDate(get());
		};
		sync();
		field.addEventListener("click", () => {
			const picker = input as unknown as { showPicker?: () => void };
			try {
				picker.showPicker?.();
			} catch (_) {
				/* not user-activated or unsupported — the field is still typable */
			}
		});
		input.addEventListener("change", () => {
			if (input.value) {
				set(input.value);
				sync();
				this.updatePreview();
			}
		});
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

		// Keep the label in sync with the (possibly user-edited) number. We do NOT
		// call updateInvoiceLabel() here — that would reset the number to the next
		// auto-increment and defeat reissuing an earlier invoice.
		this.invoiceLabel = this.labelFor(this.invoiceNumber);

		try {
			const file = await generateInvoice(this.plugin, {
				org: this.selectedOrg,
				clientName: this.selectedOrg.clientName || this.selectedOrg.name,
				clientAddress: this.selectedOrg.clientAddress,
				dateFrom: this.dateFrom,
				dateTo: this.dateTo,
				issueDate: this.issueDate,
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
