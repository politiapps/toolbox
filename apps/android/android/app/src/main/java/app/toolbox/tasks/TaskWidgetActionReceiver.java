package app.toolbox.tasks;

import android.appwidget.AppWidgetManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;

/**
 * Handles taps inside the widget list. The checkbox completes a task in place
 * (no app launch); tapping the text opens the app.
 */
public class TaskWidgetActionReceiver extends BroadcastReceiver {

    static final String ACTION_ROW = "app.toolbox.tasks.WIDGET_ROW";
    static final String EXTRA_ACTION = "action";
    static final String EXTRA_RAW = "raw";
    static final String ACTION_COMPLETE = "complete";
    static final String ACTION_OPEN = "open";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent.getStringExtra(EXTRA_ACTION);
        if (ACTION_OPEN.equals(action)) {
            Intent open = new Intent(ctx, MainActivity.class);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(open);
            return;
        }
        if (ACTION_COMPLETE.equals(action)) {
            String raw = intent.getStringExtra(EXTRA_RAW);
            if (raw != null && !raw.isEmpty()) {
                WidgetFile.completeTask(ctx, raw);
            }
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TaskWidgetProvider.class));
            for (int id : ids) {
                TaskWidgetProvider.updateWidget(ctx, mgr, id);
            }
        }
    }
}
