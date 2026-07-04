package app.toolbox.tasks;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Home-screen widget that shows a scrollable, category-grouped task list. */
public class TaskWidgetProvider extends AppWidgetProvider {

    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_tasks);

        // Bind the collection to our RemoteViewsService (unique per widget id).
        Intent svc = new Intent(ctx, TaskWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, svc);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        // "Updated" stamp from the cache timestamp.
        views.setTextViewText(R.id.widget_updated, WidgetCache.updatedLabel(ctx));

        // Tapping the header or empty state opens the app.
        Intent open = new Intent(ctx, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(
            ctx, widgetId, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_title, openPi);
        views.setOnClickPendingIntent(R.id.widget_empty, openPi);

        // The + button opens the app's Add form (queued as a pending action).
        Intent add = new Intent(ctx, MainActivity.class);
        add.putExtra(MainActivity.EXTRA_PENDING_ACTION, "add");
        add.setAction("toolbox.add." + widgetId);
        PendingIntent addPi = PendingIntent.getActivity(
            ctx, widgetId + 200000, add,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_add, addPi);

        // Rows flow through a broadcast template; each row's fill-in intent says
        // whether it's a "complete" (checkbox) or "open" (text) tap.
        Intent rowIntent = new Intent(ctx, TaskWidgetActionReceiver.class);
        rowIntent.setAction(TaskWidgetActionReceiver.ACTION_ROW);
        PendingIntent rowTemplate = PendingIntent.getBroadcast(
            ctx, widgetId + 100000, rowIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        views.setPendingIntentTemplate(R.id.widget_list, rowTemplate);

        mgr.updateAppWidget(widgetId, views);
        mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list);
    }

    static String timeLabel(long epochMs) {
        return new SimpleDateFormat("h:mm a", Locale.getDefault()).format(new Date(epochMs));
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) {
            updateWidget(ctx, mgr, id);
        }
    }

    @Override
    public void onDeleted(Context ctx, int[] widgetIds) {
        for (int id : widgetIds) {
            WidgetPrefs.clearSelection(ctx, id);
        }
    }
}
