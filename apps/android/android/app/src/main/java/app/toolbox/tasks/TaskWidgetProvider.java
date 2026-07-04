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

        // Tapping the header (or a row) opens the app.
        Intent open = new Intent(ctx, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(
            ctx, widgetId, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_title, openPi);
        views.setOnClickPendingIntent(R.id.widget_empty, openPi);

        // A template so each row can open the app too.
        Intent rowIntent = new Intent(ctx, MainActivity.class);
        PendingIntent rowTemplate = PendingIntent.getActivity(
            ctx, widgetId + 100000, rowIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
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
