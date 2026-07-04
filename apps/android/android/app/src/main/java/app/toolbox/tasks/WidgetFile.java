package app.toolbox.tasks;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The one place the widget touches the tasks file directly. Completing a task
 * here is a deliberately minimal string edit — flip "[ ]" to "[x]" and append a
 * done date to the exact raw line the app cached — so no markdown parser is
 * needed natively. The app reconciles everything (including recurrence) on its
 * next open, which is why recurring tasks are best completed in the app.
 */
final class WidgetFile {

    private static final String CAP_STORE = "CapacitorStorage";

    private WidgetFile() {}

    static void completeTask(Context ctx, String raw) {
        String uriStr = tasksFileUri(ctx);
        if (uriStr == null) return;
        try {
            Uri uri = Uri.parse(uriStr);
            String content = readAll(ctx, uri);
            int idx = content.indexOf(raw);
            if (idx < 0) return; // line changed externally — the app will resync

            String completed = raw.replaceFirst("\\[ \\]", "[x]");
            if (!completed.contains("✅")) {
                String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
                completed = completed + " ✅ " + today;
            }
            String next = content.substring(0, idx) + completed + content.substring(idx + raw.length());
            writeAll(ctx, uri, next);
            removeFromCache(ctx, raw);
        } catch (Exception ignored) {
            // Leave the widget as-is; opening the app will reconcile.
        }
    }

    private static String tasksFileUri(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        String settings = sp.getString("settings", null);
        if (settings == null) return null;
        try {
            JSONObject file = new JSONObject(settings).optJSONObject("file");
            if (file == null) return null;
            String uri = file.optString("uri", "");
            return uri.isEmpty() ? null : uri;
        } catch (Exception e) {
            return null;
        }
    }

    private static String readAll(Context ctx, Uri uri) throws Exception {
        try (InputStream is = ctx.getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("no stream");
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private static void writeAll(Context ctx, Uri uri, String data) throws Exception {
        try (OutputStream os = ctx.getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) throw new Exception("no stream");
            os.write(data.getBytes(StandardCharsets.UTF_8));
            os.flush();
        }
    }

    /** Drop the just-completed task from the cache so the widget updates instantly. */
    private static void removeFromCache(Context ctx, String raw) {
        SharedPreferences sp = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        String cache = sp.getString("widget_cache", null);
        if (cache == null) return;
        try {
            JSONObject root = new JSONObject(cache);
            JSONArray groups = root.optJSONArray("groups");
            if (groups == null) return;
            for (int i = 0; i < groups.length(); i++) {
                JSONObject g = groups.getJSONObject(i);
                JSONArray tasks = g.optJSONArray("tasks");
                if (tasks == null) continue;
                JSONArray kept = new JSONArray();
                for (int j = 0; j < tasks.length(); j++) {
                    JSONObject t = tasks.getJSONObject(j);
                    if (!raw.equals(t.optString("raw"))) kept.put(t);
                }
                g.put("tasks", kept);
            }
            sp.edit().putString("widget_cache", root.toString()).apply();
        } catch (Exception ignored) {
        }
    }
}
