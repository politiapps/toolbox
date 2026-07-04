package app.toolbox.tasks;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Intent extra used by the widget's + button to request the Add form. */
    public static final String EXTRA_PENDING_ACTION = "pendingAction";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register our custom plugins before the bridge starts, so the web layer
        // can call SafFiles.* and WidgetBridge.*.
        registerPlugin(SafFilesPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        stashPendingAction(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        stashPendingAction(intent);
    }

    /** Store a widget-requested action so the web layer can consume it on load/resume. */
    private void stashPendingAction(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(EXTRA_PENDING_ACTION);
        if (action != null && !action.isEmpty()) {
            getSharedPreferences("TaskWidgetPrefs", Context.MODE_PRIVATE)
                .edit()
                .putString("pending_action", action)
                .apply();
        }
    }
}
