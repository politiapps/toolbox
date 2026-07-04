package app.toolbox.tasks;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Shared access to widget state: the task snapshot the JS app writes via
 * Capacitor Preferences ("CapacitorStorage" / "widget_cache"), and each placed
 * widget's own configuration ("TaskWidgetPrefs" / "cfg_<id>").
 */
final class WidgetPrefs {
    private static final String CAP_STORE = "CapacitorStorage";
    private static final String CACHE_KEY = "widget_cache";
    private static final String WIDGET_STORE = "TaskWidgetPrefs";

    private WidgetPrefs() {}

    /** The raw JSON snapshot written by the app, or null if it never ran. */
    static String readCache(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        return sp.getString(CACHE_KEY, null);
    }

    static void writeCache(Context ctx, String json) {
        ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE)
            .edit().putString(CACHE_KEY, json).apply();
    }

    static void saveConfig(Context ctx, int widgetId, WidgetConfig cfg) {
        try {
            JSONObject o = new JSONObject();
            o.put("groupBy", cfg.groupBy);
            o.put("sort", cfg.sort);
            o.put("cats", new JSONArray(cfg.cats));
            o.put("buckets", new JSONArray(cfg.buckets));
            ctx.getSharedPreferences(WIDGET_STORE, Context.MODE_PRIVATE)
                .edit().putString("cfg_" + widgetId, o.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    static WidgetConfig loadConfig(Context ctx, int widgetId) {
        WidgetConfig cfg = new WidgetConfig();
        SharedPreferences sp = ctx.getSharedPreferences(WIDGET_STORE, Context.MODE_PRIVATE);
        String raw = sp.getString("cfg_" + widgetId, null);
        if (raw == null) return cfg;
        try {
            JSONObject o = new JSONObject(raw);
            cfg.groupBy = o.optString("groupBy", "category");
            cfg.sort = o.optString("sort", "due");
            JSONArray cats = o.optJSONArray("cats");
            if (cats != null) for (int i = 0; i < cats.length(); i++) cfg.cats.add(cats.getString(i));
            JSONArray buckets = o.optJSONArray("buckets");
            if (buckets != null) for (int i = 0; i < buckets.length(); i++) cfg.buckets.add(buckets.getString(i));
        } catch (Exception ignored) {
        }
        return cfg;
    }

    static void clearConfig(Context ctx, int widgetId) {
        ctx.getSharedPreferences(WIDGET_STORE, Context.MODE_PRIVATE)
            .edit().remove("cfg_" + widgetId).apply();
    }
}
