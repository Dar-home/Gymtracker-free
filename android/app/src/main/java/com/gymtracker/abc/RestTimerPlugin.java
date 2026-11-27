package com.gymtracker.abc;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name = "RestTimer")
public class RestTimerPlugin extends Plugin {

    private static WeakReference<RestTimerPlugin> instanceRef = new WeakReference<>(null);

    @Override
    public void load() {
        super.load();
        instanceRef = new WeakReference<>(this);
    }

    @PluginMethod
    public void startCountdown(PluginCall call) {
        Double endDouble = call.getDouble("endTimeMs", 0.0);
        long endTimeMs = endDouble != null ? endDouble.longValue() : 0L;
        String exerciseName = call.getString("exerciseName", "");
        if (endTimeMs > System.currentTimeMillis()) {
            RestTimerNotificationHelper.showOrUpdateCountdown(getContext(), endTimeMs, exerciseName, true);
        } else {
            RestTimerNotificationHelper.cancelCountdown(getContext(), true);
        }
        call.resolve();
    }

    @PluginMethod
    public void cancelCountdown(PluginCall call) {
        RestTimerNotificationHelper.cancelCountdown(getContext(), true);
        call.resolve();
    }

    @PluginMethod
    public void getPendingState(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(RestTimerNotificationHelper.PREFS_NAME, Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        ret.put("action", prefs.getString(RestTimerNotificationHelper.KEY_LAST_ACTION, ""));
        ret.put("endTimeMs", prefs.getLong(RestTimerNotificationHelper.KEY_END_TIME_MS, 0L));
        ret.put("updatedAtMs", prefs.getLong(RestTimerNotificationHelper.KEY_UPDATED_AT_MS, 0L));
        ret.put("active", prefs.getBoolean(RestTimerNotificationHelper.KEY_ACTIVE, false));
        ret.put("exerciseName", prefs.getString(RestTimerNotificationHelper.KEY_EXERCISE_NAME, ""));
        call.resolve(ret);
    }

    public static void emitAction(String action, long endTimeMs, long updatedAtMs) {
        RestTimerPlugin plugin = instanceRef.get();
        if (plugin == null) return;
        JSObject ret = new JSObject();
        ret.put("action", action);
        ret.put("endTimeMs", endTimeMs);
        ret.put("updatedAtMs", updatedAtMs);
        plugin.notifyListeners("restTimerAction", ret);
    }
}
