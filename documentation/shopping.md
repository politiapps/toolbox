# Shopping list

Open the existing **Tasks** panel, then choose **Shopping** in its view switcher
(next to All, Today and This week). Android uses the same switcher after linking
a vault. **Toolbox: Open shopping list** also selects Shopping inside Tasks.

Both use the same interface and `shopping-list.json` at the vault root. Include
that file in your existing vault sync. This feature does not provide a sync
service. Use **Refresh** after changes on another device. Existing `#shopping`
tasks remain tasks; they are not automatically migrated or duplicated.

- Use the Tasks **+** button to open the add dialog, or a store section’s **+**
  to pre-fill its store. Enter an item and an optional quantity/note. Leave category blank for automatic
  classification. Known items use Produce, Bakery, Meat & seafood, Pantry,
  Household, Dairy & eggs, Frozen, or Hardware. Unknown items use Other.
- Leave store blank to use Grocery (or Hardware store for recognised hardware).
  Enter Woolworths, a specialist shop, or any other name to assign a specific
  store. Suggestions remember stores/categories used before.
- Enter any category to override classification, including custom aisle names.
  Click an item name or its pencil action to edit its name, quantity, store or
  category in the same dialog.
- The list groups by store, then aisle. Standard aisles follow the shared order
  above; custom categories follow alphabetically. Use the store filter to show
  just the shop you are visiting. Store sections collapse like task sections and
  remember their collapse state. Checked items move to **Purchased**, collapsed
  by default. Expand it to review or uncheck an item.
- Check purchases, then **Finish purchased** to move the checked items in the
  current store filter into history. Uncheck to undo before finishing.
- **Staples** opens a searchable picker of previous items not currently on the
  list, ranked by number of list additions, with alphabetical ties. Its **+**
  action restores the remembered
  store, category and quantity. Frequency counts additions, not checkbox toggles
  or quantity purchased. The same item at two stores has separate history.
- **Remove from list** in the edit dialog asks for confirmation and retains
  the item in staples; it does not delete history.

Automatic classification uses an offline keyword dictionary, not a product
catalogue. Review ambiguous products and override their category as needed.
Aisle order and the vault-root filename are currently fixed defaults.

The versioned JSON stores stable item IDs, active/checked status and frequency.
Writes re-read the latest file, serialize local mutations, reject stale item
edits, and check for observed external changes before saving. Invalid or newer
file formats are rejected without replacing their content. These checks do not
provide atomic cross-device transactions: avoid editing the file simultaneously
on multiple devices and use your sync tool's conflict recovery if needed.
