package app.toolbox.tasks;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Reads the JSON snapshot the app wrote (via widgetCache.ts) and turns it into a
 * flat list of rows — section headers interleaved with tasks — filtered to the
 * categories a given widget was configured to show. No markdown is parsed here;
 * the app already did that with @toolbox/task-core.
 */
final class WidgetCache {

    private WidgetCache() {}

    /** One rendered line: either a category header or a task. */
    static final class Item {
        final boolean header;
        final String text;
        final String raw;
        final String due;
        final String dueClass;
        final String priority;

        private Item(boolean header, String text, String raw, String due, String dueClass, String priority) {
            this.header = header;
            this.text = text;
            this.raw = raw;
            this.due = due;
            this.dueClass = dueClass;
            this.priority = priority;
        }

        static Item header(String name) {
            return new Item(true, name, null, null, null, null);
        }

        static Item task(String text, String raw, String due, String dueClass, String priority) {
            return new Item(false, text, raw, due, dueClass, priority);
        }
    }

    /** The categories available in the snapshot (id + name), for the config screen. */
    static List<String[]> groups(Context ctx) {
        List<String[]> out = new ArrayList<>();
        String raw = WidgetPrefs.readCache(ctx);
        if (raw == null) return out;
        try {
            JSONArray groups = new JSONObject(raw).optJSONArray("groups");
            if (groups == null) return out;
            for (int i = 0; i < groups.length(); i++) {
                JSONObject g = groups.getJSONObject(i);
                out.add(new String[] { g.optString("id"), g.optString("name") });
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    /** Rows to render: headers + tasks for the selected categories (empty = all). */
    static List<Item> items(Context ctx, Set<String> selected) {
        List<Item> out = new ArrayList<>();
        String raw = WidgetPrefs.readCache(ctx);
        if (raw == null) return out;
        try {
            JSONArray groups = new JSONObject(raw).optJSONArray("groups");
            if (groups == null) return out;
            for (int i = 0; i < groups.length(); i++) {
                JSONObject g = groups.getJSONObject(i);
                String id = g.optString("id");
                if (!selected.isEmpty() && !selected.contains(id)) continue;
                JSONArray tasks = g.optJSONArray("tasks");
                if (tasks == null || tasks.length() == 0) continue;
                out.add(Item.header(g.optString("name")));
                for (int j = 0; j < tasks.length(); j++) {
                    JSONObject t = tasks.getJSONObject(j);
                    out.add(Item.task(
                        t.optString("text"),
                        t.optString("raw"),
                        t.isNull("dueLabel") ? null : t.optString("dueLabel", null),
                        t.isNull("dueClass") ? null : t.optString("dueClass", null),
                        t.optString("priority", "normal")
                    ));
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    static String updatedLabel(Context ctx) {
        String raw = WidgetPrefs.readCache(ctx);
        if (raw == null) return "";
        try {
            long ts = new JSONObject(raw).optLong("updatedAt", 0);
            if (ts <= 0) return "";
            return TaskWidgetProvider.timeLabel(ts);
        } catch (Exception e) {
            return "";
        }
    }
}
