package app.toolbox.tasks;

import android.content.Context;
import android.net.Uri;

import androidx.documentfile.provider.DocumentFile;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Resolve and read/write files by vault-relative path inside a SAF tree grant
 * (ACTION_OPEN_DOCUMENT_TREE). This is what lets the app find both tasks.md and
 * .obsidian/plugins/toolbox/data.json from a single one-time folder pick.
 */
final class TreeFiles {

    private TreeFiles() {}

    /** Resolve `relPath` (slash-separated) under `treeUri`; create dirs/file if asked. */
    static DocumentFile resolve(Context ctx, String treeUri, String relPath, boolean createMissing) {
        DocumentFile cur = DocumentFile.fromTreeUri(ctx, Uri.parse(treeUri));
        if (cur == null) return null;
        String[] parts = relPath.split("/");
        for (int i = 0; i < parts.length; i++) {
            String name = parts[i];
            if (name.isEmpty()) continue;
            boolean last = i == parts.length - 1;
            DocumentFile next = cur.findFile(name);
            if (next == null) {
                if (!createMissing) return null;
                next = last ? cur.createFile("text/markdown", name) : cur.createDirectory(name);
                if (next == null) return null;
            }
            cur = next;
        }
        return cur;
    }

    static String read(Context ctx, Uri uri) throws Exception {
        try (InputStream is = ctx.getContentResolver().openInputStream(uri)) {
            if (is == null) throw new Exception("no stream");
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            return new String(bos.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    static void write(Context ctx, Uri uri, String data) throws Exception {
        try (OutputStream os = ctx.getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) throw new Exception("no stream");
            os.write(data.getBytes(StandardCharsets.UTF_8));
            os.flush();
        }
    }
}
