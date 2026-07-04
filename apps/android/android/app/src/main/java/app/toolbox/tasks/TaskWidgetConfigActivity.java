package app.toolbox.tasks;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.Spinner;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * Shown when a widget is dropped: choose how it groups (category / date / none),
 * which categories and date buckets to include, and the sort order. Several
 * categories or buckets combine into one view, like Obsidian.
 */
public class TaskWidgetConfigActivity extends Activity {

    private static final String[][] BUCKETS = {
        { "overdue", "Overdue" }, { "today", "Today" }, { "week", "This week" },
        { "later", "Later" }, { "none", "No date" }
    };

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;

    private RadioGroup groupRadio;
    private Spinner sortSpinner;
    private final List<CheckBox> catBoxes = new ArrayList<>();
    private final List<String> catIds = new ArrayList<>();
    private final List<CheckBox> bucketBoxes = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        setContentView(R.layout.widget_config);

        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            widgetId = extras.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        }
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        LinearLayout list = findViewById(R.id.config_list);

        addHeading(list, "Group by");
        groupRadio = new RadioGroup(this);
        groupRadio.addView(radio("Category", 1, true));
        groupRadio.addView(radio("Date (Today / This week)", 2, false));
        groupRadio.addView(radio("Don't group", 3, false));
        list.addView(groupRadio);

        addHeading(list, "Sort");
        sortSpinner = new Spinner(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(
            this, android.R.layout.simple_spinner_dropdown_item,
            new String[] { "Due date", "Priority", "Priority, then due date" }
        );
        sortSpinner.setAdapter(adapter);
        list.addView(sortSpinner);

        addHeading(list, "Categories (none ticked = all)");
        List<String[]> cats = WidgetCache.categories(this);
        if (cats.isEmpty()) {
            addNote(list, "Open the app once so your categories appear here.");
        } else {
            for (String[] c : cats) {
                CheckBox cb = checkbox(c[1], true);
                list.addView(cb);
                catBoxes.add(cb);
                catIds.add(c[0]);
            }
        }

        addHeading(list, "Dates (none ticked = all)");
        for (String[] b : BUCKETS) {
            CheckBox cb = checkbox(b[1], false);
            list.addView(cb);
            bucketBoxes.add(cb);
        }

        Button add = findViewById(R.id.config_add);
        add.setOnClickListener(v -> commit());
    }

    private void commit() {
        WidgetConfig cfg = new WidgetConfig();
        int g = groupRadio.getCheckedRadioButtonId();
        cfg.groupBy = g == 2 ? "date" : g == 3 ? "none" : "category";
        int s = sortSpinner.getSelectedItemPosition();
        cfg.sort = s == 1 ? "priority" : s == 2 ? "priority-due" : "due";

        for (int i = 0; i < catBoxes.size(); i++) {
            if (catBoxes.get(i).isChecked()) cfg.cats.add(catIds.get(i));
        }
        // All ticked == no filter (and future-proof to new categories).
        if (cfg.cats.size() == catIds.size()) cfg.cats.clear();

        for (int i = 0; i < bucketBoxes.size(); i++) {
            if (bucketBoxes.get(i).isChecked()) cfg.buckets.add(BUCKETS[i][0]);
        }
        if (cfg.buckets.size() == BUCKETS.length) cfg.buckets.clear();

        WidgetPrefs.saveConfig(this, widgetId, cfg);
        TaskWidgetProvider.updateWidget(this, AppWidgetManager.getInstance(this), widgetId);

        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }

    /* ---------------------------- view helpers ---------------------------- */

    private void addHeading(LinearLayout parent, String text) {
        TextView tv = new TextView(this);
        tv.setText(text.toUpperCase());
        tv.setTextColor(Color.parseColor("#9A9AA2"));
        tv.setTextSize(12);
        tv.setPadding(0, 22, 0, 6);
        parent.addView(tv);
    }

    private void addNote(LinearLayout parent, String text) {
        TextView tv = new TextView(this);
        tv.setText(text);
        tv.setTextColor(Color.parseColor("#C9C9D2"));
        tv.setPadding(0, 4, 0, 4);
        parent.addView(tv);
    }

    private RadioButton radio(String text, int id, boolean checked) {
        RadioButton rb = new RadioButton(this);
        rb.setText(text);
        rb.setId(id);
        rb.setChecked(checked);
        rb.setTextColor(Color.parseColor("#ECECEF"));
        rb.setTextSize(15);
        rb.setPadding(4, 12, 4, 12);
        return rb;
    }

    private CheckBox checkbox(String text, boolean checked) {
        CheckBox cb = new CheckBox(this);
        cb.setText(text);
        cb.setChecked(checked);
        cb.setTextColor(Color.parseColor("#ECECEF"));
        cb.setTextSize(15);
        cb.setPadding(8, 14, 8, 14);
        cb.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return cb;
    }
}
