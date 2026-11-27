/* ==========================================================================
   GYMTRACKER ABC — LAYER TIMER, AUDIO ALLARME, WAKE LOCK & NOTIFICHE
   ========================================================================== */
(function (global) {
  "use strict";

  const REST_NOTIF_ID = 91025;
  const REST_CHANNEL_ID = "gymtracker_rest_channel";
  const MAX_ALARM_MS = 45000;
  const ALARM_REPEAT_MS = 2400;

  let audioCtx = null;
  let wakeLockSentinel = null;
  let nativeChannelReady = false;
  let nativeActionListenerBound = false;
  let lastNativeActionAtMs = 0;
  let tickerId = null;
  let alarmLoopId = null;
  let lifecycleBound = false;
  let lastCountdownBeepSec = 0;

  let ctx = {
    getState: null,
    saveState: null,
    onTick: null
  };

  function flushActiveSessionOnExit() {
    const session = getActiveSession();
    if (!session) return;
    if (session.startedAtMs > 0 || (session.restTimer && session.restTimer.active)) {
      persist();
    }
  }

  function init(options) {
    ctx.getState = options.getState;
    ctx.saveState = options.saveState;
    ctx.onTick = options.onTick;

    // Riprende eventuale allarme attivo dopo reload
    const st = ctx.getState && ctx.getState();
    if (st && st.activeSession && st.activeSession.restTimer && st.activeSession.restTimer.active) {
      const rt = st.activeSession.restTimer;
      if (rt.endTimeMs <= Date.now() && rt.isAlarming) {
        startAlarmLoop();
      }
    }

    const nativePlugin = getNativeRestTimerPlugin();
    if (nativePlugin && !nativeActionListenerBound && typeof nativePlugin.addListener === "function") {
      nativeActionListenerBound = true;
      try {
        nativePlugin.addListener("restTimerAction", handleNativeRestAction);
      } catch { /* ignorato */ }
    }
    syncFromNativePendingState();

    if (!lifecycleBound && typeof global.addEventListener === "function") {
      lifecycleBound = true;
      global.addEventListener("pagehide", flushActiveSessionOnExit);
      global.addEventListener("beforeunload", flushActiveSessionOnExit);
    }

    if (tickerId) clearInterval(tickerId);
    tickerId = setInterval(tick, 250);
  }

  function getActiveSession() {
    const st = ctx.getState ? ctx.getState() : null;
    return st ? st.activeSession : null;
  }

  function getPrefs() {
    const st = ctx.getState ? ctx.getState() : null;
    return st ? st.prefs : { sound: true, notifications: true, wakeLock: true };
  }

  function persist() {
    if (ctx.saveState) ctx.saveState();
  }

  /* ========================================================================
     WAKE LOCK API
     ======================================================================== */
  async function syncWakeLock(shouldHold) {
    if (!("wakeLock" in navigator)) return;
    if (shouldHold && !wakeLockSentinel) {
      try {
        wakeLockSentinel = await navigator.wakeLock.request("screen");
        wakeLockSentinel.addEventListener("release", () => {
          wakeLockSentinel = null;
        });
      } catch { /* permesso negato o risparmio energetico */ }
    } else if (!shouldHold && wakeLockSentinel) {
      try {
        await wakeLockSentinel.release();
      } catch { /* ignorato */ }
      wakeLockSentinel = null;
    }
  }

  /* ========================================================================
     AUDIO WEB API (SBLOCCO AL TAP + BEEP + ALLARME RIPETUTO)
     ======================================================================== */
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const Ctx = global.AudioContext || global.webkitAudioContext;
        if (Ctx) audioCtx = new Ctx();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        const resumeResult = audioCtx.resume();
        if (resumeResult && typeof resumeResult.catch === "function") {
          resumeResult.catch(() => {});
        }
      }
    } catch { /* ignorato */ }
  }

  function canVibrate() {
    if (!navigator.vibrate) return false;
    const activation = navigator.userActivation;
    return !activation || activation.hasBeenActive;
  }

  function playCountdownTick() {
    const prefs = getPrefs();
    if (!prefs.sound) return;
    try {
      unlockAudio();
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(660, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.07);
    } catch { /* ignorato */ }
  }

  function playBeepPattern() {
    const prefs = getPrefs();
    if (!prefs.sound) return;
    try {
      unlockAudio();
      if (audioCtx) {
        const now = audioCtx.currentTime;
        // Sequenza più morbida e meno acuta (D6-F6-D6-A6) con triangle + lowpass
        const pattern = [
          { freq: 1174.66, start: 0.00, dur: 0.10 },
          { freq: 1396.91, start: 0.12, dur: 0.10 },
          { freq: 1174.66, start: 0.24, dur: 0.10 },
          { freq: 1760.00, start: 0.36, dur: 0.17 }
        ];
        const filter = audioCtx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.setValueAtTime(2600, now);
        filter.connect(audioCtx.destination);

        pattern.forEach(note => {
          const t0 = now + note.start;
          const oscMain = audioCtx.createOscillator();
          const oscSub = audioCtx.createOscillator();
          const gain = audioCtx.createGain();

          oscMain.type = "triangle";
          oscMain.frequency.setValueAtTime(note.freq, t0);
          oscSub.type = "sine";
          oscSub.frequency.setValueAtTime(note.freq * 0.5, t0);

          gain.gain.setValueAtTime(0.001, t0);
          gain.gain.exponentialRampToValueAtTime(0.38, t0 + 0.01);
          gain.gain.setValueAtTime(0.38, t0 + Math.max(0.02, note.dur - 0.03));
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + note.dur);

          oscMain.connect(gain);
          oscSub.connect(gain);
          gain.connect(filter);

          oscMain.start(t0);
          oscSub.start(t0);
          oscMain.stop(t0 + note.dur + 0.015);
          oscSub.stop(t0 + note.dur + 0.015);
        });
      }
      if (canVibrate()) {
        navigator.vibrate([240, 80, 240, 80, 240]);
      }
    } catch { /* ignorato */ }
  }

  function stopAlarmLoop() {
    if (alarmLoopId) {
      clearInterval(alarmLoopId);
      alarmLoopId = null;
    }
    if (canVibrate()) {
      try { navigator.vibrate(0); } catch { /* ignorato */ }
    }
  }

  function startAlarmLoop() {
    stopAlarmLoop();
    const session = getActiveSession();
    if (!session || !session.restTimer) return;
    if (!session.restTimer.alarmStartedAtMs) {
      session.restTimer.alarmStartedAtMs = Date.now();
    }
    session.restTimer.isAlarming = true;
    persist();

    playBeepPattern();
    alarmLoopId = setInterval(() => {
      const s = getActiveSession();
      if (!s || !s.restTimer || !s.restTimer.active || !s.restTimer.isAlarming) {
        stopAlarmLoop();
        return;
      }
      if (Date.now() - s.restTimer.alarmStartedAtMs >= MAX_ALARM_MS) {
        s.restTimer.isAlarming = false;
        persist();
        stopAlarmLoop();
        if (ctx.onTick) ctx.onTick();
        return;
      }
      playBeepPattern();
    }, ALARM_REPEAT_MS);
  }

  /* ========================================================================
     NOTIFICHE NATIVE (CAPACITOR LOCAL NOTIFICATIONS + WEB NOTIFICATION)
     ======================================================================== */
  function getNativeRestTimerPlugin() {
    return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.RestTimer
      ? global.Capacitor.Plugins.RestTimer
      : null;
  }

  function getCapacitorLocalNotifications() {
    return global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.LocalNotifications
      ? global.Capacitor.Plugins.LocalNotifications
      : null;
  }

  async function syncNativeCountdownStart(endTimeMs, exerciseName) {
    const prefs = getPrefs();
    if (!prefs.notifications) return false;
    const nativePlugin = getNativeRestTimerPlugin();
    if (!nativePlugin || typeof nativePlugin.startCountdown !== "function") return false;
    try {
      await nativePlugin.startCountdown({
        endTimeMs: Number(endTimeMs) || 0,
        exerciseName: String(exerciseName || "")
      });
      return true;
    } catch {
      return false;
    }
  }

  async function syncNativeCountdownCancel() {
    const nativePlugin = getNativeRestTimerPlugin();
    if (!nativePlugin || typeof nativePlugin.cancelCountdown !== "function") return;
    try {
      await nativePlugin.cancelCountdown();
    } catch { /* ignorato */ }
  }

  function handleNativeRestAction(data) {
    if (!data || !data.action) return;
    const updatedAt = Number(data.updatedAtMs) || Date.now();
    if (updatedAt <= lastNativeActionAtMs) return;
    lastNativeActionAtMs = updatedAt;

    const session = getActiveSession();
    if (!session || !session.restTimer) return;
    const rt = session.restTimer;

    if (data.action === "stop" || data.action === "expired") {
      finishRestManually(true);
      return;
    }

    if (data.action === "adjust") {
      const nextEndMs = Number(data.endTimeMs) || 0;
      if (nextEndMs > Date.now()) {
        rt.active = true;
        rt.endTimeMs = nextEndMs;
        rt.totalSec = Math.max(5, Math.ceil((nextEndMs - Date.now()) / 1000));
        rt.isAlarming = false;
        rt.alarmStartedAtMs = 0;
        lastCountdownBeepSec = 0;
        stopAlarmLoop();
        persist();
        if (ctx.onTick) ctx.onTick();
      } else {
        finishRestManually(true);
      }
    }
  }

  async function syncFromNativePendingState() {
    const nativePlugin = getNativeRestTimerPlugin();
    if (!nativePlugin || typeof nativePlugin.getPendingState !== "function") return;
    try {
      const res = await nativePlugin.getPendingState();
      if (res && res.action) {
        handleNativeRestAction(res);
      }
    } catch { /* ignorato */ }
  }

  async function ensureNativeNotificationReady() {
    const ln = getCapacitorLocalNotifications();
    if (!ln) return null;
    try {
      const perm = await ln.checkPermissions();
      if (perm.display !== "granted") {
        const req = await ln.requestPermissions();
        if (req.display !== "granted") return null;
      }
      if (!nativeChannelReady && typeof ln.createChannel === "function") {
        await ln.createChannel({
          id: REST_CHANNEL_ID,
          name: "Timer Recupero",
          description: "Avviso fine recupero tra le serie",
          importance: 5,
          visibility: 1,
          vibration: true
        });
        nativeChannelReady = true;
      }
      return ln;
    } catch {
      return null;
    }
  }

  async function scheduleRestNotification(endTimeMs, exerciseName) {
    const prefs = getPrefs();
    if (!prefs.notifications) return;

    const usedNativeCountdown = await syncNativeCountdownStart(endTimeMs, exerciseName);
    if (usedNativeCountdown) return;

    const ln = await ensureNativeNotificationReady();
    if (ln) {
      try {
        await ln.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
        if (endTimeMs > Date.now() + 1000) {
          await ln.schedule({
            notifications: [{
              id: REST_NOTIF_ID,
              title: "Recupero completato!",
              body: exerciseName ? `Pronto per la prossima serie: ${exerciseName}` : "Pronto per la prossima serie!",
              channelId: REST_CHANNEL_ID,
              schedule: { at: new Date(endTimeMs), allowWhileIdle: true }
            }]
          });
        }
      } catch { /* ignorato */ }
      return;
    }

    if ("Notification" in global && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* ignorato */ }
    }
  }

  async function cancelRestNotification() {
    await syncNativeCountdownCancel();
    const ln = getCapacitorLocalNotifications();
    if (!ln) return;
    try {
      await ln.cancel({ notifications: [{ id: REST_NOTIF_ID }] });
    } catch { /* ignorato */ }
  }

  function showBrowserEndNotification(exerciseName) {
    const prefs = getPrefs();
    if (!prefs.notifications || getCapacitorLocalNotifications()) return;
    if ("Notification" in global && Notification.permission === "granted" && document.visibilityState !== "visible") {
      try {
        new Notification("Recupero completato!", {
          body: exerciseName ? `Pronto per: ${exerciseName}` : "Pronto per la prossima serie!",
          icon: "icon.svg",
          tag: "gymtracker-rest"
        });
      } catch { /* ignorato */ }
    }
  }

  /* ========================================================================
     TIMER GLOBALE DI SESSIONE (TIMESTAMP-BASED)
     ======================================================================== */
  function startSessionIfIdle(routineId) {
    const session = getActiveSession();
    if (!session) return;
    if (routineId && !session.routineId) {
      session.routineId = routineId;
    }
    if (!session.startedAtMs) {
      session.startedAtMs = Date.now();
      session.pausedAccumMs = 0;
      session.pauseStartMs = 0;
      session.isPaused = false;
      persist();
      if (ctx.onTick) ctx.onTick();
    }
  }

  function setActiveRoutineContext(routineId) {
    const session = getActiveSession();
    if (!session) return;
    session.routineId = routineId;
    persist();
  }

  function toggleSessionPause() {
    const session = getActiveSession();
    if (!session || !session.startedAtMs) return;
    const now = Date.now();
    if (session.isPaused) {
      session.pausedAccumMs += Math.max(0, now - (session.pauseStartMs || now));
      session.pauseStartMs = 0;
      session.isPaused = false;
    } else {
      session.pauseStartMs = now;
      session.isPaused = true;
    }
    persist();
    if (ctx.onTick) ctx.onTick();
  }

  function resetSessionTimer() {
    const session = getActiveSession();
    if (!session) return;
    session.startedAtMs = 0;
    session.pausedAccumMs = 0;
    session.pauseStartMs = 0;
    session.isPaused = false;
    persist();
    if (ctx.onTick) ctx.onTick();
  }

  function getSessionElapsedSec() {
    const session = getActiveSession();
    if (!session || !session.startedAtMs) return 0;
    const refEnd = session.isPaused ? (session.pauseStartMs || Date.now()) : Date.now();
    const elapsedMs = Math.max(0, refEnd - session.startedAtMs - (session.pausedAccumMs || 0));
    return Math.floor(elapsedMs / 1000);
  }

  /* ========================================================================
     TIMER DI RECUPERO (TIMESTAMP-BASED + ALLARME RIPETUTO)
     ======================================================================== */
  function startRestTimer(seconds, exerciseName) {
    const session = getActiveSession();
    if (!session) return;
    const sec = Math.max(5, parseInt(seconds, 10) || 60);
    unlockAudio();
    stopAlarmLoop();
    lastCountdownBeepSec = 0;

    const rt = session.restTimer;
    rt.active = true;
    rt.totalSec = sec;
    rt.endTimeMs = Date.now() + sec * 1000;
    rt.exerciseName = exerciseName || "";
    rt.label = exerciseName ? `Recupero · ${exerciseName}` : "Recupero";
    rt.isAlarming = false;
    rt.alarmStartedAtMs = 0;

    persist();
    scheduleRestNotification(rt.endTimeMs, rt.exerciseName);
    if (ctx.onTick) ctx.onTick();
  }

  function adjustRestTimer(deltaSec) {
    const session = getActiveSession();
    if (!session || !session.restTimer || !session.restTimer.active) return;
    const rt = session.restTimer;
    const remMs = Math.max(0, rt.endTimeMs - Date.now());
    const wasFinished = remMs <= 0;
    const nextMs = Math.max(0, remMs + deltaSec * 1000);
    rt.endTimeMs = Date.now() + nextMs;
    const nextTotal = Math.max(5, Math.ceil(nextMs / 1000));
    rt.totalSec = wasFinished ? nextTotal : Math.max(rt.totalSec, nextTotal);
    lastCountdownBeepSec = 0;
    if (nextMs > 0) {
      rt.isAlarming = false;
      rt.alarmStartedAtMs = 0;
      stopAlarmLoop();
      scheduleRestNotification(rt.endTimeMs, rt.exerciseName);
    } else {
      cancelRestNotification();
    }
    persist();
    if (ctx.onTick) ctx.onTick();
  }

  function stopAlarm() {
    stopAlarmLoop();
    const session = getActiveSession();
    if (session && session.restTimer) {
      session.restTimer.isAlarming = false;
      persist();
    }
    if (ctx.onTick) ctx.onTick();
  }

  function finishRestManually(fromNative) {
    stopAlarmLoop();
    if (!fromNative) cancelRestNotification();
    const session = getActiveSession();
    if (session && session.restTimer) {
      const now = Date.now();
      session.restTimer.active = true;
      session.restTimer.endTimeMs = now;
      session.restTimer.isAlarming = false;
      session.restTimer.alarmStartedAtMs = now;
      persist();
    }
    if (ctx.onTick) ctx.onTick();
  }

  function closeRestTimer(fromNative) {
    stopAlarmLoop();
    if (!fromNative) cancelRestNotification();
    const session = getActiveSession();
    if (session && session.restTimer) {
      session.restTimer.active = false;
      session.restTimer.isAlarming = false;
      session.restTimer.alarmStartedAtMs = 0;
      persist();
    }
    if (ctx.onTick) ctx.onTick();
  }

  function getRestSnapshot() {
    const session = getActiveSession();
    const rt = session && session.restTimer ? session.restTimer : null;
    if (!rt || !rt.active) {
      return { active: false, remSec: 0, pct: 0, finished: false, isAlarming: false, label: "Recupero" };
    }
    const remMs = Math.max(0, rt.endTimeMs - Date.now());
    const remSec = Math.ceil(remMs / 1000);
    const pct = rt.totalSec > 0 ? Math.min(100, (remMs / (rt.totalSec * 1000)) * 100) : 0;
    return {
      active: true,
      remSec,
      pct,
      finished: remSec <= 0,
      isAlarming: Boolean(rt.isAlarming),
      label: rt.label,
      exerciseName: rt.exerciseName
    };
  }

  function tick() {
    const session = getActiveSession();
    if (!session) return;
    const rt = session.restTimer;
    if (rt && rt.active) {
      const remMs = Math.max(0, rt.endTimeMs - Date.now());
      const remSec = Math.ceil(remMs / 1000);
      if (remMs > 0 && !rt.isAlarming && remSec <= 3 && remSec >= 1 && remSec !== lastCountdownBeepSec) {
        lastCountdownBeepSec = remSec;
        playCountdownTick();
      }
      if (remMs <= 0 && !rt.isAlarming && !rt.alarmStartedAtMs) {
        lastCountdownBeepSec = 0;
        rt.alarmStartedAtMs = Date.now();
        rt.isAlarming = true;
        persist();
        syncNativeCountdownCancel();
        startAlarmLoop();
        showBrowserEndNotification(rt.exerciseName);
      }
    }
    if (ctx.onTick) ctx.onTick();
  }

  global.GymTimers = {
    init,
    syncWakeLock,
    unlockAudio,
    playBeepPattern,
    getCapacitorLocalNotifications,
    ensureNativeNotificationReady,
    cancelRestNotification,
    syncFromNativePendingState,
    startSessionIfIdle,
    setActiveRoutineContext,
    toggleSessionPause,
    resetSessionTimer,
    getSessionElapsedSec,
    startRestTimer,
    adjustRestTimer,
    stopAlarm,
    finishRestManually,
    closeRestTimer,
    getRestSnapshot,
    tick
  };
})(window);
