package app.toolbox.tasks;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
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
            Set<String> selected = WidgetPrefs.loadSelection(ctx, widgetId);
            items = WidgetCache.items(ctx, selected);
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
                return row;
            }

            row.setViewVisibility(R.id.row_header, View.GONE);
            row.setViewVisibility(R.id.row_task, View.VISIBLE);
            row.setTextViewText(R.id.row_text, item.text);

            if (item.due != null) {
                row.setViewVisibility(R.id.row_due, View.VISIBLE);
                row.setTextViewText(R.id.row_due, item.due);
                row.setTextColor(R.id.row_due, dueColor(item.dueClass));
            } else {
                row.setViewVisibility(R.id.row_due, View.GONE);
            }

            if (item.priority != null && !item.priority.equals("normal")) {
                row.setViewVisibility(R.id.row_priority, View.VISIBLE);
                row.setTextViewText(R.id.row_priority, priorityLabel(item.priority));
                row.setTextColor(R.id.row_priority, priorityColor(item.priority));
            } else {
                row.setViewVisibility(R.id.row_priority, View.GONE);
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

        private int dueColor(String dueClass) {
            if (dueClass == null) return Color.parseColor("#8A8A94");
            switch (dueClass) {
                case "is-overdue":
                    return Color.parseColor("#FF6B6B");
                case "is-today":
                    return Color.parseColor("#FF9F43");
                case "is-tomorrow":
                    return Color.parseColor("#FFD166");
                default:
                    return Color.parseColor("#8A8A94");
            }
        }

        private String priorityLabel(String p) {
            switch (p) {
                case "highest": return "Highest";
                case "high": return "High";
                case "medium": return "Medium";
                case "low": return "Low";
                case "lowest": return "Lowest";
                default: return "";
            }
        }

        private int priorityColor(String p) {
            switch (p) {
                case "highest": return Color.parseColor("#E23B3B");
                case "high": return Color.parseColor("#F2711C");
                case "medium": return Color.parseColor("#E0A419");
                default: return Color.parseColor("#8A8A94");
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
