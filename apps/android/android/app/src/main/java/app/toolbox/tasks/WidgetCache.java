package app.toolbox.tasks;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the flat JSON snapshot the app writes (categories + tasks) and turns it
 * into rows for a widget — filtered, grouped and sorted per that widget's config.
 * No markdown is parsed here; the app already did that with @toolbox/task-core.
 */
final class WidgetCache {

    private WidgetCache() {}

    /** One rendered line: a header, or a task. */
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

        static Item task(TaskData t) {
            return new Item(false, t.text, t.raw, t.dueLabel, t.dueClass, t.priority);
        }
    }

    private static final class TaskData {
        String text, raw, dueLabel, dueClass, priority, cat, catName;
        Integer dueDays; // null = undated
        int catOrder;
    }

    /* --------------------------- parsing --------------------------- */

    private static List<TaskData> parseTasks(Context ctx) {
        List<TaskData> out = new ArrayList<>();
        String raw = WidgetPrefs.readCache(ctx);
        if (raw == null) return out;
        try {
            JSONArray tasks = new JSONObject(raw).optJSONArray("tasks");
            if (tasks == null) return out;
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject t = tasks.getJSONObject(i);
                TaskData d = new TaskData();
                d.text = t.optString("text");
                d.raw = t.optString("raw");
                d.dueDays = t.isNull("dueDays") ? null : t.optInt("dueDays");
                d.dueLabel = t.isNull("dueLabel") ? null : t.optString("dueLabel", null);
                d.dueClass = t.isNull("dueClass") ? null : t.optString("dueClass", null);
                d.priority = t.optString("priority", "normal");
                d.cat = t.optString("cat");
                d.catName = t.optString("catName");
                d.catOrder = t.optInt("catOrder");
                out.add(d);
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    /** Categories available in the snapshot (id + name), for the config screen. */
    static List<String[]> categories(Context ctx) {
        List<String[]> out = new ArrayList<>();
        String raw = WidgetPrefs.readCache(ctx);
        if (raw == null) return out;
        try {
            JSONArray cats = new JSONObject(raw).optJSONArray("categories");
            if (cats == null) return out;
            for (int i = 0; i < cats.length(); i++) {
                JSONObject c = cats.getJSONObject(i);
                out.add(new String[] { c.optString("id"), c.optString("name") });
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
            return ts <= 0 ? "" : TaskWidgetProvider.timeLabel(ts);
        } catch (Exception e) {
            return "";
        }
    }

    /* --------------------- buckets, sort, build -------------------- */

    private static String bucketOf(Integer dueDays) {
        if (dueDays == null) return "none";
        if (dueDays < 0) return "overdue";
        if (dueDays == 0) return "today";
        if (dueDays <= 7) return "week";
        return "later";
    }

    static String bucketLabel(String bucket) {
        switch (bucket) {
            case "overdue": return "Overdue";
            case "today": return "Today";
            case "week": return "This week";
            case "later": return "Later";
            default: return "No date";
        }
    }

    static final String[] BUCKET_ORDER = { "overdue", "today", "week", "later", "none" };

    private static int priorityRank(String p) {
        switch (p) {
            case "highest": return 0;
            case "high": return 1;
            case "medium": return 2;
            case "low": return 4;
            case "lowest": return 5;
            default: return 3;
        }
    }

    private static Comparator<TaskData> comparator(String sort) {
        Comparator<TaskData> byDue = (a, b) -> {
            if (a.dueDays == null && b.dueDays == null) return 0;
            if (a.dueDays == null) return 1;
            if (b.dueDays == null) return -1;
            return Integer.compare(a.dueDays, b.dueDays);
        };
        Comparator<TaskData> byPriority = (a, b) -> Integer.compare(priorityRank(a.priority), priorityRank(b.priority));
        switch (sort) {
            case "priority": return byPriority;
            case "priority-due": return byPriority.thenComparing(byDue);
            default: return byDue;
        }
    }

    /** Build the rows for a widget, honouring its filter/group/sort config. */
    static List<Item> items(Context ctx, WidgetConfig cfg) {
        List<Item> out = new ArrayList<>();
        List<TaskData> all = parseTasks(ctx);
        Comparator<TaskData> cmp = comparator(cfg.sort);

        // Filter by selected categories and date buckets (empty set = allow all).
        List<TaskData> filtered = new ArrayList<>();
        for (TaskData t : all) {
            if (!cfg.cats.isEmpty() && !cfg.cats.contains(t.cat)) continue;
            if (!cfg.buckets.isEmpty() && !cfg.buckets.contains(bucketOf(t.dueDays))) continue;
            filtered.add(t);
        }

        if ("none".equals(cfg.groupBy)) {
            Collections.sort(filtered, cmp);
            for (TaskData t : filtered) out.add(Item.task(t));
            return out;
        }

        // Grouped: preserve category order, or fixed bucket order.
        Map<String, List<TaskData>> groups = new LinkedHashMap<>();
        Map<String, String> labels = new LinkedHashMap<>();
        if ("date".equals(cfg.groupBy)) {
            for (String b : BUCKET_ORDER) {
                groups.put(b, new ArrayList<>());
                labels.put(b, bucketLabel(b));
            }
            for (TaskData t : filtered) groups.get(bucketOf(t.dueDays)).add(t);
        } else {
            // by category — order groups by catOrder as first seen.
            List<TaskData> byOrder = new ArrayList<>(filtered);
            Collections.sort(byOrder, Comparator.comparingInt(t -> t.catOrder));
            for (TaskData t : byOrder) {
                if (!groups.containsKey(t.cat)) {
                    groups.put(t.cat, new ArrayList<>());
                    labels.put(t.cat, t.catName);
                }
                groups.get(t.cat).add(t);
            }
        }

        for (Map.Entry<String, List<TaskData>> e : groups.entrySet()) {
            List<TaskData> list = e.getValue();
            if (list.isEmpty()) continue;
            Collections.sort(list, cmp);
            out.add(Item.header(labels.get(e.getKey())));
            for (TaskData t : list) out.add(Item.task(t));
        }
        return out;
    }
}
