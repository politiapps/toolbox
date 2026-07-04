package app.toolbox.tasks;

import android.app.Activity;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Storage Access Framework bridge: lets the user pick any tasks.md on the device
 * (ACTION_OPEN_DOCUMENT), persists read/write permission across reboots, and
 * reads/writes the file's whole contents as UTF-8 text via the ContentResolver.
 */
@CapacitorPlugin(name = "SafFiles")
public class SafFilesPlugin extends Plugin {

    @PluginMethod
    public void pickFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(
            Intent.EXTRA_MIME_TYPES,
            new String[] { "text/markdown", "text/plain", "application/octet-stream" }
        );
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickFileResult");
    }

    @ActivityCallback
    private void pickFileResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri uri = result.getData().getData();
            if (uri != null) {
                final int flags =
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                try {
                    getContext().getContentResolver().takePersistableUriPermission(uri, flags);
                } catch (Exception ignored) {
                    // Some providers don't support persistable grants; the session
                    // grant still lets us read/write until the app is killed.
                }
                ret.put("uri", uri.toString());
                ret.put("name", queryDisplayName(uri));
            }
        }
        // On cancel we leave "uri" unset — the web layer treats that as "no file".
        call.resolve(ret);
    }

    @PluginMethod
    public void hasPermission(PluginCall call) {
        String uriStr = call.getString("uri");
        boolean granted = false;
        if (uriStr != null) {
            for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().toString().equals(uriStr) && p.isReadPermission()) {
                    granted = true;
                    break;
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }
        Uri uri = Uri.parse(uriStr);
        try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
            if (is == null) {
                call.reject("Could not open file");
                return;
            }
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            JSObject ret = new JSObject();
            ret.put("data", new String(bos.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        String uriStr = call.getString("uri");
        String data = call.getString("data", "");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }
        Uri uri = Uri.parse(uriStr);
        // "wt" truncates the existing document before writing, so a shorter file
        // doesn't leave stale trailing bytes.
        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (os == null) {
                call.reject("Could not open file for writing");
                return;
            }
            os.write(data.getBytes(StandardCharsets.UTF_8));
            os.flush();
            call.resolve();
        } catch (Exception e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    /* -------------------- vault folder (tree) access -------------------- */

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri tree = result.getData().getData();
            if (tree != null) {
                final int flags =
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
                try {
                    getContext().getContentResolver().takePersistableUriPermission(tree, flags);
                } catch (Exception ignored) {
                }
                ret.put("uri", tree.toString());
                ret.put("name", queryDisplayName(tree));
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void hasTreePermission(PluginCall call) {
        String uriStr = call.getString("uri");
        boolean granted = false;
        if (uriStr != null) {
            for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
                if (p.getUri().toString().equals(uriStr) && p.isReadPermission()) {
                    granted = true;
                    break;
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** Read a vault-relative file. Resolves { found:false } when it doesn't exist. */
    @PluginMethod
    public void readTreeFile(PluginCall call) {
        String treeUri = call.getString("treeUri");
        String path = call.getString("path");
        if (treeUri == null || path == null) {
            call.reject("Missing treeUri/path");
            return;
        }
        DocumentFile doc = TreeFiles.resolve(getContext(), treeUri, path, false);
        JSObject ret = new JSObject();
        if (doc == null || !doc.exists()) {
            ret.put("found", false);
            ret.put("data", (String) null);
            call.resolve(ret);
            return;
        }
        try {
            ret.put("found", true);
            ret.put("data", TreeFiles.read(getContext(), doc.getUri()));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Read failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void writeTreeFile(PluginCall call) {
        String treeUri = call.getString("treeUri");
        String path = call.getString("path");
        String data = call.getString("data", "");
        if (treeUri == null || path == null) {
            call.reject("Missing treeUri/path");
            return;
        }
        DocumentFile doc = TreeFiles.resolve(getContext(), treeUri, path, true);
        if (doc == null) {
            call.reject("Could not resolve/create file");
            return;
        }
        try {
            TreeFiles.write(getContext(), doc.getUri(), data);
            call.resolve();
        } catch (Exception e) {
            call.reject("Write failed: " + e.getMessage());
        }
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    return cursor.getString(idx);
                }
            }
        } catch (Exception ignored) {
            // fall through to default
        }
        return "tasks.md";
    }
}
