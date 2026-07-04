package app.toolbox.tasks;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Shared access to the two bits of widget state:
 *   - the task snapshot the JS app writes via Capacitor Preferences
 *     (SharedPreferences file "CapacitorStorage", key "widget_cache"), and
 *   - each placed widget's chosen categories (our own "TaskWidgetPrefs" file).
 */
final class WidgetPrefs {
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String CACHE_KEY = "widget_cache";
    private static final String WIDGET_STORE = "TaskWidgetPrefs";
    private static final String SEP = "\n";

    private WidgetPrefs() {}

    /** The raw JSON snapshot written by the app, or null if it never ran. */
    static String readCache(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        return sp.getString(CACHE_KEY, null);
    }

    /** Persist the category ids a widget should show (empty = show all). */
    static void saveSelection(Context ctx, int widgetId, Set<String> ids) {
        SharedPreferences sp = ctx.getSharedPreferences(WIDGET_STORE, Context.MODE_PRIVATE);
        sp.edit().putString("sel_" + widgetId, String.join(SEP, ids)).apply();
    }

    /** The category ids a widget shows, or an empty set meaning "all". */
    static Set<String> loadSelection(Context ctx, int widgetId) {
        SharedPreferences sp = ctx.getSharedPreferences(WIDGET_STORE, Context.MODE_PRIVATE);
        String raw = sp.getString("sel_" + widgetId, "");
        Set<String> out = new HashSet<>();
        if (raw != null && !raw.isEmpty()) {
            out.addAll(Arrays.asList(raw.split(SEP)));
        }
        return out;
    }

    static void clearSelection(Context ctx, int widgetId) {
        SharedPreferences sp = ctx.getSharedPreferences(WIDGET_STORE, Context.MODE_PRIVATE);
        sp.edit().remove("sel_" + widgetId).apply();
    }
}
