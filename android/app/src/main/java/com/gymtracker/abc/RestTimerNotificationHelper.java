package com.gymtracker.abc;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

public final class RestTimerNotificationHelper {

    public static final String PREFS_NAME = "gymtracker_rest_native";
    public static final String KEY_ACTIVE = "active";
    public static final String KEY_END_TIME_MS = "endTimeMs";
    public static final String KEY_EXERCISE_NAME = "exerciseName";
    public static final String KEY_LAST_ACTION = "lastAction";
    public static final String KEY_UPDATED_AT_MS = "updatedAtMs";

    public static final String CHANNEL_ONGOING_ID = "gymtracker_rest_ongoing";
    public static final String CHANNEL_DONE_ID = "gymtracker_rest_done";

    public static final int NOTIF_ONGOING_ID = 92001;
    public static final int NOTIF_DONE_ID = 92002;
    private static final int ALARM_REQUEST_CODE = 92010;

    public static final String ACTION_MINUS_15 = "com.gymtracker.abc.REST_MINUS_15";
    public static final String ACTION_PLUS_15 = "com.gymtracker.abc.REST_PLUS_15";
    public static final String ACTION_STOP = "com.gymtracker.abc.REST_STOP";
    public static final String ACTION_TIMER_EXPIRED = "com.gymtracker.abc.REST_EXPIRED";

    private RestTimerNotificationHelper() {}

    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel ongoing = new NotificationChannel(
            CHANNEL_ONGOING_ID,
            "Recupero in corso",
            NotificationManager.IMPORTANCE_LOW
        );
        ongoing.setDescription("Mostra il countdown del recupero anche con app in background");
        ongoing.setShowBadge(false);
        ongoing.setSound(null, null);
        ongoing.enableVibration(false);
        nm.createNotificationChannel(ongoing);

        NotificationChannel done = new NotificationChannel(
            CHANNEL_DONE_ID,
            "Fine Recupero",
            NotificationManager.IMPORTANCE_HIGH
        );
        done.setDescription("Avviso alla scadenza del recupero");
        done.enableVibration(true);
        nm.createNotificationChannel(done);
    }

    public static void showOrUpdateCountdown(Context ctx, long endTimeMs, String exerciseName, boolean clearAction) {
        ensureChannels(ctx);
        String safeName = exerciseName == null ? "" : exerciseName.trim();

        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ACTIVE, true)
            .putLong(KEY_END_TIME_MS, endTimeMs)
            .putString(KEY_EXERCISE_NAME, safeName);
        if (clearAction) {
            ed.putString(KEY_LAST_ACTION, "");
        }
        ed.apply();

        String title = safeName.isEmpty() ? "Recupero in corso" : "Recupero · " + safeName;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ONGOING_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText("Controlla o regola il recupero")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setWhen(endTimeMs)
            .setShowWhen(true)
            .setContentIntent(buildOpenAppIntent(ctx))
            .addAction(0, "-15s", buildActionIntent(ctx, ACTION_MINUS_15, 92011))
            .addAction(0, "+15s", buildActionIntent(ctx, ACTION_PLUS_15, 92012))
            .addAction(0, "Ferma", buildActionIntent(ctx, ACTION_STOP, 92013));

        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(NOTIF_DONE_ID);
        try {
            nm.notify(NOTIF_ONGOING_ID, builder.build());
        } catch (SecurityException ignored) {
            // Permesso POST_NOTIFICATIONS non ancora concesso su Android 13+
        }

        scheduleExactAlarm(ctx, endTimeMs);
    }

    public static void cancelCountdown(Context ctx, boolean clearAction) {
        cancelExactAlarm(ctx);
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putLong(KEY_END_TIME_MS, 0L);
        if (clearAction) {
            ed.putString(KEY_LAST_ACTION, "");
        }
        ed.apply();

        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(NOTIF_ONGOING_ID);
        nm.cancel(NOTIF_DONE_ID);
    }

    public static void showFinishedNotification(Context ctx, String exerciseName) {
        ensureChannels(ctx);
        cancelExactAlarm(ctx);
        String safeName = exerciseName == null ? "" : exerciseName.trim();

        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_ACTIVE, false)
            .putLong(KEY_END_TIME_MS, 0L)
            .apply();

        String body = safeName.isEmpty()
            ? "Pronto per la prossima serie!"
            : "Pronto per la prossima serie: " + safeName;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_DONE_ID)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle("✅ Recupero completato!")
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(buildOpenAppIntent(ctx))
            .addAction(0, "+15s", buildActionIntent(ctx, ACTION_PLUS_15, 92012));

        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(NOTIF_ONGOING_ID);
        try {
            nm.notify(NOTIF_DONE_ID, builder.build());
        } catch (SecurityException ignored) {
        }
    }

    private static PendingIntent buildOpenAppIntent(Context ctx) {
        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            ctx,
            92000,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent buildActionIntent(Context ctx, String action, int requestCode) {
        Intent intent = new Intent(ctx, RestTimerActionReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(
            ctx,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static void scheduleExactAlarm(Context ctx, long endTimeMs) {
        if (endTimeMs <= System.currentTimeMillis() + 500L) return;
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = buildActionIntent(ctx, ACTION_TIMER_EXPIRED, ALARM_REQUEST_CODE);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endTimeMs, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endTimeMs, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endTimeMs, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, endTimeMs, pi);
            }
        } catch (SecurityException ignored) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endTimeMs, pi);
        }
    }

    private static void cancelExactAlarm(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        am.cancel(buildActionIntent(ctx, ACTION_TIMER_EXPIRED, ALARM_REQUEST_CODE));
    }
}
