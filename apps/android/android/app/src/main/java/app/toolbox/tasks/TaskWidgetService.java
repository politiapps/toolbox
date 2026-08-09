package app.toolbox.tasks;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.List;
import java.util.Set;

/** Supplies the row views for a widget's task ListView from the cached snapshot. */
public class TaskWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        int widgetId = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        );
        return new TaskWidgetFactory(getApplicationContext(), widgetId);
    }

    static final class TaskWidgetFactory implements RemoteViewsService.RemoteViewsFactory {
        private final Context ctx;
        private final int widgetId;
        private List<WidgetCache.Item> items = java.util.Collections.emptyList();

        TaskWidgetFactory(Context ctx, int widgetId) {
            this.ctx = ctx;
            this.widgetId = widgetId;
        }

        private void reload() {
            WidgetConfig cfg = WidgetPrefs.loadConfig(ctx, widgetId);
            items = WidgetCache.items(ctx, cfg);
        }

        @Override
        public void onCreate() {
            reload();
        }

        @Override
        public void onDataSetChanged() {
            reload();
        }

        @Override
        public void onDestroy() {
            items = java.util.Collections.emptyList();
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(ctx.getPackageName(), R.layout.widget_row);
            if (position < 0 || position >= items.size()) return row;
            WidgetCache.Item item = items.get(position);

            if (item.header) {
                row.setViewVisibility(R.id.row_header, View.VISIBLE);
                row.setViewVisibility(R.id.row_task, View.GONE);
                row.setTextViewText(R.id.row_header, item.text.toUpperCase());
                styleHeader(row, item);
                return row;
            }

            row.setViewVisibility(R.id.row_header, View.GONE);
            row.setViewVisibility(R.id.row_task, View.VISIBLE);
            row.setTextViewText(R.id.row_text, item.text);

            // Overdue washes the whole row, not just its badge — it is the one
            // state that must be findable under any grouping without reading.
            boolean overdue = "is-overdue".equals(item.dueClass);
            row.setInt(R.id.row_task, "setBackgroundResource",
                overdue ? R.drawable.widget_row_overdue : 0);

            // Priority owns the left edge; only the top three levels earn ink.
            row.setInt(R.id.row_spine, "setBackgroundColor", WidgetTheme.spineColor(item.priority));

            // The due date owns the fixed right-hand column. Rows are recycled, so
            // every branch sets the background explicitly (0 clears it) — a stale
            // red fill left on a reused row would be a lie about a task's urgency.
            if (item.due != null) {
                row.setViewVisibility(R.id.row_due, View.VISIBLE);
                row.setTextViewText(R.id.row_due, item.due);
                row.setTextColor(R.id.row_due, WidgetTheme.dueTextColor(item.dueClass));
                row.setInt(R.id.row_due, "setBackgroundResource",
                    WidgetTheme.dueBackground(item.dueClass));
            } else {
                row.setViewVisibility(R.id.row_due, View.GONE);
                row.setInt(R.id.row_due, "setBackgroundResource", 0);
            }

            if (item.priority != null && !item.priority.equals("normal")) {
                row.setViewVisibility(R.id.row_priority, View.VISIBLE);
                row.setTextViewText(R.id.row_priority, WidgetTheme.priorityLabel(item.priority));
                row.setTextColor(R.id.row_priority, WidgetTheme.priorityColor(item.priority));
                row.setInt(R.id.row_priority, "setBackgroundResource",
                    WidgetTheme.priorityBackground(item.priority));
            } else {
                row.setViewVisibility(R.id.row_priority, View.GONE);
                row.setInt(R.id.row_priority, "setBackgroundResource", 0);
            }

            // Tapping the checkbox completes the task; tapping the text opens the app.
            // Both flow through the list's broadcast template with distinct extras.
            Intent complete = new Intent();
            complete.putExtra(TaskWidgetActionReceiver.EXTRA_ACTION, TaskWidgetActionReceiver.ACTION_COMPLETE);
            complete.putExtra(TaskWidgetActionReceiver.EXTRA_RAW, item.raw);
            row.setOnClickFillInIntent(R.id.row_check, complete);

            Intent open = new Intent();
            open.putExtra(TaskWidgetActionReceiver.EXTRA_ACTION, TaskWidgetActionReceiver.ACTION_OPEN);
            row.setOnClickFillInIntent(R.id.row_open, open);
            return row;
        }

        /**
         * A group header is coloured by what it groups: a date header reuses the
         * due ramp (so the header and the rows beneath it read as one signal —
         * overdue a filled tab, today an outlined one, the rest plain captions),
         * and a category header takes its lane's accent, the same hue that
         * section carries in the app and the sidebar.
         */
        private void styleHeader(RemoteViews row, WidgetCache.Item item) {
            if (!item.dateGroup) {
                row.setTextColor(R.id.row_header, WidgetTheme.sectionAccent(item.groupKey));
                row.setInt(R.id.row_header, "setBackgroundResource", 0);
                return;
            }
            String bucket = item.groupKey == null ? "" : item.groupKey;
            switch (bucket) {
                case "overdue":
                    row.setTextColor(R.id.row_header, WidgetTheme.ON_FILL);
                    row.setInt(R.id.row_header, "setBackgroundResource", R.drawable.widget_group_overdue);
                    break;
                case "today":
                    row.setTextColor(R.id.row_header, WidgetTheme.TODAY);
                    row.setInt(R.id.row_header, "setBackgroundResource", R.drawable.widget_group_today);
                    break;
                default:
                    // Further out is reference, not signal.
                    row.setTextColor(R.id.row_header, WidgetTheme.FAINT);
                    row.setInt(R.id.row_header, "setBackgroundResource", 0);
                    break;
            }
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return 1;
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public boolean hasStableIds() {
            return false;
        }
    }
}
