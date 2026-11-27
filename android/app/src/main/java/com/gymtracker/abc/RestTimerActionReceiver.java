package com.gymtracker.abc;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class RestTimerActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        SharedPreferences prefs = context.getSharedPreferences(RestTimerNotificationHelper.PREFS_NAME, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long currentEnd = prefs.getLong(RestTimerNotificationHelper.KEY_END_TIME_MS, 0L);
        String exerciseName = prefs.getString(RestTimerNotificationHelper.KEY_EXERCISE_NAME, "");

        if (RestTimerNotificationHelper.ACTION_STOP.equals(action)) {
            prefs.edit()
                .putString(RestTimerNotificationHelper.KEY_LAST_ACTION, "stop")
                .putLong(RestTimerNotificationHelper.KEY_UPDATED_AT_MS, now)
                .apply();
            RestTimerNotificationHelper.cancelCountdown(context, false);
            RestTimerPlugin.emitAction("stop", 0L, now);
            return;
        }

        if (RestTimerNotificationHelper.ACTION_TIMER_EXPIRED.equals(action)) {
            prefs.edit()
                .putString(RestTimerNotificationHelper.KEY_LAST_ACTION, "expired")
                .putLong(RestTimerNotificationHelper.KEY_UPDATED_AT_MS, now)
                .apply();
            RestTimerNotificationHelper.showFinishedNotification(context, exerciseName);
            RestTimerPlugin.emitAction("expired", 0L, now);
            return;
        }

        long deltaMs = 0L;
        if (RestTimerNotificationHelper.ACTION_MINUS_15.equals(action)) {
            deltaMs = -15000L;
        } else if (RestTimerNotificationHelper.ACTION_PLUS_15.equals(action)) {
            deltaMs = 15000L;
        } else {
            return;
        }

        long baseEnd = Math.max(now, currentEnd);
        long nextEnd = baseEnd + deltaMs;
        if (nextEnd <= now + 500L) {
            prefs.edit()
                .putString(RestTimerNotificationHelper.KEY_LAST_ACTION, "stop")
                .putLong(RestTimerNotificationHelper.KEY_UPDATED_AT_MS, now)
                .apply();
            RestTimerNotificationHelper.cancelCountdown(context, false);
            RestTimerPlugin.emitAction("stop", 0L, now);
        } else {
            prefs.edit()
                .putString(RestTimerNotificationHelper.KEY_LAST_ACTION, "adjust")
                .putLong(RestTimerNotificationHelper.KEY_UPDATED_AT_MS, now)
                .apply();
            RestTimerNotificationHelper.showOrUpdateCountdown(context, nextEnd, exerciseName, false);
            RestTimerPlugin.emitAction("adjust", nextEnd, now);
        }
    }
}
