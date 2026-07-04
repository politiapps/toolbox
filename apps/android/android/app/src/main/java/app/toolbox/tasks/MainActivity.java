package app.toolbox.tasks;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register our custom Storage Access Framework file plugin before the
        // bridge starts, so the web layer can call SafFiles.pickFile/read/write.
        registerPlugin(SafFilesPlugin.class);
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
