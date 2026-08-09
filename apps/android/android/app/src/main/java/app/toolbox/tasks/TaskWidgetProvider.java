package app.toolbox.tasks;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;


/** Home-screen widget that shows a scrollable, category-grouped task list. */
public class TaskWidgetProvider extends AppWidgetProvider {

    /** Self-addressed alarm that fires at midnight to re-derive due labels. */
    static final String ACTION_DATE_ROLL = "app.toolbox.tasks.DATE_ROLL";

    static void updateWidget(Context ctx, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_tasks);

        // Bind the collection to our RemoteViewsService (unique per widget id).
        Intent svc = new Intent(ctx, TaskWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, svc);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

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

    /** Redraw every placed widget (used by the date-roll alarm). */
    private static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, TaskWidgetProvider.class))) {
            updateWidget(ctx, mgr, id);
        }
    }

    /**
     * Wake at the next local midnight and redraw, because that is the moment
     * every relative due label and colour changes — "Today" becomes "Yesterday",
     * and a task slides from the Today group into Overdue. updatePeriodMillis
     * alone would leave the widget wrong for up to half an hour past the turn.
     *
     * Deliberately an inexact RTC alarm: it needs no exact-alarm permission and
     * does not wake the device, and Doze releases it as soon as the phone is
     * roused — which is the only time anyone can read the widget anyway.
     */
    private static void scheduleDateRoll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.set(AlarmManager.RTC, WidgetDates.nextMidnight(), dateRollIntent(ctx));
    }

    private static PendingIntent dateRollIntent(Context ctx) {
        Intent i = new Intent(ctx, TaskWidgetProvider.class).setAction(ACTION_DATE_ROLL);
        return PendingIntent.getBroadcast(
            ctx, 300000, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (ACTION_DATE_ROLL.equals(intent.getAction())) {
            updateAll(ctx);
            scheduleDateRoll(ctx); // one-shot alarm: re-arm for the following midnight
        }
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] widgetIds) {
        for (int id : widgetIds) {
            updateWidget(ctx, mgr, id);
        }
        // Also re-arms after a reboot, which clears alarms but still fires onUpdate.
        scheduleDateRoll(ctx);
    }

    @Override
    public void onDeleted(Context ctx, int[] widgetIds) {
        for (int id : widgetIds) {
            WidgetPrefs.clearConfig(ctx, id);
        }
    }

    @Override
    public void onDisabled(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(dateRollIntent(ctx));
    }
}
