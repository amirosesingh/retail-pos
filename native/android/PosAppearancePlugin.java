package com.luckycharms.pos;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Colours only. Capacitor remains the sole owner of cutout/keyboard/nav insets. */
@CapacitorPlugin(name = "PosAppearance")
public class PosAppearancePlugin extends Plugin {
    private boolean configured;
    private boolean dark;

    @PluginMethod
    public void setAppearance(PluginCall call) {
        boolean requestedDark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        getActivity().runOnUiThread(() -> {
            dark = requestedDark;
            configured = true;
            applyAppearance();
            call.resolve();
        });
    }

    private void applyAppearance() {
        if (!configured) return;
        Window window = getActivity().getWindow();
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
        int background = dark ? Color.rgb(9, 9, 11) : Color.WHITE;
        window.getDecorView().setBackgroundColor(background);
        // Older Android draws opaque system bars; newer Android enforces edge-to-edge.
        if (Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(background);
            window.setNavigationBarColor(background);
        }
    }

    private void reapplyAfterSystemChange() {
        getActivity().getWindow().getDecorView().post(this::applyAppearance);
    }

    @Override
    protected void handleOnResume() { reapplyAfterSystemChange(); }

    @Override
    protected void handleOnConfigurationChanged(Configuration config) { reapplyAfterSystemChange(); }
}
