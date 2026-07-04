package app.toolbox.tasks;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The one place the widget touches the tasks file directly. Completing a task
 * here is a deliberately minimal string edit — flip "[ ]" to "[x]" and append a
 * done date to the exact raw line the app cached — so no markdown parser is
 * needed natively. The file is located inside the vault folder grant via the
 * tasks path the app read from the plugin's data.json.
 */
final class WidgetFile {

    private static final String CAP_STORE = "CapacitorStorage";

    private WidgetFile() {}

    static void completeTask(Context ctx, String raw) {
        String[] loc = vaultLocation(ctx);
        if (loc == null) return;
        try {
            DocumentFile doc = TreeFiles.resolve(ctx, loc[0], loc[1], false);
            if (doc == null || !doc.exists()) return;
            String content = TreeFiles.read(ctx, doc.getUri());
            int idx = content.indexOf(raw);
            if (idx < 0) return; // line changed externally — the app will resync

            String completed = raw.replaceFirst("\\[ \\]", "[x]");
            if (!completed.contains("✅")) {
                String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
                completed = completed + " ✅ " + today;
            }
            String next = content.substring(0, idx) + completed + content.substring(idx + raw.length());
            TreeFiles.write(ctx, doc.getUri(), next);
            removeFromCache(ctx, raw);
        } catch (Exception ignored) {
            // Leave the widget as-is; opening the app will reconcile.
        }
    }

    /** [treeUri, tasksPath] from the app's settings, or null if no vault linked. */
    private static String[] vaultLocation(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(CAP_STORE, Context.MODE_PRIVATE);
        String settings = sp.getString("settings", null);
        if (settings == null) return null;
        try {
            JSONObject o = new JSONObject(settings);
            JSONObject vault = o.optJSONObject("vault");
            if (vault == null) return null;
            String treeUri = vault.optString("uri", "");
            if (treeUri.isEmpty()) return null;
            String path = o.optString("tasksPath", "tasks.md");
            return new String[] { treeUri, path };
        } catch (Exception e) {
            return null;
        }
    }

    /** Drop the just-completed task from the cache so the widget updates instantly. */
    private static void removeFromCache(Context ctx, String raw) {
        String cache = WidgetPrefs.readCache(ctx);
        if (cache == null) return;
        try {
            JSONObject root = new JSONObject(cache);
            JSONArray tasks = root.optJSONArray("tasks");
            if (tasks == null) return;
            JSONArray kept = new JSONArray();
            for (int j = 0; j < tasks.length(); j++) {
                JSONObject t = tasks.getJSONObject(j);
                if (!raw.equals(t.optString("raw"))) kept.put(t);
            }
            root.put("tasks", kept);
            WidgetPrefs.writeCache(ctx, root.toString());
        } catch (Exception ignored) {
        }
    }
}
