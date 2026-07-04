package app.toolbox.tasks;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets the web app tell the launcher to redraw every task widget after it writes
 * a fresh snapshot to SharedPreferences.
 */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {

    @PluginMethod
    public void refresh(PluginCall call) {
        Context ctx = getContext();
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TaskWidgetProvider.class));
        for (int id : ids) {
            TaskWidgetProvider.updateWidget(ctx, mgr, id);
        }
        call.resolve();
    }

    /** Return and clear any action a widget queued (e.g. the + button → "add"). */
    @PluginMethod
    public void consumePendingAction(PluginCall call) {
        SharedPreferences sp = getContext()
            .getSharedPreferences("TaskWidgetPrefs", Context.MODE_PRIVATE);
        String action = sp.getString("pending_action", "");
        sp.edit().remove("pending_action").apply();
        JSObject ret = new JSObject();
        ret.put("action", action == null ? "" : action);
        call.resolve(ret);
    }
}
