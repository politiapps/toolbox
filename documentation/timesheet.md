# Timesheet

A sidebar panel for tracking work sessions with a running timer.

## Quick start

1. Open **Settings → Toolbox → Timesheet**.
2. Set the file path (defaults to `timesheet.md`).
3. Add at least one **organisation** with a name, colour, and optional hourly rate.
4. Click the **clock icon** in the ribbon (or run the `Open timesheet` command).

## Features

### Running timer

- Select an org from the dropdown, click **Start**.
- While working: click **Break** to start a break, **Stop** to finish and save.
- While on break: click **Resume** to end the break and return to working.
- The timer state persists across Obsidian restarts (start a session, close
  Obsidian, reopen — the timer picks up where it left off).

### Manual entry

Click the **+** button in the header to manually add an entry with times and
breaks. Useful for backfilling or corrections.

### Today's entries

Shows all entries for the current day with:
- Colour-coded org dot
- Time range and total hours
- Indented break lines
- Edit and delete actions (revealed on hover)

### Weekly summary

Groups all entries from Monday–Sunday of the current week by organisation.
Each org row shows:
- Total hours worked
- Fractional days (1 day = 7 hours)
- Estimated earnings (rate × hours)

Grand total and total earnings at the bottom.

## File format

The timesheet file uses human-readable markdown:

```markdown
## 2024-06-30

- 🕐 09:00–17:00 (Org Name)
  - ☕ 12:00–12:30
  - ☕ 14:45–15:00

## 2024-07-01

- 🕐 08:00–12:00 (Other Org)
- 🕐 13:00–17:00 (Org Name)
  - ☕ 13:30–14:00
```

- `## YYYY-MM-DD` — day header
- `- 🕐 HH:MM–HH:MM (Org Name)` — work session
- `  - ☕ HH:MM–HH:MM` — break (indented under its session, can have multiple)

The file is both human-editable and plugin-managed (like the tasks file).
Manual edits are picked up automatically when the file changes.

### Invoice export

The **Generate invoice** button (or `Generate invoice from timesheet` command) opens a
modal that aggregates timesheet entries for a selected org and date range into a
formatted markdown invoice.

**Global invoice settings** (Settings → Toolbox → Invoice):
- Business name, ABN, business address (your details).
- Bank name, BSB, account number (appears in the Payment Details section).
- Output folder (default `toolbox/Invoices/`, auto-created).

**Per-org invoice settings** (under each organisation):
- Client name, client address.
- Invoice prefix (e.g. `INV`) and starting number.
- Last invoice date/number (auto-tracked).

The invoice number format is `{prefix}-{number:03d}` (e.g. `INV-001`).
Date range defaults from the day after the last invoice to today.
Invoices are saved as markdown in the configured output folder with no file auto-open.

## Settings

| Setting | Description |
|---|---|
| Timesheet file path | Path to the timesheet markdown file |
| Organisations | List of orgs with name, colour picker, hourly rate, client details, and invoice numbering |
| Invoice · Business name | Your business name (appears on invoices) |
| Invoice · ABN | Your Australian Business Number |
| Invoice · Business address | Your business address |
| Invoice · Bank name | Name of your bank (for Payment Details) |
| Invoice · BSB | Bank BSB number |
| Invoice · Account number | Bank account number |
| Invoice · Output folder | Folder for generated invoices (default `toolbox/Invoices/`) |

The colour is used for the dot next to entries and weekly summary rows.
The rate is used to calculate estimated earnings and invoice amounts.
