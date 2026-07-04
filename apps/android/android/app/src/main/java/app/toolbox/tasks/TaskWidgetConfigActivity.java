package app.toolbox.tasks;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Shown when a widget is dropped: lets the user pick which categories this widget
 * shows. Choosing several gives the combined multi-category view (like Obsidian).
 */
public class TaskWidgetConfigActivity extends Activity {

    private int widgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    private final List<CheckBox> boxes = new ArrayList<>();
    private final List<String> ids = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Default to cancelled so backing out doesn't place a half-configured widget.
        setResult(RESULT_CANCELED);
        setContentView(R.layout.widget_config);

        Bundle extras = getIntent().getExtras();
        if (extras != null) {
            widgetId = extras.getInt(
                AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
            );
        }
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish();
            return;
        }

        LinearLayout list = findViewById(R.id.config_list);
        List<String[]> groups = WidgetCache.groups(this);

        if (groups.isEmpty()) {
            TextView note = new TextView(this);
            note.setText("Open the app once (and pick your tasks file) so your categories appear here.");
            note.setTextColor(Color.parseColor("#C9C9D2"));
            note.setPadding(0, 8, 0, 8);
            list.addView(note);
        } else {
            for (String[] g : groups) {
                CheckBox box = new CheckBox(this);
                box.setText(g[1]);
                box.setTextColor(Color.parseColor("#ECECEF"));
                box.setChecked(true);
                box.setPadding(8, 18, 8, 18);
                box.setTextSize(16);
                list.addView(box, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT
                ));
                boxes.add(box);
                ids.add(g[0]);
            }
        }

        Button add = findViewById(R.id.config_add);
        add.setOnClickListener(v -> commit());
    }

    private void commit() {
        Set<String> selected = new HashSet<>();
        for (int i = 0; i < boxes.size(); i++) {
            if (boxes.get(i).isChecked()) selected.add(ids.get(i));
        }
        // An all-selected (or no groups) choice is stored empty, meaning "show all".
        if (!selected.isEmpty() && selected.size() < ids.size()) {
            WidgetPrefs.saveSelection(this, widgetId, selected);
        } else {
            WidgetPrefs.clearSelection(this, widgetId);
        }

        AppWidgetManager mgr = AppWidgetManager.getInstance(this);
        TaskWidgetProvider.updateWidget(this, mgr, widgetId);

        Intent result = new Intent();
        result.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        setResult(RESULT_OK, result);
        finish();
    }
}
