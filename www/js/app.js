/* ==========================================================================
   GYMTRACKER ABC — LOGICA APPLICATIVA PRINCIPALE (UI, SUPERSERIE, CATALOGO)
   ========================================================================== */
(function (global) {
  "use strict";

  const S = global.GymStorage;
  const T = global.GymTimers;
  const APP_BUILD = "2026-11-27.4";

  let state = null;
  let currentTab = "train";
  let selectedProgressKey = ""; // catalogId oppure "name:<norm>"
  let selectedProgressMetric = "orm"; // "orm" | "maxWeight" | "volume"
  let weeklyScope = "week"; // "week" | "month" | "year" | "all"
  let selectedHistoryRoutine = "ALL";
  const collapsedExerciseIds = new Set();
  let recoveryBannerDismissed = false;
  let toastTimer = null;
  let restAutoCloseTimerId = null;

  function hapticTap(ms) {
    if (navigator && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(ms || 12); } catch { /* ignorato */ }
    }
  }

  /* ========================================================================
     FORMATTAZIONE & UTILITY UI
     ======================================================================== */
  function esc(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDec(num) {
    const n = Math.round(S.parseNum(num) * 10) / 10;
    return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
  }

  function weightInputValue(value) {
    return String(value == null ? "" : value).trim().replace(".", ",");
  }

  function formatInt(num) {
    return Math.round(S.parseNum(num)).toLocaleString("it-IT");
  }

  function formatSeconds(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function formatRestBadge(sec) {
    const s = parseInt(sec, 10) || 60;
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m}m` : `${m}m ${r}s`;
  }

  function formatDateIT(isoStr) {
    try {
      return new Date(isoStr).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch {
      return isoStr || "";
    }
  }

  function formatShortDateIT(isoStr) {
    try {
      return new Date(isoStr).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });
    } catch {
      return "";
    }
  }

  function getFocusBadgeClass(focus) {
    const f = String(focus || "").toLowerCase();
    if (f.includes("forza")) return "badge-forza";
    if (f.includes("core")) return "badge-core";
    return "badge-ipertrofia";
  }

  function parseRirNumeric(rirStr) {
    const val = String(rirStr == null ? "" : rirStr).trim();
    if (val === "0") return 0;
    if (val === "1") return 1;
    if (val === "2") return 2;
    if (val === "3+" || val === "3") return 3;
    return null;
  }

  function persist() {
    if (!S.saveState(state)) {
      showToast("Impossibile salvare in memoria locale", "danger");
    }
  }

  function getPreferredRoundingStep() {
    return S.normalizeWeightStep(state && state.prefs ? state.prefs.weightStep : 2.5);
  }

  function formatBytes(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
    return `${(n / 1048576).toFixed(1).replace(".", ",")} MB`;
  }

  function ensureValidRoutineIds() {
    if (!state.routines.some(r => r.id === state.activeRoutineId)) {
      state.activeRoutineId = state.routines[0] ? state.routines[0].id : null;
    }
    if (!state.routines.some(r => r.id === state.manageRoutineId)) {
      state.manageRoutineId = state.routines[0] ? state.routines[0].id : null;
    }
  }

  function showToast(msg, type, durationMs) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show" + (type === "success" ? " toast-success" : type === "danger" ? " toast-danger" : "");
    if (toastTimer) clearTimeout(toastTimer);
    const ms = Number(durationMs) > 0 ? Number(durationMs) : 2700;
    toastTimer = setTimeout(() => el.classList.remove("show"), ms);
  }

  function showRestCompletedToast() {
    showToast("✅ Recupero completato! Pronto per la prossima serie", "success", 3000);
  }

  function openModal(opts) {
    const backdrop = document.getElementById("modalBackdrop");
    document.getElementById("modalTitle").textContent = opts.title || "";
    document.getElementById("modalBody").innerHTML = opts.bodyHtml || "";
    const footer = document.getElementById("modalFooter");
    footer.innerHTML = "";
    (opts.buttons || []).forEach(cfg => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn ${cfg.className || "btn-secondary"}`;
      btn.textContent = cfg.label;
      btn.addEventListener("click", () => {
        if (cfg.onClick) {
          const keepOpen = cfg.onClick();
          if (keepOpen !== true) closeModal();
        } else {
          closeModal();
        }
      });
      footer.appendChild(btn);
    });
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    const backdrop = document.getElementById("modalBackdrop");
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
  }

  /* ========================================================================
     RICERCA STORICO & 1RM PER CATALOGID / NOME
     ======================================================================== */
  function matchesExercise(histEx, targetEx) {
    if (!histEx || !targetEx) return false;
    if (histEx.catalogId && targetEx.catalogId && histEx.catalogId === targetEx.catalogId) return true;
    return S.normalizeName(histEx.name) === S.normalizeName(targetEx.name);
  }

  function getSortedHistoryDesc() {
    if (!state || !Array.isArray(state.history)) return [];
    return state.history.slice().sort((a, b) => {
      const ta = new Date(a.dateISO || 0).getTime() || 0;
      const tb = new Date(b.dateISO || 0).getTime() || 0;
      return tb - ta;
    });
  }

  function getLastExerciseSummary(ex) {
    for (const sess of getSortedHistoryDesc()) {
      const found = (sess.exercises || []).find(e => matchesExercise(e, ex) && e.sets && e.sets.length > 0);
      if (found) {
        const workingSets = found.sets.filter(s => !s.warmup);
        const refSets = workingSets.length ? workingSets : found.sets;
        let best = null;
        for (const s of refSets) {
          const orm = s.orm != null ? S.parseNum(s.orm) : S.calcEpley1RM(s.weight, s.reps);
          const candidate = { weight: S.parseNum(s.weight), reps: Math.round(S.parseNum(s.reps)), rir: s.rir || "-", orm };
          if (!best || candidate.orm > best.orm || (candidate.orm === best.orm && candidate.weight > best.weight)) {
            best = candidate;
          }
        }
        return { sessionId: sess.id, dateISO: sess.dateISO, sets: refSets, bestSet: best };
      }
    }
    return null;
  }

  function getBestHistoricalStats(ex) {
    let best1RM = 0;
    let maxWeight = 0;
    for (const sess of state.history) {
      const found = (sess.exercises || []).find(e => matchesExercise(e, ex) && e.sets && e.sets.length > 0);
      if (found) {
        for (const s of found.sets) {
          if (s.warmup) continue;
          const w = S.parseNum(s.weight);
          const orm = s.orm != null ? S.parseNum(s.orm) : S.calcEpley1RM(w, s.reps);
          if (orm > best1RM) best1RM = orm;
          if (w > maxWeight) maxWeight = w;
        }
      }
    }
    return { best1RM, maxWeight };
  }

  function getBestHistorical1RM(ex) {
    return getBestHistoricalStats(ex).best1RM;
  }

  /* ========================================================================
     SELETTORE DINAMICO STIMOLO (FORZA vs IPERTROFIA)
     ======================================================================== */
  function computeStimulusPreset(ex, stimulus) {
    const isForza = stimulus === "Forza";
    const isCore = stimulus === "Core";
    const best1RM = getBestHistorical1RM(ex);
    const roundingStep = getPreferredRoundingStep();

    let suggestedWeight = S.parseNum(ex && ex.defaultWeight);
    if (best1RM > 0 && !isCore) {
      const pct = isForza ? 0.825 : 0.70;
      suggestedWeight = S.roundToGymStep(best1RM * pct, roundingStep);
    }

    if (isCore) {
      return {
        stimulus: "Ipertrofia",
        focus: "Core",
        sets: 3,
        repsTarget: "12–15",
        restSec: 60,
        suggestedWeight
      };
    }

    return {
      stimulus: isForza ? "Forza" : "Ipertrofia",
      focus: isForza ? "Forza" : "Ipertrofia",
      sets: isForza ? 4 : 3,
      repsTarget: isForza ? "4–6" : "8–12",
      restSec: isForza ? (S.isLegExercise(ex && ex.muscleGroup, ex && ex.name) ? 180 : 150) : 90,
      suggestedWeight
    };
  }

  /* ========================================================================
     BOZZE & CRASH RECOVERY
     ======================================================================== */
  function getOrCreateDraft(routine) {
    if (!routine) return null;
    let draft = state.drafts[routine.id];
    if (!draft) {
      draft = { exercises: {}, note: "" };
      state.drafts[routine.id] = draft;
    }
    let changed = false;
    for (const ex of routine.exercises) {
      if (!Array.isArray(draft.exercises[ex.id]) || draft.exercises[ex.id].length === 0) {
        const lastInfo = getLastExerciseSummary(ex);
        const fallbackReps = S.extractTargetRepsDefault(ex.repsTarget);
        const arr = [];
        const numSets = Math.max(1, parseInt(ex.sets, 10) || 3);
        const autoAdvice = (state && state.prefs && state.prefs.autoApplyAdvice && lastInfo)
          ? computeProgressionAdvice(ex, lastInfo)
          : null;
        const useSuggested = Boolean(autoAdvice && autoAdvice.suggestedWeight && autoAdvice.suggestedWeight > 0);
        for (let i = 0; i < numSets; i++) {
          const prevSet = lastInfo && lastInfo.sets[i]
            ? lastInfo.sets[i]
            : (lastInfo && lastInfo.sets[lastInfo.sets.length - 1]);
          const w = useSuggested
            ? autoAdvice.suggestedWeight
            : (prevSet ? prevSet.weight : (ex.defaultWeight > 0 ? ex.defaultWeight : ""));
          const r = (useSuggested && autoAdvice.suggestedReps)
            ? autoAdvice.suggestedReps
            : (prevSet ? prevSet.reps : fallbackReps);
          const rir = useSuggested ? "-" : (prevSet && prevSet.rir ? prevSet.rir : "-");
          arr.push({
            weight: w === 0 || w === "" ? "" : weightInputValue(w),
            reps: String(r),
            rir: S.RIR_OPTIONS.includes(rir) ? rir : "-",
            done: false
          });
        }
        draft.exercises[ex.id] = arr;
        changed = true;
      }
    }
    if (changed) persist();
    return draft;
  }

  function detectRecoverableSession() {
    const sess = state.activeSession || {};
    let targetRid = sess.routineId && state.routines.some(r => r.id === sess.routineId) ? sess.routineId : null;
    let doneCount = 0;
    let hasNotes = false;

    for (const r of state.routines) {
      const d = state.drafts[r.id];
      if (!d) continue;
      let rDone = 0;
      for (const ex of r.exercises) {
        const arr = (d.exercises && d.exercises[ex.id]) || [];
        rDone += arr.filter(s => s.done).length;
      }
      const rNote = Boolean((d.note || "").trim());
      if (rDone > 0 || rNote) {
        if (!targetRid || r.id === targetRid) {
          targetRid = r.id;
          doneCount = rDone;
          hasNotes = rNote;
        }
      }
    }

    const timerRunning = Boolean(sess.startedAtMs > 0) || Boolean(sess.restTimer && sess.restTimer.active);
    if (!targetRid && !timerRunning) return null;

    const routine = state.routines.find(r => r.id === (targetRid || state.activeRoutineId));
    if (!routine) return null;

    if (doneCount === 0 && !hasNotes && !timerRunning) return null;
    return { routine, doneCount, hasNotes, timerRunning };
  }

  function renderRecoveryBanner() {
    const bannerEl = document.getElementById("crashRecoveryBanner");
    if (!bannerEl) return;
    if (recoveryBannerDismissed) {
      bannerEl.style.display = "none";
      return;
    }
    const rec = detectRecoverableSession();
    if (!rec) {
      bannerEl.style.display = "none";
      return;
    }

    const elapsed = T.getSessionElapsedSec();
    const timePart = elapsed > 0 ? ` · ⏱️ ${formatDuration(elapsed)}` : "";
    const setsPart = rec.doneCount > 0 ? ` · ${rec.doneCount} serie fatte` : "";

    bannerEl.style.display = "block";
    bannerEl.innerHTML = `
      <div class="recovery-banner">
        <div class="recovery-info">
          <div class="recovery-title">⚡ Allenamento in corso ripristinato</div>
          <div class="recovery-sub">${esc(rec.routine.name)}${setsPart}${timePart}</div>
        </div>
        <div class="recovery-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btnRecoveryResume">Riprendi</button>
          <button type="button" class="btn btn-danger btn-sm" id="btnRecoveryDiscard">Scarta</button>
        </div>
      </div>
    `;

    document.getElementById("btnRecoveryResume").addEventListener("click", () => {
      state.activeRoutineId = rec.routine.id;
      T.setActiveRoutineContext(rec.routine.id);
      recoveryBannerDismissed = true;
      persist();
      renderRecoveryBanner();
      switchTab("train");
      updateTimersUI();
    });

    document.getElementById("btnRecoveryDiscard").addEventListener("click", () => {
      openModal({
        title: "Scarta Sessione in Corso",
        bodyHtml: `<p style="margin:0; color:var(--text-muted); font-size:0.9rem;">Vuoi scartare l'allenamento non salvato di <strong>${esc(rec.routine.name)}</strong> e azzerare i timer?</p>`,
        buttons: [
          { label: "Annulla", className: "btn-secondary" },
          {
            label: "Scarta",
            className: "btn-danger",
            onClick: () => {
              delete state.drafts[rec.routine.id];
              T.closeRestTimer();
              T.resetSessionTimer();
              state.activeSession.routineId = null;
              recoveryBannerDismissed = true;
              persist();
              renderRecoveryBanner();
              renderCurrentTab();
              showToast("Sessione in corso scartata");
            }
          }
        ]
      });
    });
  }

  /* ========================================================================
     SUPERSERIE ACCORPATE (GROUPING HELPER)
     ======================================================================== */
  function groupRoutineExercises(exercises) {
    const groups = [];
    let i = 0;
    while (i < exercises.length) {
      const curr = exercises[i];
      const next = exercises[i + 1];
      if (curr.supersetGroupId && next && next.supersetGroupId === curr.supersetGroupId) {
        groups.push({
          type: "superset",
          groupId: curr.supersetGroupId,
          items: [curr, next],
          indices: [i, i + 1]
        });
        i += 2;
      } else {
        groups.push({
          type: "single",
          item: curr,
          index: i
        });
        i += 1;
      }
    }
    return groups;
  }

  /* ========================================================================
     UPDATE LIVE TIMER GLOBALE & TIMER RECUPERO (CHIAMATO DAL TICKER)
     ======================================================================== */
  function clearRestAutoCloseTimer() {
    if (restAutoCloseTimerId) {
      clearTimeout(restAutoCloseTimerId);
      restAutoCloseTimerId = null;
    }
  }

  function updateTimersUI() {
    // 1. Timer globale di sessione
    const sessClockEl = document.getElementById("sessionClockDisplay");
    const sessToggleBtn = document.getElementById("btnSessionTimerToggle");
    const sessStatusDot = document.getElementById("sessionClockDot");

    if (sessClockEl) {
      const elapsed = T.getSessionElapsedSec();
      sessClockEl.textContent = formatDuration(elapsed);
      const sess = state.activeSession;
      const isRunning = Boolean(sess.startedAtMs > 0 && !sess.isPaused);
      const isPaused = Boolean(sess.startedAtMs > 0 && sess.isPaused);

      if (sessStatusDot) {
        sessStatusDot.className = "session-dot " + (isRunning ? "running" : isPaused ? "paused" : "");
      }
      if (sessToggleBtn) {
        if (!sess.startedAtMs) {
          sessToggleBtn.textContent = "Avvia";
        } else if (sess.isPaused) {
          sessToggleBtn.textContent = "Riprendi";
        } else {
          sessToggleBtn.textContent = "Pausa";
        }
      }
    }

    // 2. Timer di recupero flottante
    const bar = document.getElementById("restTimerBar");
    if (!bar) return;
    const snap = T.getRestSnapshot();
    if (!snap.active) {
      clearRestAutoCloseTimer();
      bar.classList.remove("visible", "finished", "alarming");
      return;
    }

    document.getElementById("restExerciseLabel").textContent = snap.finished
      ? "✅ Recupero completato! Pronto per la prossima serie"
      : snap.label;
    document.getElementById("restCountdown").textContent = snap.finished
      ? (snap.isAlarming ? "VIA!" : "FATTO!")
      : formatSeconds(snap.remSec);
    document.getElementById("restProgressBar").style.width = `${snap.pct}%`;

    const minusBtn = document.getElementById("restMinus15");
    const plusBtn = document.getElementById("restPlus15");
    const plus30Btn = document.getElementById("restPlus30");
    const stopAlarmBtn = document.getElementById("restStopAlarmBtn");
    const finishBtn = document.getElementById("restFinishBtn");
    const closeBtn = document.getElementById("restCloseBtn");

    if (snap.isAlarming) {
      if (minusBtn) minusBtn.style.display = "none";
      if (plusBtn) plusBtn.style.display = "inline-flex";
      if (plus30Btn) plus30Btn.style.display = "inline-flex";
      if (stopAlarmBtn) stopAlarmBtn.style.display = "inline-flex";
      if (finishBtn) finishBtn.style.display = "none";
      if (closeBtn) closeBtn.textContent = "✕";
    } else if (snap.finished) {
      if (minusBtn) minusBtn.style.display = "none";
      if (plusBtn) plusBtn.style.display = "inline-flex";
      if (plus30Btn) plus30Btn.style.display = "inline-flex";
      if (stopAlarmBtn) stopAlarmBtn.style.display = "none";
      if (finishBtn) finishBtn.style.display = "none";
      if (closeBtn) closeBtn.textContent = "✕";
    } else {
      if (minusBtn) minusBtn.style.display = "inline-flex";
      if (plusBtn) plusBtn.style.display = "inline-flex";
      if (plus30Btn) plus30Btn.style.display = "none";
      if (stopAlarmBtn) stopAlarmBtn.style.display = "none";
      if (finishBtn) finishBtn.style.display = "inline-flex";
      if (closeBtn) closeBtn.textContent = "✕";
    }

    bar.classList.add("visible");
    bar.classList.toggle("finished", snap.finished);
    bar.classList.toggle("alarming", snap.isAlarming);

    // Dopo la fine del recupero la barra resta visibile per qualche secondo (5s) poi sparisce automaticamente.
    // Durante l'allarme non si chiude; se l'utente aggiunge tempo (+15s/+30s) il timer viene annullato.
    if (snap.finished && !snap.isAlarming) {
      if (!restAutoCloseTimerId) {
        restAutoCloseTimerId = setTimeout(() => {
          restAutoCloseTimerId = null;
          T.closeRestTimer();
          updateTimersUI();
        }, 5000);
      }
    } else {
      clearRestAutoCloseTimer();
    }
  }

  /* ========================================================================
     SEZIONE 1: TAB "ALLENA"
     ======================================================================== */
  function computeLiveSessionMetrics(routine, draft) {
    let totalSets = 0;
    let doneSets = 0;
    let totalVolume = 0;
    let best1RM = 0;

    for (const ex of routine.exercises) {
      const sets = (draft && draft.exercises[ex.id]) || [];
      for (const s of sets) {
        if (s.warmup) continue;
        totalSets++;
        if (s.done) {
          doneSets++;
          const w = S.parseNum(s.weight);
          const r = Math.round(S.parseNum(s.reps));
          totalVolume += w * r;
          const orm = S.calcEpley1RM(w, r);
          if (orm > best1RM) best1RM = orm;
        }
      }
    }
    const pct = totalSets > 0 ? Math.round((doneSets / totalSets) * 100) : 0;
    return { totalSets, doneSets, pct, totalVolume: Math.round(totalVolume), best1RM };
  }

  function updateDashboardMetricsDOM(routine, draft) {
    const m = computeLiveSessionMetrics(routine, draft);
    const setsEl = document.getElementById("dashSetsVal");
    const volEl = document.getElementById("dashVolVal");
    const ormEl = document.getElementById("dashOrmVal");
    const barEl = document.getElementById("dashProgressFill");
    if (setsEl) setsEl.textContent = `${m.doneSets}/${m.totalSets}`;
    if (volEl) volEl.textContent = `${formatInt(m.totalVolume)} kg`;
    if (ormEl) ormEl.textContent = m.best1RM > 0 ? `${formatDec(m.best1RM)} kg` : "—";
    if (barEl) barEl.style.width = `${m.pct}%`;
  }

  function parseRepsRange(repsTarget, focus) {
    const nums = String(repsTarget || "").match(/\d+/g);
    if (nums && nums.length >= 2) {
      const a = parseInt(nums[0], 10);
      const b = parseInt(nums[1], 10);
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    if (nums && nums.length === 1) {
      const v = parseInt(nums[0], 10);
      return { min: v, max: v };
    }
    if (focus === "Forza") return { min: 4, max: 6 };
    if (focus === "Core") return { min: 12, max: 15 };
    return { min: 8, max: 12 };
  }

  /**
   * Calcola il consiglio di progressione (aumenta, mantieni, diminuisci)
   * distinguendo le regole tra Forza e Ipertrofia/Core e integrando il RIR se abilitato.
   */
  function computeProgressionAdvice(ex, lastInfo) {
    if (!lastInfo || !Array.isArray(lastInfo.sets) || lastInfo.sets.length === 0) {
      return null;
    }
    const validSets = lastInfo.sets.filter(s => !s.warmup && Math.round(S.parseNum(s.reps)) > 0);
    if (!validSets.length) return null;

    const range = parseRepsRange(ex.repsTarget, ex.focus);
    const roundStep = getPreferredRoundingStep();
    const isForza = ex.focus === "Forza" || ex.stimulus === "Forza";
    const categoryLabel = isForza ? "Forza" : (ex.focus === "Core" ? "Core" : "Ipertrofia");

    const topWeight = Math.max(...validSets.map(s => S.parseNum(s.weight)));
    if (topWeight <= 0) {
      return {
        action: "calibrate",
        categoryLabel,
        title: "Imposta il carico di riferimento",
        reason: "Registra almeno una serie allenante con carico in kg per attivare i consigli.",
        suggestedWeight: null,
        suggestedReps: null
      };
    }

    const useRir = Boolean(!state || !state.prefs || state.prefs.useRirInAdvice !== false);
    let bestSet1RM = 0;
    let bestSetWeight = topWeight;
    let bestSetReps = 0;

    validSets.forEach(s => {
      const w = S.parseNum(s.weight);
      const r = Math.round(S.parseNum(s.reps));
      const rirVal = useRir ? parseRirNumeric(s.rir) : null;
      const effReps = r + (rirVal !== null ? rirVal : 0);
      const orm = w <= 0 ? 0 : (effReps <= 1 ? w : w * (1 + effReps / 30));
      if (orm > bestSet1RM || (orm === bestSet1RM && w > bestSetWeight)) {
        bestSet1RM = orm;
        bestSetWeight = w;
        bestSetReps = r;
      }
    });

    const repsList = validSets.map(s => Math.round(S.parseNum(s.reps)));
    const n = repsList.length;
    const avgReps = repsList.reduce((a, b) => a + b, 0) / n;
    const minRepsDone = Math.min(...repsList);
    const hitTopCount = repsList.filter(r => r >= range.max).length;
    const belowMinCount = repsList.filter(r => r < range.min).length;

    const hitTopOnAll = hitTopCount === n;
    const hitTopOnMajority = hitTopCount >= Math.ceil(n / 2);
    const belowMinOnAny = belowMinCount > 0;
    const belowMinOnMajority = belowMinCount >= Math.ceil(n / 2);

    const rirNums = useRir ? validSets.map(s => parseRirNumeric(s.rir)).filter(v => v !== null) : [];
    const hasRir = rirNums.length > 0;
    const avgRir = hasRir ? rirNums.reduce((a, b) => a + b, 0) / rirNums.length : null;
    const rirInfo = hasRir ? ` · RIR medio ${formatDec(avgRir)}` : "";

    const targetReps = range.min;
    const targetRir = hasRir ? (isForza ? 2 : 1.5) : 0;
    const idealWeight = bestSet1RM / (1 + (targetReps + targetRir) / 30);

    const minInc = Math.round((topWeight + roundStep) * 100) / 100;
    const maxInc = Math.max(minInc, S.roundToGymStep(topWeight * 1.35, roundStep));
    const incWeight = Math.min(maxInc, Math.max(minInc, S.roundToGymStep(idealWeight, roundStep)));
    const incDelta = Math.round((incWeight - topWeight) * 100) / 100;

    const minDec = S.roundToGymStep(topWeight * 0.65, roundStep);
    const maxDec = Math.max(0, Math.round((topWeight - roundStep) * 100) / 100);
    const decWeight = Math.max(0, Math.min(maxDec, Math.max(minDec, S.roundToGymStep(idealWeight, roundStep))));
    const decDelta = Math.round((topWeight - decWeight) * 100) / 100;

    if (isForza) {
      if (belowMinOnMajority || (belowMinOnAny && hasRir && avgRir <= 0.5)) {
        return {
          action: "decrease",
          categoryLabel,
          title: `📉 Riduci a ${formatDec(decWeight)} kg (−${formatDec(decDelta)} kg)`,
          reason: `Ripetizioni sotto il target (${minRepsDone} < ${range.min})${rirInfo}: alleggerisci a ${formatDec(decWeight)} kg per rientrare nel range ${range.min}–${range.max} con tecnica pulita.`,
          suggestedWeight: decWeight,
          suggestedReps: range.min
        };
      }
      const canIncreaseForza = avgReps >= range.max + 2 || (hasRir
        ? ((hitTopOnAll && avgRir >= 1.5) || (avgReps >= range.max && avgRir >= 2))
        : hitTopOnAll);
      if (canIncreaseForza) {
        const isBigJump = incDelta > roundStep;
        return {
          action: "increase",
          categoryLabel,
          title: `📈 Aumenta a ${formatDec(incWeight)} kg (+${formatDec(incDelta)} kg)`,
          reason: isBigJump
            ? `Con ${formatDec(bestSetWeight)} kg × ${bestSetReps} hai ampio margine${rirInfo}: passa a ${formatDec(incWeight)} kg (+${formatDec(incDelta)} kg) per lavorare su ~${targetReps} rip${hasRir ? " con RIR ~" + formatDec(targetRir) : ""}.`
            : `Target ${range.max} rip. chiuso con margine${rirInfo}: pronto a progredire ripartendo da ${range.min} rip.`,
          suggestedWeight: incWeight,
          suggestedReps: range.min
        };
      }
      return {
        action: "maintain",
        categoryLabel,
        title: `🎯 Mantieni ${formatDec(topWeight)} kg`,
        reason: (hitTopOnAll && hasRir && avgRir < 1.5)
          ? `Target chiuso ma margine ridotto (${rirInfo.replace(" · ", "")}): consolida velocità e tecnica prima di salire.`
          : `Punta a chiudere tutte le serie a ${range.max} rip.${hasRir ? " con RIR 1–2" : ""} prima di aumentare${rirInfo}.`,
        suggestedWeight: topWeight,
        suggestedReps: Math.min(range.max, Math.max(range.min, Math.round(avgReps)))
      };
    }

    if (belowMinOnMajority || minRepsDone < range.min - 1) {
      return {
        action: "decrease",
        categoryLabel,
        title: `📉 Riduci a ${formatDec(decWeight)} kg (−${formatDec(decDelta)} kg)`,
        reason: `Ripetizioni sotto il range (${minRepsDone} < ${range.min})${rirInfo}: scendi a ${formatDec(decWeight)} kg per rientrare nel range ${range.min}–${range.max}.`,
        suggestedWeight: decWeight,
        suggestedReps: range.min
      };
    }

    const canIncreaseHyper = avgReps >= range.max + 2 || (hasRir
      ? ((hitTopOnAll && avgRir >= 1) || (hitTopOnMajority && avgRir >= 2) || (avgReps >= range.min && avgRir >= 2.8))
      : (hitTopOnAll || (hitTopOnMajority && minRepsDone >= range.max - 1)));
    if (canIncreaseHyper) {
      const isBigJump = incDelta > roundStep;
      return {
        action: "increase",
        categoryLabel,
        title: `📈 Aumenta a ${formatDec(incWeight)} kg (+${formatDec(incDelta)} kg)`,
        reason: isBigJump
          ? `Con ${formatDec(bestSetWeight)} kg × ${bestSetReps} superi il target${rirInfo}: passa a ${formatDec(incWeight)} kg (+${formatDec(incDelta)} kg) per lavorare su ~${targetReps} rip${hasRir ? " con RIR ~" + formatDec(targetRir) : ""}.`
          : `Ottimo volume nel range${rirInfo}: sali di +${formatDec(incDelta)} kg e riparti da ${range.min} rip.`,
        suggestedWeight: incWeight,
        suggestedReps: range.min
      };
    }

    return {
      action: "maintain",
      categoryLabel,
      title: `🎯 Mantieni ${formatDec(topWeight)} kg`,
      reason: (hasRir && avgRir < 1)
        ? `Effort vicino al cedimento (${rirInfo.replace(" · ", "")}): consolida il carico attuale.`
        : `Aggiungi +1 rip. verso ${range.max} rip. con questo peso${rirInfo}.`,
      suggestedWeight: topWeight,
      suggestedReps: Math.min(range.max, Math.max(range.min, Math.round(avgReps) + (hitTopOnAll ? 0 : 1)))
    };
  }

  function detectDeloadNeed(ex) {
    const entries = [];
    const exIsForza = ex.focus === "Forza" || ex.stimulus === "Forza";
    for (const sess of getSortedHistoryDesc()) {
      const found = (sess.exercises || []).find(e => {
        if (!matchesExercise(e, ex) || !e.sets || !e.sets.length) return false;
        if (e.focus && ex.focus) {
          const histIsForza = e.focus === "Forza" || e.stimulus === "Forza";
          if (histIsForza !== exIsForza) return false;
        }
        return true;
      });
      if (found) {
        const workingSets = found.sets.filter(s => !s.warmup);
        if (!workingSets.length) continue;
        let bestOrm = 0;
        let topWeight = 0;
        let minReps = Infinity;
        const rirs = [];
        workingSets.forEach(s => {
          const w = S.parseNum(s.weight);
          const r = Math.round(S.parseNum(s.reps));
          const orm = s.orm != null ? S.parseNum(s.orm) : S.calcEpley1RM(w, r);
          if (orm > bestOrm) bestOrm = orm;
          if (w > topWeight) topWeight = w;
          if (r > 0 && r < minReps) minReps = r;
          const rn = parseRirNumeric(s.rir);
          if (rn !== null) rirs.push(rn);
        });
        entries.push({
          bestOrm,
          topWeight,
          minReps: minReps === Infinity ? 0 : minReps,
          avgRir: rirs.length ? rirs.reduce((a, b) => a + b, 0) / rirs.length : null
        });
        if (entries.length >= 3) break;
      }
    }

    if (entries.length < 2 || entries[0].topWeight <= 0) return null;
    const range = parseRepsRange(ex.repsTarget, ex.focus);
    const roundStep = getPreferredRoundingStep();
    const deloadWeight = Math.max(0, S.roundToGymStep(entries[0].topWeight * 0.85, roundStep));

    if (
      entries.length >= 3 &&
      entries[0].bestOrm > 0 &&
      entries[0].bestOrm < entries[1].bestOrm &&
      entries[1].bestOrm < entries[2].bestOrm &&
      ((entries[2].bestOrm - entries[0].bestOrm) / entries[2].bestOrm) >= 0.05
    ) {
      return {
        reason: "1RM in calo per 3 sedute consecutive: uno scarico (−15%) favorisce il recupero.",
        deloadWeight,
        targetReps: range.min
      };
    }

    if (
      entries[0].avgRir !== null &&
      entries[1].avgRir !== null &&
      entries[0].avgRir <= 0.5 &&
      entries[1].avgRir <= 0.5 &&
      entries[0].minReps < range.min &&
      entries[1].minReps < range.min
    ) {
      return {
        reason: "2 sedute consecutive a cedimento sotto il target: scarica (−15%) per recuperare.",
        deloadWeight,
        targetReps: range.min
      };
    }

    return null;
  }

  function formatOrmBadgeContent(orm, historicalPr) {
    if (orm <= 0) return "1RM: —";
    const prTag = historicalPr > 0 && orm > historicalPr
      ? ` <span class="pr-live-badge">🏆 PR!</span>`
      : "";
    return `1RM: ${formatDec(orm)} kg${prTag}`;
  }

  function isExerciseLocked(draft, exId) {
    return Boolean(draft && draft.locked && draft.locked[exId]);
  }

  function lockExercisesAndRecalculate(routine, draft, exIds, silentToast) {
    if (!draft.locked || typeof draft.locked !== "object") draft.locked = {};
    if (!draft.pendingDefaultWeight || typeof draft.pendingDefaultWeight !== "object") draft.pendingDefaultWeight = {};
    const messages = [];
    exIds.forEach(exId => {
      draft.locked[exId] = true;
      const ex = routine.exercises.find(e => e.id === exId);
      if (!ex) return;
      const arr = Array.isArray(draft.exercises[exId]) ? draft.exercises[exId] : [];
      const doneWorking = arr.filter(s => s.done && !s.warmup);
      if (doneWorking.length > 0) {
        const advice = computeProgressionAdvice(ex, { sets: doneWorking });
        if (advice && advice.suggestedWeight && advice.suggestedWeight > 0) {
          draft.pendingDefaultWeight[exId] = advice.suggestedWeight;
          messages.push(`${ex.name}: ${formatDec(advice.suggestedWeight)} kg × ${advice.suggestedReps || ""}`);
        }
      }
    });
    persist();
    renderTrainView();
    if (!silentToast) {
      if (messages.length) {
        showToast(`🔒 Bloccato · Prossima: ${messages.join(" · ")}`, "success", 3400);
      } else {
        showToast("🔒 Dati esercizio bloccati");
      }
    }
  }

  function unlockExercises(draft, exIds) {
    if (!draft.locked || typeof draft.locked !== "object") draft.locked = {};
    exIds.forEach(exId => {
      delete draft.locked[exId];
      if (draft.pendingDefaultWeight) delete draft.pendingDefaultWeight[exId];
    });
    persist();
    renderTrainView();
    showToast("🔓 Esercizio sbloccato: correggi i dati e riblocca quando pronto");
  }

  function openQuickNoteModal(ex) {
    if (!ex) return;
    openModal({
      title: `📝 Nota · ${ex.name}`,
      bodyHtml: `
        <div class="form-group">
          <label class="form-label" for="mQuickExNote">Nota fissa esercizio (es. altezza sedile, presa, focus tecnico)</label>
          <textarea id="mQuickExNote" class="textarea-field" placeholder="Es. Sedile posizione 4, fermo 1s in basso...">${esc(ex.note || "")}</textarea>
        </div>
        ${ex.catalogId ? `
          <label class="checkbox-inline" style="margin-bottom:0;">
            <input id="mQuickNoteCatalog" type="checkbox" checked />
            <span style="font-size:0.82rem;">Salva nota predefinita anche nel catalogo esercizi</span>
          </label>
        ` : ""}
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Salva Nota",
          className: "btn-primary",
          onClick: () => {
            const nextNote = document.getElementById("mQuickExNote").value.trim();
            ex.note = nextNote;
            const syncCat = document.getElementById("mQuickNoteCatalog");
            if (syncCat && syncCat.checked && ex.catalogId) {
              const cat = state.catalog.find(c => c.id === ex.catalogId);
              if (cat) cat.note = nextNote;
            }
            persist();
            renderTrainView();
            showToast(nextNote ? "Nota salvata!" : "Nota rimossa", "success");
          }
        }
      ]
    });
  }

  function openEditRestModal(routine, exList, displayName) {
    const primary = exList[0];
    if (!primary) return;
    const currentSec = Math.max(10, parseInt(primary.restSec, 10) || 90);
    const presets = [45, 60, 75, 90, 120, 150, 180, 240];

    openModal({
      title: "⏱️ Regola Recupero",
      bodyHtml: `
        <p style="margin-top:0; font-size:0.86rem; color:var(--text-muted);">
          Imposta il tempo di recupero per <strong>${esc(displayName || primary.name)}</strong>:
        </p>
        <div class="rest-presets-grid">
          ${presets.map(sec => `
            <button type="button" class="rest-preset-btn ${sec === currentSec ? "active" : ""} js-rest-preset" data-sec="${sec}">
              ${formatRestBadge(sec)}
            </button>
          `).join("")}
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="mQuickRestSec">Durata personalizzata (secondi)</label>
          ${renderWeightStepperHtml({
            inputId: "mQuickRestSec",
            inputClass: "",
            value: currentSec,
            placeholder: "90",
            stepDelta: 15,
            isInt: true,
            ariaLabel: "Secondi di recupero"
          })}
        </div>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Salva",
          className: "btn-secondary",
          onClick: () => {
            const sec = Math.max(10, Math.round(S.parseNum(document.getElementById("mQuickRestSec").value)) || 90);
            exList.forEach(ex => { ex.restSec = sec; });
            persist();
            renderTrainView();
            showToast(`Recupero impostato a ${formatRestBadge(sec)}`, "success");
          }
        },
        {
          label: "Salva e Avvia",
          className: "btn-primary",
          onClick: () => {
            const sec = Math.max(10, Math.round(S.parseNum(document.getElementById("mQuickRestSec").value)) || 90);
            exList.forEach(ex => { ex.restSec = sec; });
            persist();
            renderTrainView();
            T.startRestTimer(sec, displayName || primary.name);
            showToast(`Recupero ${formatRestBadge(sec)} avviato`, "success");
          }
        }
      ]
    });

    const secIn = document.getElementById("mQuickRestSec");
    const syncPresetActive = () => {
      const val = Math.round(S.parseNum(secIn.value));
      document.querySelectorAll(".js-rest-preset").forEach(btn => {
        btn.classList.toggle("active", parseInt(btn.dataset.sec, 10) === val);
      });
    };
    document.querySelectorAll(".js-rest-preset").forEach(btn => {
      btn.addEventListener("click", () => {
        secIn.value = btn.dataset.sec;
        syncPresetActive();
      });
    });
    document.getElementById("modalBody").querySelectorAll(".js-w-step").forEach(btn => {
      btn.addEventListener("click", () => {
        const delta = parseInt(btn.dataset.delta, 10) || 15;
        const next = Math.max(10, Math.round(S.parseNum(secIn.value) + delta));
        secIn.value = String(next);
        syncPresetActive();
      });
    });
    secIn.addEventListener("input", syncPresetActive);
  }

  function openFixLastExerciseModal(routine, draft, ex) {
    const lastInfo = getLastExerciseSummary(ex);
    if (!lastInfo || !lastInfo.sessionId) {
      showToast("Nessuna seduta precedente trovata per questo esercizio", "danger");
      return;
    }
    const sess = state.history.find(s => s.id === lastInfo.sessionId);
    if (!sess) return;
    const histEx = (sess.exercises || []).find(e => matchesExercise(e, ex) && e.sets && e.sets.length > 0);
    if (!histEx) return;

    openModal({
      title: `✏️ Correggi Ultima · ${ex.name}`,
      bodyHtml: `
        <p style="margin-top:0; font-size:0.84rem; color:var(--text-muted);">
          Seduta del <strong>${formatDateIT(sess.dateISO)}</strong> (${esc(sess.routineName)}). Correggi eventuali errori: il consiglio e i pesi verranno rielaborati subito.
        </p>
        <div class="edit-sess-ex-box">
          <div style="display:grid; grid-template-columns:24px 1fr 1fr 64px; gap:6px; font-size:0.7rem; color:var(--text-dim); font-weight:800; text-align:center;">
            <div>#</div><div>Kg</div><div>Reps</div><div>RIR</div>
          </div>
          ${histEx.sets.map((s, sIdx) => `
            <div class="edit-sess-set-row">
              <span style="font-size:0.78rem; color:var(--text-muted); font-weight:800;">${s.warmup ? "W" : "#" + (sIdx + 1)}</span>
              <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
                class="set-input js-fl-w" data-set="${sIdx}" value="${esc(weightInputValue(s.weight))}" aria-label="Kg serie ${sIdx + 1}" />
              <input type="number" step="1" min="0" inputmode="numeric"
                class="set-input js-fl-r" data-set="${sIdx}" value="${esc(s.reps)}" aria-label="Reps serie ${sIdx + 1}" />
              <select class="set-select js-fl-rir" data-set="${sIdx}" aria-label="RIR serie ${sIdx + 1}">
                ${S.RIR_OPTIONS.map(opt => `<option value="${esc(opt)}" ${(s.rir || "-") === opt ? "selected" : ""}>${esc(opt)}</option>`).join("")}
              </select>
            </div>
          `).join("")}
        </div>
        <label class="checkbox-inline" style="margin-bottom:0;">
          <input id="mFixApplyToday" type="checkbox" checked />
          <span style="font-size:0.82rem;">Aggiorna anche le serie non ancora spuntate di oggi col nuovo carico rielaborato</span>
        </label>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Salva e Rielabora",
          className: "btn-success",
          onClick: () => {
            document.querySelectorAll(".js-fl-w").forEach(inp => {
              const i = parseInt(inp.dataset.set, 10);
              histEx.sets[i].weight = S.parseNum(inp.value);
            });
            document.querySelectorAll(".js-fl-r").forEach(inp => {
              const i = parseInt(inp.dataset.set, 10);
              histEx.sets[i].reps = Math.max(0, Math.round(S.parseNum(inp.value)));
            });
            document.querySelectorAll(".js-fl-rir").forEach(sel => {
              const i = parseInt(sel.dataset.set, 10);
              histEx.sets[i].rir = S.RIR_OPTIONS.includes(sel.value) ? sel.value : "-";
            });

            let totalVolume = 0;
            let best1RM = 0;
            let totalSets = 0;
            (sess.exercises || []).forEach(he => {
              (he.sets || []).forEach(stSet => {
                const orm = stSet.warmup ? 0 : S.calcEpley1RM(stSet.weight, stSet.reps);
                stSet.orm = orm;
                if (!stSet.warmup) {
                  totalVolume += stSet.weight * stSet.reps;
                  if (orm > best1RM) best1RM = orm;
                  totalSets++;
                }
              });
            });
            sess.totalVolume = Math.round(totalVolume);
            sess.best1RM = best1RM;
            sess.totalSets = totalSets;

            const refreshed = getLastExerciseSummary(ex);
            const newAdvice = computeProgressionAdvice(ex, refreshed);
            const applyToday = document.getElementById("mFixApplyToday") && document.getElementById("mFixApplyToday").checked;
            if (newAdvice && newAdvice.suggestedWeight && newAdvice.suggestedWeight > 0) {
              ex.defaultWeight = newAdvice.suggestedWeight;
              if (applyToday && draft && Array.isArray(draft.exercises[ex.id]) && !isExerciseLocked(draft, ex.id)) {
                draft.exercises[ex.id].forEach(s => {
                  if (!s.done && !s.warmup) {
                    s.weight = weightInputValue(newAdvice.suggestedWeight);
                    if (newAdvice.suggestedReps) s.reps = String(newAdvice.suggestedReps);
                  }
                });
              }
            }

            persist();
            renderTrainView();
            showToast(newAdvice ? `Rielaborato: ${newAdvice.title}` : "Ultima seduta aggiornata!", "success", 3200);
          }
        }
      ]
    });
  }

  function renderLastSummaryHtml(ex, isLocked) {
    const lastInfo = getLastExerciseSummary(ex);
    if (lastInfo && lastInfo.bestSet) {
      const b = lastInfo.bestSet;
      const rirTag = b.rir && b.rir !== "-" ? `<span class="ex-last-pill">RIR ${esc(b.rir)}</span>` : "";
      const ormTag = b.orm > 0 ? `<span class="ex-last-pill" style="color:#fbbf24;">1RM ${formatDec(b.orm)} kg</span>` : "";
      const advice = computeProgressionAdvice(ex, lastInfo);
      const deload = detectDeloadNeed(ex);
      let adviceHtml = "";
      if (advice) {
        const showApply = (advice.action === "increase" || advice.action === "decrease") && advice.suggestedWeight !== null;
        adviceHtml = `
          <div class="ex-advice-box advice-${esc(advice.action)}">
            <div class="ex-advice-main">
              <div class="ex-advice-head">
                <span class="ex-advice-cat">${esc(advice.categoryLabel)}</span>
                <span>${esc(advice.title)}</span>
              </div>
              <div class="ex-advice-reason">${esc(advice.reason)}</div>
            </div>
            ${showApply ? `
              <button type="button" class="btn-apply-advice js-apply-advice"
                data-ex-id="${esc(ex.id)}"
                data-weight="${esc(advice.suggestedWeight)}"
                data-reps="${esc(advice.suggestedReps || "")}"
                ${isLocked ? "disabled" : ""}>
                Applica
              </button>
            ` : ""}
          </div>
        `;
      }
      let deloadHtml = "";
      if (deload) {
        deloadHtml = `
          <div class="ex-deload-box">
            <div class="ex-advice-main">
              <div class="ex-advice-head">🔋 Consiglio Scarico (Deload) → ${formatDec(deload.deloadWeight)} kg</div>
              <div class="ex-advice-reason">${esc(deload.reason)}</div>
            </div>
            <button type="button" class="btn-apply-advice js-apply-advice"
              data-ex-id="${esc(ex.id)}"
              data-weight="${esc(deload.deloadWeight)}"
              data-reps="${esc(deload.targetReps)}"
              ${isLocked ? "disabled" : ""}>
              Scarica
            </button>
          </div>
        `;
      }
      return `
        <div class="ex-last-row">
          <strong>Ultimo (${formatShortDateIT(lastInfo.dateISO)}):</strong>
          <span class="ex-last-pill">${formatDec(b.weight)} kg × ${b.reps}</span>
          ${rirTag}
          ${ormTag}
          <button type="button" class="btn-fix-last js-fix-last-ex" data-ex-id="${esc(ex.id)}" title="Correggi peso o ripetizioni della seduta precedente">✏️ Correggi</button>
        </div>
        ${adviceHtml}
        ${deloadHtml}
      `;
    }
    const defTxt = ex.defaultWeight > 0 ? `${formatDec(ex.defaultWeight)} kg` : "Da calibrare";
    return `
      <div class="ex-last-row">
        <strong>Ultimo:</strong> <span>Prima seduta (base: ${defTxt})</span>
      </div>
    `;
  }

  function renderLiveExerciseAdviceHtml(ex, draftSets, prefixLabel, isLocked, lockTargets) {
    const arr = Array.isArray(draftSets) ? draftSets : [];
    const workingTotal = arr.filter(s => !s.warmup).length;
    const doneSets = arr.filter(s => s.done && !s.warmup);
    if (!doneSets.length) return "";
    const advice = computeProgressionAdvice(ex, { sets: doneSets });
    if (!advice) return "";
    const allDone = workingTotal > 0 && doneSets.length >= workingTotal;
    const prefix = prefixLabel ? `${esc(prefixLabel)} · ` : "";
    const tagText = allDone
      ? `✓ ${prefix}Esercizio completato · Prossima seduta`
      : `${prefix}Stima parziale (${doneSets.length}/${workingTotal} serie)`;
    const targetsAttr = lockTargets ? esc(lockTargets) : esc(ex.id);
    const lockPromptHtml = (allDone && !isLocked) ? `
      <div class="ex-lock-prompt">
        <span>Hai finito le serie: vuoi bloccare i dati?</span>
        <button type="button" class="btn-apply-advice js-lock-and-sync" data-lock-ids="${targetsAttr}">🔒 Blocca dati</button>
      </div>
    ` : "";
    return `
      <div class="ex-live-advice advice-${esc(advice.action)}${allDone ? " completed" : ""}">
        <div class="ex-live-advice-tag">${tagText}</div>
        <div style="font-weight:800;">${esc(advice.title)}</div>
        <div class="ex-advice-reason">${esc(advice.reason)}</div>
        ${lockPromptHtml}
      </div>
    `;
  }

  function renderExerciseDeltaBadge(ex, draftSets) {
    const lastInfo = getLastExerciseSummary(ex);
    if (!lastInfo || !lastInfo.bestSet || lastInfo.bestSet.weight <= 0) return "";
    const working = (draftSets || []).filter(s => !s.warmup && S.parseNum(s.weight) > 0);
    if (!working.length) return "";
    const currTopW = Math.max(...working.map(s => S.parseNum(s.weight)));
    const diff = Math.round((currTopW - lastInfo.bestSet.weight) * 100) / 100;
    if (Math.abs(diff) < 0.05) {
      return `<span class="badge badge-delta-eq">= ultimo</span>`;
    }
    if (diff > 0) {
      return `<span class="badge badge-delta-up">+${formatDec(diff)} kg vs ultimo</span>`;
    }
    return `<span class="badge badge-delta-down">−${formatDec(Math.abs(diff))} kg vs ultimo</span>`;
  }

  function openPlateCalculatorModal(initialWeight) {
    const startW = S.parseNum(initialWeight) > 0 ? S.parseNum(initialWeight) : 60;
    const availPlates = [25, 20, 15, 10, 5, 2.5, 1.25];

    function computePlatesHtml(totalKg, barKg) {
      const total = S.parseNum(totalKg);
      const bar = S.parseNum(barKg);
      if (total <= 0) return `<div class="empty-state" style="padding:12px;">Inserisci un peso valido.</div>`;
      if (total < bar) return `<div style="color:#fde68a; font-size:0.84rem;">Il carico (${formatDec(total)} kg) è inferiore al bilanciere (${formatDec(bar)} kg).</div>`;
      let perSide = (total - bar) / 2;
      if (perSide === 0) return `<div style="color:var(--text-muted); font-size:0.85rem;">Solo bilanciere vuoto (${formatDec(bar)} kg), nessun disco da aggiungere.</div>`;
      const picked = [];
      for (const p of availPlates) {
        while (perSide >= p - 0.001) {
          picked.push(p);
          perSide = Math.round((perSide - p) * 1000) / 1000;
        }
      }
      const loadedPerSide = picked.reduce((a, b) => a + b, 0);
      const actualTotal = bar + loadedPerSide * 2;
      return `
        <div style="font-size:0.84rem; color:var(--text-muted); margin-bottom:6px;">
          Per lato: <strong style="color:var(--text);">${formatDec(loadedPerSide)} kg</strong>
          ${bar > 0 ? ` · Totale reale: <strong style="color:var(--accent);">${formatDec(actualTotal)} kg</strong>` : ""}
        </div>
        <div class="plate-chips-row">
          ${picked.length ? picked.map(p => `<span class="plate-chip">${formatDec(p)} kg</span>`).join("") : `<span style="font-size:0.82rem; color:var(--text-muted);">Nessun disco standard</span>`}
        </div>
        ${perSide > 0.01 ? `<div style="font-size:0.76rem; color:#fde68a; margin-top:8px;">Residuo non scomponibile: ${formatDec(perSide)} kg per lato.</div>` : ""}
      `;
    }

    openModal({
      title: "🏋️ Calcolatore Dischi per Lato",
      bodyHtml: `
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="mPlateTotal">Carico totale (kg)</label>
            <input id="mPlateTotal" class="input-field" type="text" inputmode="decimal" value="${esc(weightInputValue(startW))}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="mPlateBar">Bilanciere / Tara</label>
            <select id="mPlateBar" class="select-field">
              <option value="20" selected>20 kg (Olimpico)</option>
              <option value="15">15 kg (Donna/Tecnico)</option>
              <option value="10">10 kg (EZ / Corto)</option>
              <option value="0">0 kg (Macchina / Manubri)</option>
            </select>
          </div>
        </div>
        <div id="mPlateResult" class="goal-desc-box" style="margin-bottom:0;"></div>
      `,
      buttons: [{ label: "Chiudi", className: "btn-primary" }]
    });

    const totIn = document.getElementById("mPlateTotal");
    const barSel = document.getElementById("mPlateBar");
    const resEl = document.getElementById("mPlateResult");
    const refresh = () => {
      if (resEl) resEl.innerHTML = computePlatesHtml(totIn.value, barSel.value);
    };
    totIn.addEventListener("input", refresh);
    barSel.addEventListener("change", refresh);
    refresh();
  }

  function updateLiveExerciseAdviceDOM(routine, draft, exId) {
    const listEl = document.getElementById("trainExercisesList");
    if (!listEl || !routine || !draft) return;
    const ex = routine.exercises.find(e => e.id === exId);
    if (!ex) return;
    const box = listEl.querySelector(`.js-live-ex-advice[data-ex-id="${exId}"]`);
    if (!box) return;
    const prefix = box.dataset.prefix || "";
    const lockTargets = box.dataset.lockTargets || ex.id;
    const isLocked = lockTargets.split(",").every(id => isExerciseLocked(draft, id));
    box.innerHTML = renderLiveExerciseAdviceHtml(ex, draft.exercises[exId] || [], prefix, isLocked, lockTargets);
  }

  function renderWeightStepperHtml(opts) {
    const stepDelta = opts.stepDelta || 1;
    const isInt = Boolean(opts.isInt);
    const idAttr = opts.inputId ? `id="${esc(opts.inputId)}"` : "";
    const wrapClass = opts.compact ? "weight-stepper reps-stepper" : "weight-stepper";
    const typeAttrs = isInt
      ? 'type="number" step="1" min="0" inputmode="numeric"'
      : 'type="text" inputmode="decimal" autocomplete="off" spellcheck="false"';
    const subTag = opts.hideStepLabel ? "" : `<small>${stepDelta}</small>`;
    const unit = isInt ? "rip." : "kg";
    const disabledAttr = opts.disabled ? "disabled" : "";
    return `
      <div class="${wrapClass}" data-step="${stepDelta}" data-int="${isInt ? "1" : "0"}">
        <button type="button" class="weight-step-btn minus js-w-step" data-delta="-${stepDelta}" aria-label="Diminuisci di ${stepDelta} ${unit}" ${disabledAttr}>
          <span>−</span>${subTag}
        </button>
        <input ${idAttr} ${typeAttrs} ${disabledAttr}
          class="set-input weight-input ${esc(opts.inputClass || "")}"
          value="${esc(weightInputValue(opts.value))}"
          placeholder="${esc(weightInputValue(opts.placeholder))}"
          aria-label="${esc(opts.ariaLabel || "Valore")}" />
        <button type="button" class="weight-step-btn plus js-w-step" data-delta="${stepDelta}" aria-label="Aumenta di ${stepDelta} ${unit}" ${disabledAttr}>
          <span>+</span>${subTag}
        </button>
      </div>
    `;
  }

  function renderSingleSetItemHtml(ex, s, sIdx, extraLabel, isLocked) {
    const isWarmup = Boolean(s.warmup);
    const orm = isWarmup ? 0 : S.calcEpley1RM(s.weight, s.reps);
    const historicalPr = getBestHistorical1RM(ex);
    const setVol = Math.round(S.parseNum(s.weight) * Math.round(S.parseNum(s.reps)));
    const stepDelta = S.getExerciseWeightStep(ex);
    const disAttr = isLocked ? "disabled" : "";
    return `
      <div class="set-item ${s.done ? "done" : ""} ${isWarmup ? "is-warmup" : ""}" data-mode="single" data-ex-id="${esc(ex.id)}" data-set-idx="${sIdx}" data-rest="${ex.restSec || 90}" data-ex-name="${esc(ex.name)}">
        ${extraLabel ? `<div class="ss-extra-tag">${esc(extraLabel)}</div>` : ""}
        <div class="set-main-grid">
          <button type="button" class="set-num-btn ${isWarmup ? "warmup" : ""} js-wup-btn" ${disAttr} title="Tocca per alternare Serie allenante / Riscaldamento (W)" aria-label="Tipo serie ${sIdx + 1}: ${isWarmup ? "Riscaldamento" : "Allenante"}">
            ${isWarmup ? "W" : sIdx + 1}
          </button>
          ${renderWeightStepperHtml({
            inputClass: "js-w-in",
            value: s.weight,
            placeholder: ex.defaultWeight > 0 ? ex.defaultWeight : "kg",
            stepDelta,
            disabled: isLocked,
            ariaLabel: `Kg serie ${sIdx + 1}`
          })}
          ${renderWeightStepperHtml({
            inputClass: "js-r-in",
            value: s.reps,
            placeholder: S.extractTargetRepsDefault(ex.repsTarget),
            stepDelta: 1,
            isInt: true,
            compact: true,
            hideStepLabel: true,
            disabled: isLocked,
            ariaLabel: `Reps serie ${sIdx + 1}`
          })}
          <select class="set-select js-rir-in" ${disAttr} aria-label="RIR serie ${sIdx + 1}">
            ${S.RIR_OPTIONS.map(opt => `<option value="${esc(opt)}" ${s.rir === opt ? "selected" : ""}>${esc(opt)}</option>`).join("")}
          </select>
          <button type="button" class="set-check-btn ${s.done ? "checked" : ""} js-chk-btn" ${disAttr} aria-label="Segna serie ${sIdx + 1} completata">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
        </div>
        <div class="set-sub-row">
          <span class="orm-live-badge js-orm-badge">${formatOrmBadgeContent(orm, historicalPr)}</span>
          <span class="set-vol-mini js-vol-mini">${setVol > 0 ? "Vol: " + formatInt(setVol) + " kg" : ""}</span>
        </div>
      </div>
    `;
  }

  function renderTrainView() {
    const pillsEl = document.getElementById("trainRoutinePills");
    const dashEl = document.getElementById("workoutDashboardContainer");
    const listEl = document.getElementById("trainExercisesList");
    const finishCard = document.getElementById("workoutFinishCard");

    if (!state.routines.length) {
      pillsEl.innerHTML = "";
      dashEl.innerHTML = `<div class="card empty-state">Nessuna scheda presente. Vai nella scheda <strong>Gestisci</strong> per crearne una.</div>`;
      listEl.innerHTML = "";
      finishCard.style.display = "none";
      return;
    }

    finishCard.style.display = "block";
    ensureValidRoutineIds();

    pillsEl.innerHTML = state.routines.map(r => `
      <button class="routine-pill ${r.id === state.activeRoutineId ? "active" : ""}" data-rid="${esc(r.id)}" type="button">
        ${esc(r.name)}
      </button>
    `).join("");

    pillsEl.querySelectorAll(".routine-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        state.activeRoutineId = btn.dataset.rid;
        persist();
        renderTrainView();
      });
    });

    const routine = state.routines.find(r => r.id === state.activeRoutineId) || state.routines[0];
    const draft = getOrCreateDraft(routine);
    const m = computeLiveSessionMetrics(routine, draft);

    dashEl.innerHTML = `
      <div class="workout-dashboard">
        <div class="routine-meta-title">${esc(routine.name)}</div>
        <div class="routine-meta-sub">${esc(routine.subtitle || "Scheda personalizzata")}</div>

        <div class="session-timer-bar">
          <div class="session-timer-left">
            <span id="sessionClockDot" class="session-dot"></span>
            <div>
              <div class="session-timer-label">Durata seduta</div>
              <div id="sessionClockDisplay" class="session-timer-value">${formatDuration(T.getSessionElapsedSec())}</div>
            </div>
          </div>
          <div class="session-timer-actions">
            <button type="button" id="btnSessionTimerToggle" class="rest-btn">Avvia</button>
            <button type="button" id="btnSessionTimerReset" class="rest-btn">Reset</button>
          </div>
        </div>

        <div class="live-metrics-grid">
          <div class="live-metric-box">
            <div id="dashSetsVal" class="live-metric-val green">${m.doneSets}/${m.totalSets}</div>
            <div class="live-metric-label">Serie fatte</div>
          </div>
          <div class="live-metric-box">
            <div id="dashVolVal" class="live-metric-val">${formatInt(m.totalVolume)} kg</div>
            <div class="live-metric-label">Volume seduta</div>
          </div>
          <div class="live-metric-box">
            <div id="dashOrmVal" class="live-metric-val amber">${m.best1RM > 0 ? formatDec(m.best1RM) + " kg" : "—"}</div>
            <div class="live-metric-label">Miglior 1RM</div>
          </div>
        </div>

        <div class="progress-track">
          <div id="dashProgressFill" class="progress-fill" style="width:${m.pct}%;"></div>
        </div>
      </div>
    `;

    document.getElementById("btnSessionTimerToggle").addEventListener("click", () => {
      T.unlockAudio();
      if (!state.activeSession.startedAtMs) {
        T.startSessionIfIdle(routine.id);
      } else {
        T.toggleSessionPause();
      }
      updateTimersUI();
    });

    document.getElementById("btnSessionTimerReset").addEventListener("click", () => {
      T.resetSessionTimer();
      updateTimersUI();
    });

    const notesInput = document.getElementById("sessionNotesInput");
    notesInput.value = draft.note || "";
    notesInput.oninput = () => {
      draft.note = notesInput.value;
      T.setActiveRoutineContext(routine.id);
      persist();
    };

    if (!routine.exercises.length) {
      listEl.innerHTML = `<div class="card empty-state">Nessun esercizio in questa scheda. Aggiungili da <strong>Gestisci</strong>.</div>`;
      updateTimersUI();
      return;
    }

    const grouped = groupRoutineExercises(routine.exercises);

    listEl.innerHTML = grouped.map(grp => {
      if (grp.type === "single") {
        const ex = grp.item;
        const setsData = draft.exercises[ex.id] || [];
        const isLocked = isExerciseLocked(draft, ex.id);
        const setsHtml = setsData.map((s, sIdx) => renderSingleSetItemHtml(ex, s, sIdx, "", isLocked)).join("");
        const exStep = S.getExerciseWeightStep(ex);
        const allCardDone = setsData.length > 0 && setsData.every(s => s.done);
        const isCollapsed = collapsedExerciseIds.has(ex.id);
        const firstWorking = setsData.find(s => !s.warmup && S.parseNum(s.weight) > 0);
        const plateInitW = firstWorking ? S.parseNum(firstWorking.weight) : (ex.defaultWeight || 60);

        return `
          <article class="card ${allCardDone ? "card-completed" : ""} ${isLocked ? "card-locked" : ""}" data-card-ex-id="${esc(ex.id)}">
            <div class="ex-header">
              <div>
                <h3 class="ex-title">${grp.index + 1}. ${esc(ex.name)}</h3>
                <div class="ex-badges">
                  ${isLocked ? `<span class="badge badge-locked">🔒 Bloccato</span>` : ""}
                  ${allCardDone ? `<span class="badge badge-done-card">✓ Completato</span>` : ""}
                  <span class="badge ${getFocusBadgeClass(ex.focus)}">${esc(ex.focus || "Ipertrofia")}</span>
                  <span class="badge badge-muscle">${esc(ex.muscleGroup || "Altro")}</span>
                  <span class="badge badge-step">±${exStep} kg</span>
                  ${renderExerciseDeltaBadge(ex, setsData)}
                </div>
              </div>
              <div class="ex-header-actions">
                ${allCardDone ? `<button type="button" class="btn-collapse-toggle js-toggle-collapse" data-ex-id="${esc(ex.id)}">${isCollapsed ? "Espandi" : "Comprimi"}</button>` : ""}
                <button type="button" class="btn-icon ${isLocked ? "locked" : ""} js-toggle-lock" data-lock-ids="${esc(ex.id)}" data-locked="${isLocked ? "1" : "0"}" title="${isLocked ? "Sblocca esercizio per correggere" : "Blocca dati esercizio"}" aria-label="${isLocked ? "Sblocca" : "Blocca"}">${isLocked ? "🔒" : "🔓"}</button>
                <button type="button" class="btn-icon js-plate-calc" data-weight="${esc(plateInitW)}" title="Calcolatore dischi bilanciere" aria-label="Calcolatore dischi">🏋️</button>
                <button type="button" class="btn-icon js-manual-rest" data-ex-ids="${esc(ex.id)}" data-rest="${ex.restSec || 90}" data-name="${esc(ex.name)}" title="Tap: avvia timer · Tieni premuto: regola recupero">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><line x1="10" y1="2" x2="14" y2="2"/></svg>
                </button>
              </div>
            </div>

            ${isLocked ? `
              <div class="ex-lock-banner">
                <span>🔒 Dati protetti · Il timer recupero resta attivo</span>
                <button type="button" class="btn-rest-pill js-manual-rest" data-ex-ids="${esc(ex.id)}" data-rest="60" data-name="${esc(ex.name)}">+1m rec.</button>
              </div>
            ` : ""}

            <div class="${isCollapsed ? "card-collapsed-body" : ""}">
              <div class="ex-target-meta">
                <span>🎯 Target: <strong>${setsData.length} × ${esc(ex.repsTarget)}</strong></span>
                <button type="button" class="btn-rest-pill js-edit-rest" data-ex-ids="${esc(ex.id)}" data-name="${esc(ex.name)}" title="Tocca per cambiare la durata del recupero">
                  ⏱️ Rec: <strong>${formatRestBadge(ex.restSec)}</strong> ✎
                </button>
                ${!ex.note ? `<button type="button" class="btn-rest-pill js-edit-note" data-ex-id="${esc(ex.id)}">+ Nota</button>` : ""}
              </div>

              ${ex.note ? `<div class="ex-note-box editable js-edit-note" data-ex-id="${esc(ex.id)}" title="Tocca per modificare la nota"><span>💡 ${esc(ex.note)}</span><span style="opacity:0.75;">✎</span></div>` : ""}
              ${renderLastSummaryHtml(ex, isLocked)}

              <div class="${isLocked ? "locked-inputs-area" : ""}">
                <div class="sets-col-header">
                  <div title="Tocca il numero per segnare W (riscaldamento)">#</div>
                  <div>Kg</div>
                  <div>Reps</div>
                  <div>RIR</div>
                  <div>OK</div>
                </div>

                <div class="sets-list">${setsHtml}</div>
              </div>

              <div class="js-live-ex-advice" data-ex-id="${esc(ex.id)}" data-lock-targets="${esc(ex.id)}" data-prefix="">${renderLiveExerciseAdviceHtml(ex, setsData, "", isLocked, ex.id)}</div>

              <div class="ex-footer-actions">
                <div class="set-adjust-group">
                  <button type="button" class="btn btn-secondary btn-sm js-add-set" data-ex-id="${esc(ex.id)}" ${isLocked ? "disabled" : ""}>+ Serie</button>
                  <button type="button" class="btn btn-secondary btn-sm js-rem-set" data-ex-id="${esc(ex.id)}" ${(setsData.length <= 1 || isLocked) ? "disabled" : ""}>- Serie</button>
                  ${setsData.length > 1 ? `<button type="button" class="btn btn-secondary btn-sm js-copy-w1" data-ex-id="${esc(ex.id)}" ${isLocked ? "disabled" : ""} title="Copia il peso della 1ª serie allenante sulle serie successive">= Peso</button>` : ""}
                </div>
                <button type="button" class="btn-rest-pill js-manual-rest" data-ex-ids="${esc(ex.id)}" data-rest="${ex.restSec || 90}" data-name="${esc(ex.name)}" title="Tap: avvia recupero · Tieni premuto: modifica">⏱️ ${ex.restSec || 90}s</button>
              </div>
            </div>
          </article>
        `;
      }

      // CARD SUPERSERIE ACCORPATA (2 esercizi in 1 card visiva + timer condiviso in fondo)
      const [ex1, ex2] = grp.items;
      const [idx1, idx2] = grp.indices;
      const setsA = draft.exercises[ex1.id] || [];
      const setsB = draft.exercises[ex2.id] || [];
      const pairCount = Math.min(setsA.length, setsB.length);
      const sharedRestSec = ex2.restSec || ex1.restSec || 90;
      const sharedLabel = `${ex1.name} + ${ex2.name}`;
      const stepA = S.getExerciseWeightStep(ex1);
      const stepB = S.getExerciseWeightStep(ex2);
      const prA = getBestHistorical1RM(ex1);
      const prB = getBestHistorical1RM(ex2);
      const isSsLocked = isExerciseLocked(draft, ex1.id) && isExerciseLocked(draft, ex2.id);
      const ssLockIds = `${ex1.id},${ex2.id}`;
      const ssDisAttr = isSsLocked ? "disabled" : "";
      const allSsDone = setsA.length > 0 && setsB.length > 0 && setsA.every(s => s.done) && setsB.every(s => s.done);
      const isSsCollapsed = collapsedExerciseIds.has(grp.groupId);

      let roundsHtml = "";
      for (let rIdx = 0; rIdx < pairCount; rIdx++) {
        const sA = setsA[rIdx];
        const sB = setsB[rIdx];
        const bothDone = Boolean(sA.done && sB.done);
        const ormA = S.calcEpley1RM(sA.weight, sA.reps);
        const ormB = S.calcEpley1RM(sB.weight, sB.reps);

        roundsHtml += `
          <div class="ss-round-block ${bothDone ? "done" : ""}" data-ex-a="${esc(ex1.id)}" data-ex-b="${esc(ex2.id)}" data-round-idx="${rIdx}" data-rest="${sharedRestSec}" data-ss-label="${esc(sharedLabel)}">
            <div class="ss-round-head">
              <span class="badge badge-ss">Giro ${rIdx + 1}</span>
              <span style="font-size:0.72rem; color:var(--text-muted);">Compila A e B · 1 spunta finale</span>
            </div>

            <!-- Esercizio A (nessun timer, nessuna spunta singola) -->
            <div class="ss-sub-ex">
              <div class="ss-sub-title">
                <span><strong>A.</strong> ${esc(ex1.name)}</span>
                <span class="orm-live-badge js-ss-orm-a">${formatOrmBadgeContent(ormA, prA)}</span>
              </div>
              <div class="ss-grid-nochk">
                ${renderWeightStepperHtml({
                  inputClass: "js-ss-wa",
                  value: sA.weight,
                  placeholder: ex1.defaultWeight > 0 ? ex1.defaultWeight : "kg",
                  stepDelta: stepA,
                  disabled: isSsLocked,
                  ariaLabel: `Kg ${ex1.name} giro ${rIdx + 1}`
                })}
                ${renderWeightStepperHtml({
                  inputClass: "js-ss-ra",
                  value: sA.reps,
                  placeholder: S.extractTargetRepsDefault(ex1.repsTarget),
                  stepDelta: 1,
                  isInt: true,
                  compact: true,
                  hideStepLabel: true,
                  disabled: isSsLocked,
                  ariaLabel: `Reps ${ex1.name} giro ${rIdx + 1}`
                })}
                <select class="set-select js-ss-rira" ${ssDisAttr} aria-label="RIR ${esc(ex1.name)} giro ${rIdx + 1}">
                  ${S.RIR_OPTIONS.map(opt => `<option value="${esc(opt)}" ${sA.rir === opt ? "selected" : ""}>${esc(opt)}</option>`).join("")}
                </select>
              </div>
            </div>

            <!-- Esercizio B + UNICA SPUNTA DI CONFERMA DEL GIRO -->
            <div class="ss-sub-ex">
              <div class="ss-sub-title">
                <span><strong>B.</strong> ${esc(ex2.name)}</span>
                <span class="orm-live-badge js-ss-orm-b">${formatOrmBadgeContent(ormB, prB)}</span>
              </div>
              <div class="ss-grid-chk">
                ${renderWeightStepperHtml({
                  inputClass: "js-ss-wb",
                  value: sB.weight,
                  placeholder: ex2.defaultWeight > 0 ? ex2.defaultWeight : "kg",
                  stepDelta: stepB,
                  disabled: isSsLocked,
                  ariaLabel: `Kg ${ex2.name} giro ${rIdx + 1}`
                })}
                ${renderWeightStepperHtml({
                  inputClass: "js-ss-rb",
                  value: sB.reps,
                  placeholder: S.extractTargetRepsDefault(ex2.repsTarget),
                  stepDelta: 1,
                  isInt: true,
                  compact: true,
                  hideStepLabel: true,
                  disabled: isSsLocked,
                  ariaLabel: `Reps ${ex2.name} giro ${rIdx + 1}`
                })}
                <select class="set-select js-ss-rirb" ${ssDisAttr} aria-label="RIR ${esc(ex2.name)} giro ${rIdx + 1}">
                  ${S.RIR_OPTIONS.map(opt => `<option value="${esc(opt)}" ${sB.rir === opt ? "selected" : ""}>${esc(opt)}</option>`).join("")}
                </select>
                <button type="button" class="set-check-btn ${bothDone ? "checked" : ""} js-ss-chk-btn" ${ssDisAttr} aria-label="Completa giro ${rIdx + 1} superserie">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }

      // Edge case: serie in eccesso quando A e B hanno numero di serie diverso
      let extraHtml = "";
      if (setsA.length > pairCount) {
        for (let i = pairCount; i < setsA.length; i++) {
          extraHtml += renderSingleSetItemHtml(ex1, setsA[i], i, `Serie extra · ${ex1.name}`, isSsLocked);
        }
      } else if (setsB.length > pairCount) {
        for (let i = pairCount; i < setsB.length; i++) {
          extraHtml += renderSingleSetItemHtml(ex2, setsB[i], i, `Serie extra · ${ex2.name}`, isSsLocked);
        }
      }

      return `
        <article class="card card-superset ${allSsDone ? "card-completed" : ""} ${isSsLocked ? "card-locked" : ""}">
          <div class="ex-header">
            <div>
              <div class="ex-badges" style="margin-bottom:6px;">
                ${isSsLocked ? `<span class="badge badge-locked">🔒 Bloccato</span>` : ""}
                ${allSsDone ? `<span class="badge badge-done-card">✓ Completato</span>` : ""}
                <span class="badge badge-ss">🔗 SUPERSERIE · ${idx1 + 1} + ${idx2 + 1}</span>
                <span class="badge badge-muscle">${esc(ex1.muscleGroup)} + ${esc(ex2.muscleGroup)}</span>
              </div>
              <h3 class="ex-title" style="margin-bottom:2px;">A. ${esc(ex1.name)}</h3>
              <h3 class="ex-title" style="color:#e9d5ff;">B. ${esc(ex2.name)}</h3>
            </div>
            <div class="ex-header-actions">
              ${allSsDone ? `<button type="button" class="btn-collapse-toggle js-toggle-collapse" data-ex-id="${esc(grp.groupId)}">${isSsCollapsed ? "Espandi" : "Comprimi"}</button>` : ""}
              <button type="button" class="btn-icon ${isSsLocked ? "locked" : ""} js-toggle-lock" data-lock-ids="${esc(ssLockIds)}" data-locked="${isSsLocked ? "1" : "0"}" title="${isSsLocked ? "Sblocca superserie per correggere" : "Blocca dati superserie"}" aria-label="${isSsLocked ? "Sblocca" : "Blocca"}">${isSsLocked ? "🔒" : "🔓"}</button>
              <button type="button" class="btn-icon js-manual-rest" data-ex-ids="${esc(ssLockIds)}" data-rest="${sharedRestSec}" data-name="${esc(sharedLabel)}" title="Tap: avvia timer · Tieni premuto: regola recupero">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><line x1="10" y1="2" x2="14" y2="2"/></svg>
              </button>
            </div>
          </div>

          ${isSsLocked ? `
            <div class="ex-lock-banner">
              <span>🔒 Superserie protetta · Il timer recupero resta attivo</span>
              <button type="button" class="btn-rest-pill js-manual-rest" data-ex-ids="${esc(ssLockIds)}" data-rest="60" data-name="${esc(sharedLabel)}">+1m rec.</button>
            </div>
          ` : ""}

          <div class="${isSsCollapsed ? "card-collapsed-body" : ""}">

          <div class="ss-meta-box">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; font-size:0.78rem;">
              <span><strong>A:</strong> ${setsA.length} × ${esc(ex1.repsTarget)}</span>
              <span style="display:inline-flex; gap:5px; align-items:center;">
                <span class="badge ${getFocusBadgeClass(ex1.focus)}">${esc(ex1.focus || "Ipertrofia")} · ±${stepA} kg</span>
                ${!ex1.note ? `<button type="button" class="btn-rest-pill js-edit-note" data-ex-id="${esc(ex1.id)}">+ Nota A</button>` : ""}
              </span>
            </div>
            ${ex1.note ? `<div class="ex-note-box editable js-edit-note" data-ex-id="${esc(ex1.id)}" style="margin-top:4px;"><span>💡 A: ${esc(ex1.note)}</span><span style="opacity:0.75;">✎</span></div>` : ""}
            ${renderLastSummaryHtml(ex1, isSsLocked)}

            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; font-size:0.78rem; margin-top:6px;">
              <span><strong>B:</strong> ${setsB.length} × ${esc(ex2.repsTarget)}</span>
              <span style="display:inline-flex; gap:5px; align-items:center;">
                <span class="badge ${getFocusBadgeClass(ex2.focus)}">${esc(ex2.focus || "Ipertrofia")} · ±${stepB} kg</span>
                ${!ex2.note ? `<button type="button" class="btn-rest-pill js-edit-note" data-ex-id="${esc(ex2.id)}">+ Nota B</button>` : ""}
              </span>
            </div>
            ${ex2.note ? `<div class="ex-note-box editable js-edit-note" data-ex-id="${esc(ex2.id)}" style="margin-top:4px;"><span>💡 B: ${esc(ex2.note)}</span><span style="opacity:0.75;">✎</span></div>` : ""}
            ${renderLastSummaryHtml(ex2, isSsLocked)}
          </div>

          <div class="sets-list ${isSsLocked ? "locked-inputs-area" : ""}">${roundsHtml}${extraHtml}</div>

          <div class="js-live-ex-advice" data-ex-id="${esc(ex1.id)}" data-lock-targets="${esc(ssLockIds)}" data-prefix="A. ${esc(ex1.name)}">${renderLiveExerciseAdviceHtml(ex1, setsA, `A. ${ex1.name}`, isSsLocked, ssLockIds)}</div>
          <div class="js-live-ex-advice" data-ex-id="${esc(ex2.id)}" data-lock-targets="${esc(ssLockIds)}" data-prefix="B. ${esc(ex2.name)}">${renderLiveExerciseAdviceHtml(ex2, setsB, `B. ${ex2.name}`, isSsLocked, ssLockIds)}</div>

          <!-- UNICO BLOCCO TIMER & SERIE CONDIVISO IN FONDO -->
          <div class="ss-shared-footer">
            <div class="ss-shared-timer-row">
              <button type="button" class="btn-rest-pill js-edit-rest" data-ex-ids="${esc(ssLockIds)}" data-name="${esc(sharedLabel)}" title="Tocca per regolare la durata del recupero">
                ⏱️ Recupero Superserie: ${formatRestBadge(sharedRestSec)} ✎
              </button>
              <button type="button" class="btn btn-secondary btn-sm js-manual-rest" data-ex-ids="${esc(ssLockIds)}" data-rest="${sharedRestSec}" data-name="${esc(sharedLabel)}">Avvia ${sharedRestSec}s</button>
            </div>
            <div class="ss-footer-btns">
              <button type="button" class="btn btn-secondary btn-sm js-add-ss-round" data-ex-a="${esc(ex1.id)}" data-ex-b="${esc(ex2.id)}" ${ssDisAttr}>+ Giro</button>
              <button type="button" class="btn btn-secondary btn-sm js-add-set" data-ex-id="${esc(ex1.id)}" ${ssDisAttr}>+1 A</button>
              <button type="button" class="btn btn-secondary btn-sm js-rem-set" data-ex-id="${esc(ex1.id)}" ${(setsA.length <= 1 || isSsLocked) ? "disabled" : ""}>-1 A</button>
              <button type="button" class="btn btn-secondary btn-sm js-add-set" data-ex-id="${esc(ex2.id)}" ${ssDisAttr}>+1 B</button>
              <button type="button" class="btn btn-secondary btn-sm js-rem-set" data-ex-id="${esc(ex2.id)}" ${(setsB.length <= 1 || isSsLocked) ? "disabled" : ""}>-1 B</button>
            </div>
          </div>
          </div>
        </article>
      `;
    }).join("");

    // Bind eventi serie singole (incluse eventuali serie extra della superserie)
    listEl.querySelectorAll('.set-item[data-mode="single"]').forEach(itemEl => {
      const exId = itemEl.dataset.exId;
      const setIdx = parseInt(itemEl.dataset.setIdx, 10);
      const ex = routine.exercises.find(e => e.id === exId);

      const wIn = itemEl.querySelector(".js-w-in");
      const rIn = itemEl.querySelector(".js-r-in");
      const rirIn = itemEl.querySelector(".js-rir-in");
      const wupBtn = itemEl.querySelector(".js-wup-btn");
      const chkBtn = itemEl.querySelector(".js-chk-btn");
      const ormBadge = itemEl.querySelector(".js-orm-badge");
      const volMini = itemEl.querySelector(".js-vol-mini");

      function refreshSingleRow() {
        const s = draft.exercises[exId][setIdx];
        const orm = s.warmup ? 0 : S.calcEpley1RM(s.weight, s.reps);
        const vol = Math.round(S.parseNum(s.weight) * Math.round(S.parseNum(s.reps)));
        ormBadge.innerHTML = formatOrmBadgeContent(orm, ex ? getBestHistorical1RM(ex) : 0);
        volMini.textContent = vol > 0 ? `Vol: ${formatInt(vol)} kg` : "";
        T.setActiveRoutineContext(routine.id);
        persist();
        if (s.done) {
          updateDashboardMetricsDOM(routine, draft);
          updateLiveExerciseAdviceDOM(routine, draft, exId);
        }
      }

      if (wupBtn) {
        wupBtn.addEventListener("click", () => {
          hapticTap(10);
          const s = draft.exercises[exId][setIdx];
          s.warmup = !s.warmup;
          persist();
          renderTrainView();
        });
      }

      wIn.addEventListener("input", () => {
        draft.exercises[exId][setIdx].weight = wIn.value;
        refreshSingleRow();
      });
      rIn.addEventListener("input", () => {
        draft.exercises[exId][setIdx].reps = rIn.value;
        refreshSingleRow();
      });
      rirIn.addEventListener("change", () => {
        draft.exercises[exId][setIdx].rir = rirIn.value;
        persist();
        if (draft.exercises[exId][setIdx].done) {
          updateLiveExerciseAdviceDOM(routine, draft, exId);
        }
      });
      chkBtn.addEventListener("click", () => {
        hapticTap(14);
        T.unlockAudio();
        const s = draft.exercises[exId][setIdx];
        s.done = !s.done;

        if (s.done && String(s.weight).trim() === "" && ex && ex.defaultWeight > 0) {
          s.weight = weightInputValue(ex.defaultWeight);
          wIn.value = s.weight;
        }
        if (s.done && String(s.reps).trim() === "" && ex) {
          s.reps = String(S.extractTargetRepsDefault(ex.repsTarget));
          rIn.value = s.reps;
        }

        if (s.done) {
          T.startSessionIfIdle(routine.id);
        }

        const arr = draft.exercises[exId] || [];
        const wasDoneCard = itemEl.closest(".card") && itemEl.closest(".card").classList.contains("card-completed");
        const nowDoneCard = arr.length > 0 && arr.every(x => x.done);

        itemEl.classList.toggle("done", s.done);
        chkBtn.classList.toggle("checked", s.done);
        refreshSingleRow();
        updateDashboardMetricsDOM(routine, draft);
        updateLiveExerciseAdviceDOM(routine, draft, exId);

        if (s.done && state.prefs.autoRest && ex && !s.warmup) {
          T.startRestTimer(ex.restSec || 90, ex.name);
        }
        if (nowDoneCard && !wasDoneCard && state.prefs.autoLockCompleted && !isExerciseLocked(draft, exId)) {
          lockExercisesAndRecalculate(routine, draft, [exId], true);
        } else if (wasDoneCard !== nowDoneCard) {
          renderTrainView();
        }
      });
    });

    // Bind eventi giri accoppiati Superserie
    listEl.querySelectorAll(".ss-round-block").forEach(blockEl => {
      const exAId = blockEl.dataset.exA;
      const exBId = blockEl.dataset.exB;
      const rIdx = parseInt(blockEl.dataset.roundIdx, 10);
      const restSec = parseInt(blockEl.dataset.rest, 10) || 90;
      const ssLabel = blockEl.dataset.ssLabel || "Superserie";

      const exA = routine.exercises.find(e => e.id === exAId);
      const exB = routine.exercises.find(e => e.id === exBId);

      const wA = blockEl.querySelector(".js-ss-wa");
      const rA = blockEl.querySelector(".js-ss-ra");
      const rirA = blockEl.querySelector(".js-ss-rira");
      const ormAEl = blockEl.querySelector(".js-ss-orm-a");

      const wB = blockEl.querySelector(".js-ss-wb");
      const rB = blockEl.querySelector(".js-ss-rb");
      const rirB = blockEl.querySelector(".js-ss-rirb");
      const ormBEl = blockEl.querySelector(".js-ss-orm-b");

      const chkBtn = blockEl.querySelector(".js-ss-chk-btn");

      function refreshPairRows() {
        const sA = draft.exercises[exAId][rIdx];
        const sB = draft.exercises[exBId][rIdx];
        const oA = S.calcEpley1RM(sA.weight, sA.reps);
        const oB = S.calcEpley1RM(sB.weight, sB.reps);
        ormAEl.innerHTML = formatOrmBadgeContent(oA, exA ? getBestHistorical1RM(exA) : 0);
        ormBEl.innerHTML = formatOrmBadgeContent(oB, exB ? getBestHistorical1RM(exB) : 0);
        T.setActiveRoutineContext(routine.id);
        persist();
        updateDashboardMetricsDOM(routine, draft);
        updateLiveExerciseAdviceDOM(routine, draft, exAId);
        updateLiveExerciseAdviceDOM(routine, draft, exBId);
      }

      wA.addEventListener("input", () => { draft.exercises[exAId][rIdx].weight = wA.value; refreshPairRows(); });
      rA.addEventListener("input", () => { draft.exercises[exAId][rIdx].reps = rA.value; refreshPairRows(); });
      rirA.addEventListener("change", () => {
        draft.exercises[exAId][rIdx].rir = rirA.value;
        persist();
        updateLiveExerciseAdviceDOM(routine, draft, exAId);
      });

      wB.addEventListener("input", () => { draft.exercises[exBId][rIdx].weight = wB.value; refreshPairRows(); });
      rB.addEventListener("input", () => { draft.exercises[exBId][rIdx].reps = rB.value; refreshPairRows(); });
      rirB.addEventListener("change", () => {
        draft.exercises[exBId][rIdx].rir = rirB.value;
        persist();
        updateLiveExerciseAdviceDOM(routine, draft, exBId);
      });

      chkBtn.addEventListener("click", () => {
        hapticTap(14);
        T.unlockAudio();
        const sA = draft.exercises[exAId][rIdx];
        const sB = draft.exercises[exBId][rIdx];
        const nextDone = !(sA.done && sB.done);

        sA.done = nextDone;
        sB.done = nextDone;

        if (nextDone) {
          if (String(sA.weight).trim() === "" && exA && exA.defaultWeight > 0) {
            sA.weight = weightInputValue(exA.defaultWeight);
            wA.value = sA.weight;
          }
          if (String(sA.reps).trim() === "" && exA) {
            sA.reps = String(S.extractTargetRepsDefault(exA.repsTarget));
            rA.value = sA.reps;
          }
          if (String(sB.weight).trim() === "" && exB && exB.defaultWeight > 0) {
            sB.weight = weightInputValue(exB.defaultWeight);
            wB.value = sB.weight;
          }
          if (String(sB.reps).trim() === "" && exB) {
            sB.reps = String(S.extractTargetRepsDefault(exB.repsTarget));
            rB.value = sB.reps;
          }
          T.startSessionIfIdle(routine.id);
        }

        const arrA = draft.exercises[exAId] || [];
        const arrB = draft.exercises[exBId] || [];
        const wasDoneCard = blockEl.closest(".card") && blockEl.closest(".card").classList.contains("card-completed");
        const nowDoneCard = arrA.length > 0 && arrB.length > 0 && arrA.every(x => x.done) && arrB.every(x => x.done);

        blockEl.classList.toggle("done", nextDone);
        chkBtn.classList.toggle("checked", nextDone);
        refreshPairRows();

        if (nextDone && state.prefs.autoRest) {
          T.startRestTimer(restSec, ssLabel);
        }
        if (nowDoneCard && !wasDoneCard && state.prefs.autoLockCompleted && !(isExerciseLocked(draft, exAId) && isExerciseLocked(draft, exBId))) {
          lockExercisesAndRecalculate(routine, draft, [exAId, exBId], true);
        } else if (wasDoneCard !== nowDoneCard) {
          renderTrainView();
        }
      });
    });

    // Stepper peso (±5 kg gambe / ±1 kg altri) e ripetizioni (±1) con aggiornamento live
    listEl.querySelectorAll(".js-w-step").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        hapticTap(10);
        const stepper = btn.closest(".weight-stepper");
        const inp = stepper ? stepper.querySelector("input") : null;
        if (!inp || inp.disabled) return;
        const delta = parseFloat(btn.dataset.delta) || 1;
        const isInt = stepper.dataset.int === "1";
        const rawCurr = String(inp.value).trim();
        let base = 0;
        if (rawCurr !== "") {
          base = S.parseNum(rawCurr);
        } else if (inp.placeholder && !isNaN(parseFloat(inp.placeholder))) {
          base = S.parseNum(inp.placeholder);
        }
        const next = isInt
          ? Math.max(0, Math.round(base + delta))
          : Math.max(0, Math.round((base + delta) * 100) / 100);
        inp.value = weightInputValue(next);
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    listEl.querySelectorAll(".js-plate-calc").forEach(btn => {
      btn.addEventListener("click", () => openPlateCalculatorModal(btn.dataset.weight));
    });

    listEl.querySelectorAll(".js-toggle-collapse").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.exId;
        if (collapsedExerciseIds.has(key)) collapsedExerciseIds.delete(key);
        else collapsedExerciseIds.add(key);
        renderTrainView();
      });
    });

    listEl.querySelectorAll(".js-copy-w1").forEach(btn => {
      btn.addEventListener("click", () => {
        const exId = btn.dataset.exId;
        const arr = draft.exercises[exId];
        if (!Array.isArray(arr) || arr.length < 2) return;
        const src = arr.find(s => !s.warmup && String(s.weight).trim() !== "") || arr.find(s => String(s.weight).trim() !== "");
        if (!src) {
          showToast("Inserisci prima un peso sulla 1ª serie", "danger");
          return;
        }
        let count = 0;
        arr.forEach(s => {
          if (!s.done && !s.warmup) {
            s.weight = src.weight;
            count++;
          }
        });
        persist();
        renderTrainView();
        showToast(count > 0 ? `Peso ${src.weight} kg applicato alle serie non completate` : "Nessuna serie da aggiornare");
      });
    });

    // Avvio manuale timer (tap breve) & Regolazione recupero (pressione prolungata >= 450ms)
    listEl.querySelectorAll(".js-manual-rest").forEach(btn => {
      let pressTimer = null;
      let suppressClick = false;
      const exIdsStr = btn.dataset.exIds || "";

      const clearPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      if (exIdsStr) {
        let startX = 0;
        let startY = 0;
        btn.addEventListener("pointerdown", e => {
          suppressClick = false;
          startX = e.clientX || 0;
          startY = e.clientY || 0;
          clearPress();
          pressTimer = setTimeout(() => {
            pressTimer = null;
            suppressClick = true;
            hapticTap(20);
            const exList = exIdsStr.split(",").map(id => routine.exercises.find(e => e.id === id)).filter(Boolean);
            if (exList.length) openEditRestModal(routine, exList, btn.dataset.name);
          }, 450);
        });
        btn.addEventListener("pointermove", e => {
          if (!pressTimer) return;
          if (Math.hypot((e.clientX || 0) - startX, (e.clientY || 0) - startY) > 10) {
            clearPress();
          }
        });
        btn.addEventListener("pointerup", clearPress);
        btn.addEventListener("pointerleave", clearPress);
        btn.addEventListener("pointercancel", clearPress);
        btn.addEventListener("contextmenu", e => e.preventDefault());
      }

      btn.addEventListener("click", () => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        T.unlockAudio();
        T.startRestTimer(parseInt(btn.dataset.rest, 10) || 90, btn.dataset.name);
      });
    });

    listEl.querySelectorAll(".js-edit-rest").forEach(btn => {
      btn.addEventListener("click", () => {
        const ids = (btn.dataset.exIds || "").split(",").filter(Boolean);
        const exList = ids.map(id => routine.exercises.find(e => e.id === id)).filter(Boolean);
        if (exList.length) openEditRestModal(routine, exList, btn.dataset.name);
      });
    });

    listEl.querySelectorAll(".js-toggle-lock").forEach(btn => {
      btn.addEventListener("click", () => {
        hapticTap(15);
        const ids = (btn.dataset.lockIds || "").split(",").filter(Boolean);
        if (!ids.length) return;
        const currentlyLocked = btn.dataset.locked === "1";
        if (currentlyLocked) unlockExercises(draft, ids);
        else lockExercisesAndRecalculate(routine, draft, ids);
      });
    });

    listEl.querySelectorAll(".js-fix-last-ex").forEach(btn => {
      btn.addEventListener("click", () => {
        const ex = routine.exercises.find(e => e.id === btn.dataset.exId);
        if (ex) openFixLastExerciseModal(routine, draft, ex);
      });
    });

    listEl.querySelectorAll(".js-edit-note").forEach(btn => {
      btn.addEventListener("click", () => {
        const ex = routine.exercises.find(e => e.id === btn.dataset.exId);
        if (ex) openQuickNoteModal(ex);
      });
    });

    // Event delegation per pulsante "🔒 Blocca dati" dentro al box dinamico .js-live-ex-advice
    listEl.onclick = e => {
      const lockBtn = e.target.closest ? e.target.closest(".js-lock-and-sync") : null;
      if (lockBtn) {
        hapticTap(15);
        const ids = (lockBtn.dataset.lockIds || "").split(",").filter(Boolean);
        if (ids.length) lockExercisesAndRecalculate(routine, draft, ids);
      }
    };

    // Applica consiglio di progressione (carico + reps target) alle serie non completate
    listEl.querySelectorAll(".js-apply-advice").forEach(btn => {
      btn.addEventListener("click", () => {
        const exId = btn.dataset.exId;
        const nextW = btn.dataset.weight;
        const nextR = btn.dataset.reps;
        const arr = draft.exercises[exId];
        if (!Array.isArray(arr)) return;
        let updated = 0;
        arr.forEach(s => {
          if (!s.done && !s.warmup) {
            if (nextW !== "") s.weight = weightInputValue(nextW);
            if (nextR !== "") s.reps = nextR;
            updated++;
          }
        });
        if (updated === 0) {
          showToast("Tutte le serie allenanti sono già completate", "info");
          return;
        }
        persist();
        renderTrainView();
        showToast(`Applicato: ${formatDec(nextW)} kg × ${nextR} rip.`, "success");
      });
    });

    // Aggiungi / rimuovi serie o giro
    listEl.querySelectorAll(".js-add-ss-round").forEach(btn => {
      btn.addEventListener("click", () => {
        [btn.dataset.exA, btn.dataset.exB].forEach(exId => {
          const arr = draft.exercises[exId] || [];
          const prev = arr[arr.length - 1] || { weight: "", reps: "10", rir: "-" };
          arr.push({ weight: prev.weight, reps: prev.reps, rir: prev.rir || "-", done: false });
          draft.exercises[exId] = arr;
        });
        persist();
        renderTrainView();
      });
    });

    listEl.querySelectorAll(".js-add-set").forEach(btn => {
      btn.addEventListener("click", () => {
        const exId = btn.dataset.exId;
        const arr = draft.exercises[exId] || [];
        const prev = arr[arr.length - 1] || { weight: "", reps: "10", rir: "-" };
        arr.push({ weight: prev.weight, reps: prev.reps, rir: prev.rir || "-", done: false });
        draft.exercises[exId] = arr;
        persist();
        renderTrainView();
      });
    });

    listEl.querySelectorAll(".js-rem-set").forEach(btn => {
      btn.addEventListener("click", () => {
        const exId = btn.dataset.exId;
        const arr = draft.exercises[exId] || [];
        if (arr.length > 1) {
          arr.pop();
          draft.exercises[exId] = arr;
          persist();
          renderTrainView();
        }
      });
    });

    updateTimersUI();
  }

  function handleResetDraft() {
    const routine = state.routines.find(r => r.id === state.activeRoutineId);
    if (!routine) return;
    openModal({
      title: "Azzera Bozza Seduta",
      bodyHtml: `<p style="margin:0; color:var(--text-muted); font-size:0.9rem;">Vuoi ripulire tutte le spunte, i carichi modificati, le note e i timer per <strong>${esc(routine.name)}</strong>?</p>`,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Azzera Bozza",
          className: "btn-danger",
          onClick: () => {
            delete state.drafts[routine.id];
            T.closeRestTimer();
            T.resetSessionTimer();
            state.activeSession.routineId = null;
            recoveryBannerDismissed = true;
            persist();
            renderRecoveryBanner();
            renderTrainView();
            showToast("Bozza seduta azzerata");
          }
        }
      ]
    });
  }

  function handleSaveWorkout() {
    const routine = state.routines.find(r => r.id === state.activeRoutineId);
    if (!routine) return;
    const draft = getOrCreateDraft(routine);

    const completedExercises = [];
    const newPrItems = [];
    let totalSets = 0;
    let totalVolume = 0;
    let best1RM = 0;

    for (const ex of routine.exercises) {
      const doneList = (draft.exercises[ex.id] || []).filter(s => s.done);
      if (doneList.length > 0) {
        const histStats = getBestHistoricalStats(ex);
        let exBestOrm = 0;
        let exMaxWeight = 0;

        const setsSaved = doneList.map(s => {
          const w = S.parseNum(s.weight);
          const r = Math.max(0, Math.round(S.parseNum(s.reps)));
          const rir = S.RIR_OPTIONS.includes(s.rir) ? s.rir : "-";
          const warmup = Boolean(s.warmup);
          const orm = warmup ? 0 : S.calcEpley1RM(w, r);
          if (!warmup) {
            totalVolume += w * r;
            totalSets++;
            if (orm > best1RM) best1RM = orm;
            if (orm > exBestOrm) exBestOrm = orm;
            if (w > exMaxWeight) exMaxWeight = w;
          }
          return { weight: w, reps: r, rir, orm, warmup };
        });

        if (histStats.best1RM > 0 && exBestOrm > histStats.best1RM) {
          newPrItems.push(`${ex.name}: 1RM ${formatDec(exBestOrm)} kg (ex ${formatDec(histStats.best1RM)} kg)`);
        } else if (histStats.maxWeight > 0 && exMaxWeight > histStats.maxWeight) {
          newPrItems.push(`${ex.name}: Carico ${formatDec(exMaxWeight)} kg (ex ${formatDec(histStats.maxWeight)} kg)`);
        }

        completedExercises.push({
          catalogId: ex.catalogId,
          name: ex.name,
          muscleGroup: ex.muscleGroup || S.inferMuscleGroup(ex.name, ex.focus),
          focus: ex.focus,
          sets: setsSaved
        });
      }
    }

    if (completedExercises.length === 0) {
      showToast("Spunta almeno una serie prima di salvare!", "danger");
      return;
    }

    const noteText = (draft.note || "").trim();
    const durationSec = T.getSessionElapsedSec();
    const prHtml = newPrItems.length > 0 ? `
      <div class="pr-summary-box">
        <div style="font-weight:800; margin-bottom:4px;">🏆 Nuovi Record Personali battuti!</div>
        <ul style="margin:0; padding-left:16px;">
          ${newPrItems.map(line => `<li>${esc(line)}</li>`).join("")}
        </ul>
      </div>
    ` : "";

    openModal({
      title: "Salva Allenamento",
      bodyHtml: `
        <p style="margin-top:0; color:var(--text-muted); font-size:0.9rem;">
          Confermi il salvataggio della seduta nello storico locale? La bozza attiva verrà ripulita per il prossimo allenamento.
        </p>
        <div class="card" style="background:var(--bg); margin-bottom:0;">
          <div style="font-weight:800; margin-bottom:8px;">${esc(routine.name)}</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.85rem;">
            <div>Esercizi: <strong>${completedExercises.length}</strong></div>
            <div>Serie allenanti: <strong>${totalSets}</strong></div>
            <div>Volume: <strong>${formatInt(totalVolume)} kg</strong></div>
            <div>Miglior 1RM: <strong>${best1RM > 0 ? formatDec(best1RM) + " kg" : "—"}</strong></div>
            ${durationSec > 0 ? `<div>Durata: <strong>${formatDuration(durationSec)}</strong></div>` : ""}
          </div>
          ${prHtml}
          ${noteText ? `<div class="session-note-highlight" style="margin:10px 0 0;">📝 ${esc(noteText)}</div>` : ""}
        </div>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Salva Seduta",
          className: "btn-success",
          onClick: () => {
            if (draft.pendingDefaultWeight) {
              routine.exercises.forEach(ex => {
                const pw = draft.pendingDefaultWeight[ex.id];
                if (pw && pw > 0) ex.defaultWeight = pw;
              });
            }
            state.history.unshift({
              id: S.uid("sess"),
              dateISO: new Date().toISOString(),
              routineId: routine.id,
              routineName: routine.name,
              durationSec,
              totalSets,
              totalVolume: Math.round(totalVolume),
              best1RM,
              note: noteText,
              exercises: completedExercises
            });
            delete state.drafts[routine.id];
            T.closeRestTimer();
            T.resetSessionTimer();
            state.activeSession.routineId = null;
            recoveryBannerDismissed = true;
            persist();
            renderRecoveryBanner();
            renderTrainView();
            showToast("Allenamento salvato nello storico!", "success");
          }
        }
      ]
    });
  }

  /* ========================================================================
     SEZIONE 2: TAB "GESTISCI" (SUPERSERIE CATENA, RIORDINO ATOMICO, CATALOGO)
     ======================================================================== */
  function renderManageView() {
    const selectEl = document.getElementById("manageRoutineSelect");
    const subEl = document.getElementById("manageRoutineSubtitle");
    const countEl = document.getElementById("manageExCount");
    const listEl = document.getElementById("manageExercisesList");

    ensureValidRoutineIds();

    selectEl.innerHTML = state.routines.map(r =>
      `<option value="${esc(r.id)}" ${r.id === state.manageRoutineId ? "selected" : ""}>${esc(r.name)}</option>`
    ).join("");

    const routine = state.routines.find(r => r.id === state.manageRoutineId);
    if (!routine) {
      subEl.textContent = "";
      countEl.textContent = "0 esercizi";
      listEl.innerHTML = `<div class="card empty-state">Nessuna scheda disponibile.</div>`;
      return;
    }

    subEl.textContent = routine.subtitle || "Nessun sottotitolo impostato";
    countEl.textContent = `${routine.exercises.length} esercizi`;

    if (!routine.exercises.length) {
      listEl.innerHTML = `<div class="card empty-state">Scheda vuota. Tocca <strong>+ Esercizio</strong> per iniziare.</div>`;
      return;
    }

    const groups = groupRoutineExercises(routine.exercises);

    let html = "";
    groups.forEach((grp, gIdx) => {
      const isFirstBlock = gIdx === 0;
      const isLastBlock = gIdx === groups.length - 1;

      if (grp.type === "superset") {
        const [exA, exB] = grp.items;
        const [iA, iB] = grp.indices;
        html += `
          <div class="manage-ss-wrapper">
            <div class="manage-ss-header">
              <span class="badge badge-ss">🔗 SUPERSERIE ACCORPATA · ${iA + 1} + ${iB + 1}</span>
              <div class="manage-ex-order">
                <button type="button" class="btn-icon js-blk-up" data-gidx="${gIdx}" ${isFirstBlock ? "disabled" : ""} aria-label="Sposta superserie su">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <button type="button" class="btn-icon js-blk-down" data-gidx="${gIdx}" ${isLastBlock ? "disabled" : ""} aria-label="Sposta superserie giù">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
              </div>
            </div>
            ${renderManageExCardInner(routine, exA, iA, false, true)}
            <div class="chain-connector-row">
              <button type="button" class="btn-chain linked js-unlink-ss" data-gid="${esc(grp.groupId)}">
                🔗 Scollega Superserie
              </button>
            </div>
            ${renderManageExCardInner(routine, exB, iB, false, true)}
          </div>
        `;
      } else {
        const ex = grp.item;
        const nextGrp = groups[gIdx + 1];
        html += renderManageExCardInner(routine, ex, grp.index, true, false, gIdx, isFirstBlock, isLastBlock);

        // Bottone rapido catena tra due esercizi singoli adiacenti
        if (nextGrp && nextGrp.type === "single") {
          html += `
            <div class="chain-connector-row">
              <button type="button" class="btn-chain js-link-ss" data-idx-a="${grp.index}" data-idx-b="${nextGrp.index}">
                🔗 Collega in Superserie
              </button>
            </div>
          `;
        }
      }
    });

    listEl.innerHTML = html;

    // Riordino a blocchi atomici (così una superserie si sposta sempre insieme)
    listEl.querySelectorAll(".js-blk-up").forEach(btn => {
      btn.addEventListener("click", () => {
        const gIdx = parseInt(btn.dataset.gidx, 10);
        if (gIdx > 0) {
          const moved = groups.splice(gIdx, 1)[0];
          groups.splice(gIdx - 1, 0, moved);
          routine.exercises = groups.flatMap(g => (g.type === "superset" ? g.items : [g.item]));
          persist();
          renderManageView();
        }
      });
    });

    listEl.querySelectorAll(".js-blk-down").forEach(btn => {
      btn.addEventListener("click", () => {
        const gIdx = parseInt(btn.dataset.gidx, 10);
        if (gIdx < groups.length - 1) {
          const moved = groups.splice(gIdx, 1)[0];
          groups.splice(gIdx + 1, 0, moved);
          routine.exercises = groups.flatMap(g => (g.type === "superset" ? g.items : [g.item]));
          persist();
          renderManageView();
        }
      });
    });

    // Collega / Scollega superserie
    listEl.querySelectorAll(".js-link-ss").forEach(btn => {
      btn.addEventListener("click", () => {
        const iA = parseInt(btn.dataset.idxA, 10);
        const iB = parseInt(btn.dataset.idxB, 10);
        const exA = routine.exercises[iA];
        const exB = routine.exercises[iB];
        if (!exA || !exB) return;
        const gid = S.uid("ss");
        exA.supersetGroupId = gid;
        exB.supersetGroupId = gid;
        if ((parseInt(exA.restSec, 10) || 0) <= 30 && (parseInt(exB.restSec, 10) || 0) > 30) {
          exA.restSec = exB.restSec;
        }
        persist();
        renderManageView();
        showToast("Superserie collegata!", "success");
      });
    });

    listEl.querySelectorAll(".js-unlink-ss").forEach(btn => {
      btn.addEventListener("click", () => {
        const gid = btn.dataset.gid;
        routine.exercises.forEach(e => {
          if (e.supersetGroupId === gid) e.supersetGroupId = null;
        });
        persist();
        renderManageView();
        showToast("Superserie scollegata");
      });
    });

    // Azioni singolo esercizio
    listEl.querySelectorAll(".js-edit-ex").forEach(btn => {
      btn.addEventListener("click", () => {
        const ex = routine.exercises.find(e => e.id === btn.dataset.id);
        if (ex) openExerciseModal(routine, ex);
      });
    });

    listEl.querySelectorAll(".js-dup-ex").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = routine.exercises.findIndex(e => e.id === btn.dataset.id);
        if (idx === -1) return;
        const orig = routine.exercises[idx];

        // Crea una nuova variante anche nel catalogo così è tracciabile separatamente se desiderato
        const newCat = {
          id: S.uid("cat"),
          name: `${orig.name} (Variante)`,
          muscleGroup: orig.muscleGroup || "Altro",
          defaultRestSec: orig.restSec || 90,
          defaultStimulus: orig.stimulus || "Ipertrofia",
          note: orig.note || ""
        };
        state.catalog.push(newCat);

        const copy = Object.assign({}, orig, {
          id: S.uid("ex"),
          catalogId: newCat.id,
          name: newCat.name,
          supersetGroupId: null
        });

        // Inserisce subito dopo l'eventuale blocco superserie per non spezzare una coppia esistente
        let insertAt = idx + 1;
        if (orig.supersetGroupId && routine.exercises[idx + 1] && routine.exercises[idx + 1].supersetGroupId === orig.supersetGroupId) {
          insertAt = idx + 2;
        }
        routine.exercises.splice(insertAt, 0, copy);
        persist();
        renderManageView();
        showToast("Variante duplicata in scheda e catalogo!", "success");
      });
    });

    listEl.querySelectorAll(".js-move-ex").forEach(btn => {
      btn.addEventListener("click", () => {
        const ex = routine.exercises.find(e => e.id === btn.dataset.id);
        if (ex) openTransferModal(routine, ex);
      });
    });

    listEl.querySelectorAll(".js-del-ex").forEach(btn => {
      btn.addEventListener("click", () => {
        const ex = routine.exercises.find(e => e.id === btn.dataset.id);
        if (!ex) return;
        openModal({
          title: "Elimina Esercizio",
          bodyHtml: `<p style="margin:0; color:var(--text-muted);">Eliminare <strong>${esc(ex.name)}</strong> dalla scheda <strong>${esc(routine.name)}</strong>?</p>`,
          buttons: [
            { label: "Annulla", className: "btn-secondary" },
            {
              label: "Elimina",
              className: "btn-danger",
              onClick: () => {
                if (ex.supersetGroupId) {
                  routine.exercises.forEach(e => {
                    if (e.supersetGroupId === ex.supersetGroupId) e.supersetGroupId = null;
                  });
                }
                routine.exercises = routine.exercises.filter(e => e.id !== ex.id);
                if (state.drafts[routine.id] && state.drafts[routine.id].exercises) {
                  delete state.drafts[routine.id].exercises[ex.id];
                }
                persist();
                renderManageView();
                showToast("Esercizio eliminato");
              }
            }
          ]
        });
      });
    });
  }

  function renderManageExCardInner(routine, ex, idx, showOrderBtns, inSuperset, gIdx, isFirstBlock, isLastBlock) {
    return `
      <div class="manage-ex-card ${inSuperset ? "manage-ex-inner" : ""}">
        <div class="manage-ex-top">
          <div>
            <div style="font-weight:800; font-size:0.96rem; margin-bottom:4px;">${idx + 1}. ${esc(ex.name)}</div>
            <div class="ex-badges" style="margin-bottom:5px;">
              <span class="badge ${getFocusBadgeClass(ex.focus)}">${esc(ex.focus)}</span>
              <span class="badge badge-muscle">${esc(ex.muscleGroup || "Altro")}</span>
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              ${ex.sets} × ${esc(ex.repsTarget)} · Base: ${ex.defaultWeight > 0 ? formatDec(ex.defaultWeight) + " kg" : "Da calibrare"} · Rec: ${ex.restSec}s
            </div>
            ${ex.note ? `<div style="font-size:0.75rem; color:#fde68a; margin-top:4px;">Nota: ${esc(ex.note)}</div>` : ""}
          </div>
          ${showOrderBtns ? `
            <div class="manage-ex-order">
              <button type="button" class="btn-icon js-blk-up" data-gidx="${gIdx}" ${isFirstBlock ? "disabled" : ""} aria-label="Sposta su">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
              </button>
              <button type="button" class="btn-icon js-blk-down" data-gidx="${gIdx}" ${isLastBlock ? "disabled" : ""} aria-label="Sposta giù">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
            </div>
          ` : ""}
        </div>
        <div class="manage-ex-bottom">
          <button type="button" class="btn btn-secondary btn-sm js-edit-ex" data-id="${esc(ex.id)}">Modifica</button>
          <button type="button" class="btn btn-secondary btn-sm js-dup-ex" data-id="${esc(ex.id)}">Duplica</button>
          <button type="button" class="btn btn-secondary btn-sm js-move-ex" data-id="${esc(ex.id)}" ${state.routines.length < 2 ? "disabled" : ""}>Sposta in...</button>
          <button type="button" class="btn btn-danger btn-sm js-del-ex" data-id="${esc(ex.id)}">Elimina</button>
        </div>
      </div>
    `;
  }

  /* ========================================================================
     MODALI ESERCIZIO & CATALOGO PERSISTENTE
     ======================================================================== */
  function openExerciseModal(routine, existingEx) {
    const isEdit = Boolean(existingEx);
    const currentFocus = existingEx ? (existingEx.focus || "Ipertrofia") : "Ipertrofia";
    const sortedCat = state.catalog.slice().sort((a, b) => a.name.localeCompare(b.name, "it"));
    const initMuscle = existingEx ? existingEx.muscleGroup : "Altro";
    const initName = existingEx ? existingEx.name : "";
    const initStep = S.getExerciseWeightStep(initMuscle, initName);

    openModal({
      title: isEdit ? "Modifica Esercizio" : "Aggiungi Esercizio",
      bodyHtml: `
        <div class="form-group">
          <label class="form-label" for="mCatSearch">Cerca nel catalogo esercizi</label>
          <input id="mCatSearch" class="input-field" type="search" placeholder="Es. Chest, Lat, Curl..." style="margin-bottom:8px;" />
          <label class="form-label" for="mCatSelect">${isEdit ? "Cambia o collega esercizio dal catalogo" : "Seleziona dal catalogo"}</label>
          <select id="mCatSelect" class="select-field">
            <option value="__custom__">${isEdit ? "✍️ Mantieni / Personalizza esercizio" : "+ Crea nuovo esercizio nel catalogo"}</option>
            ${sortedCat.map(c => `<option value="${esc(c.id)}" ${existingEx && existingEx.catalogId === c.id ? "selected" : ""}>${esc(c.name)} (${esc(c.muscleGroup)})</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="mExName">Nome esercizio *</label>
          <input id="mExName" class="input-field" type="text" value="${esc(initName)}" placeholder="Es. Chest Press Orizzontale" />
        </div>
        <div class="form-group">
          <label class="form-label" for="mExMuscle">Gruppo muscolare</label>
          <select id="mExMuscle" class="select-field">
            ${S.MUSCLE_GROUPS.map(mg => `<option value="${esc(mg)}" ${initMuscle === mg ? "selected" : ""}>${esc(mg)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Stimolo (adatta automaticamente serie, reps, carico e recupero)</label>
          <input id="mExFocus" type="hidden" value="${esc(currentFocus)}" />
          <div class="modal-stim-grid" role="group" aria-label="Selettore stimolo esercizio">
            <button type="button" class="modal-stim-pill ${currentFocus === "Forza" ? "active-forza" : ""} js-m-stim" data-stim="Forza">
              <strong>Forza</strong>
              <span>4 serie · 4–6</span>
            </button>
            <button type="button" class="modal-stim-pill ${currentFocus === "Ipertrofia" ? "active-iper" : ""} js-m-stim" data-stim="Ipertrofia">
              <strong>Ipertrofia</strong>
              <span>3 serie · 8–12</span>
            </button>
            <button type="button" class="modal-stim-pill ${currentFocus === "Core" ? "active-core" : ""} js-m-stim" data-stim="Core">
              <strong>Core</strong>
              <span>3 serie · 12–15</span>
            </button>
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="mExSets">Serie</label>
            <input id="mExSets" class="input-field" type="number" min="1" max="12" inputmode="numeric" value="${existingEx ? existingEx.sets : 3}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="mExReps">Target Reps</label>
            <input id="mExReps" class="input-field" type="text" value="${esc(existingEx ? existingEx.repsTarget : "8–12")}" placeholder="Es. 8–12" />
          </div>
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="mExWeight">Carico partenza (<span id="mExStepHint">±${initStep} kg</span>)</label>
            ${renderWeightStepperHtml({
              inputId: "mExWeight",
              inputClass: "",
              value: existingEx ? existingEx.defaultWeight : 0,
              placeholder: "0",
              stepDelta: initStep,
              ariaLabel: "Carico partenza in kg"
            })}
          </div>
          <div class="form-group">
            <label class="form-label" for="mExRest">Recupero (secondi)</label>
            <input id="mExRest" class="input-field" type="number" min="10" step="5" inputmode="numeric" value="${existingEx ? existingEx.restSec : 90}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="mExNote">Nota fissa (opzionale)</label>
          <input id="mExNote" class="input-field" type="text" value="${esc(existingEx ? existingEx.note : "")}" placeholder="Es. Testa i 90 kg, presa neutra..." />
        </div>
        ${isEdit ? `
          <label class="checkbox-inline" style="margin-bottom:0;">
            <input id="mExSyncCat" type="checkbox" checked />
            <span style="font-size:0.84rem;">Se modifichi questo esercizio, aggiorna anche catalogo e storico</span>
          </label>
        ` : ""}
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: isEdit ? "Salva Modifiche" : "Aggiungi",
          className: "btn-primary",
          onClick: () => {
            const name = document.getElementById("mExName").value.trim();
            if (!name) {
              showToast("Inserisci il nome dell'esercizio", "danger");
              return true;
            }
            const muscleGroup = document.getElementById("mExMuscle").value;
            const focus = document.getElementById("mExFocus").value || "Ipertrofia";
            const stimulus = focus === "Forza" ? "Forza" : "Ipertrofia";
            const sets = Math.max(1, Math.min(12, Math.round(S.parseNum(document.getElementById("mExSets").value)) || 3));
            const repsTarget = document.getElementById("mExReps").value.trim() || "8–12";
            const defaultWeight = S.parseNum(document.getElementById("mExWeight").value);
            const restSec = Math.max(10, Math.round(S.parseNum(document.getElementById("mExRest").value)) || 90);
            const note = document.getElementById("mExNote").value.trim();
            const catSelVal = document.getElementById("mCatSelect").value;

            if (isEdit) {
              const prevCatalogId = existingEx.catalogId;
              const switchedCatalog = catSelVal !== "__custom__" && catSelVal !== prevCatalogId;
              const syncCat = Boolean(document.getElementById("mExSyncCat") && document.getElementById("mExSyncCat").checked);
              let nextCatalogId = prevCatalogId;

              if (catSelVal !== "__custom__") {
                nextCatalogId = catSelVal;
              } else if (prevCatalogId && syncCat) {
                nextCatalogId = prevCatalogId;
              } else if (!nextCatalogId || S.normalizeName(name) !== S.normalizeName(existingEx.name)) {
                const matchByName = state.catalog.find(c => S.normalizeName(c.name) === S.normalizeName(name));
                if (matchByName) {
                  nextCatalogId = matchByName.id;
                } else {
                  const createdCat = {
                    id: S.uid("cat"),
                    name,
                    muscleGroup,
                    defaultRestSec: restSec,
                    defaultStimulus: stimulus,
                    note
                  };
                  state.catalog.push(createdCat);
                  nextCatalogId = createdCat.id;
                }
              }

              Object.assign(existingEx, {
                catalogId: nextCatalogId,
                name,
                muscleGroup,
                focus,
                stimulus,
                sets,
                repsTarget,
                defaultWeight,
                restSec,
                note
              });

              if (!switchedCatalog && syncCat && existingEx.catalogId) {
                const catEntry = state.catalog.find(c => c.id === existingEx.catalogId);
                if (catEntry) {
                  catEntry.name = name;
                  catEntry.muscleGroup = muscleGroup;
                  catEntry.defaultRestSec = restSec;
                  catEntry.defaultStimulus = stimulus;
                  catEntry.note = note;
                  S.syncCatalogItemReferences(state, catEntry);
                }
              }

              const draft = state.drafts[routine.id];
              if (draft && Array.isArray(draft.exercises[existingEx.id])) {
                const arr = draft.exercises[existingEx.id];
                const defaultReps = S.extractTargetRepsDefault(repsTarget);
                while (arr.length < sets) {
                  const last = arr[arr.length - 1] || {
                    weight: defaultWeight > 0 ? String(defaultWeight) : "",
                    reps: String(defaultReps),
                    rir: "-"
                  };
                  arr.push({ weight: last.weight, reps: last.reps, rir: last.rir || "-", done: false });
                }
                if (arr.length > sets) {
                  draft.exercises[existingEx.id] = arr.slice(0, sets);
                }
                draft.exercises[existingEx.id].forEach(s => {
                  if (!s.done) {
                    if (defaultWeight > 0 || switchedCatalog) {
                      s.weight = defaultWeight > 0 ? String(defaultWeight) : "";
                    }
                    s.reps = String(defaultReps);
                  }
                });
              }
              showToast("Esercizio aggiornato!", "success");
            } else {
              let catalogId = null;
              if (catSelVal !== "__custom__") {
                catalogId = catSelVal;
              } else {
                const existingSame = state.catalog.find(c => S.normalizeName(c.name) === S.normalizeName(name));
                if (existingSame) {
                  catalogId = existingSame.id;
                } else {
                  const newCat = {
                    id: S.uid("cat"),
                    name,
                    muscleGroup,
                    defaultRestSec: restSec,
                    defaultStimulus: stimulus,
                    note
                  };
                  state.catalog.push(newCat);
                  catalogId = newCat.id;
                }
              }

              routine.exercises.push({
                id: S.uid("ex"),
                catalogId,
                name,
                muscleGroup,
                focus,
                stimulus,
                sets,
                repsTarget,
                defaultWeight,
                restSec,
                supersetGroupId: null,
                note
              });
              showToast("Esercizio aggiunto!", "success");
            }
            persist();
            renderManageView();
            if (currentTab === "train") renderTrainView();
          }
        }
      ]
    });

    const searchIn = document.getElementById("mCatSearch");
    const catSel = document.getElementById("mCatSelect");
    const nameIn = document.getElementById("mExName");
    const muscleSel = document.getElementById("mExMuscle");
    const focusInput = document.getElementById("mExFocus");
    const setsIn = document.getElementById("mExSets");
    const repsIn = document.getElementById("mExReps");
    const weightIn = document.getElementById("mExWeight");
    const restIn = document.getElementById("mExRest");
    const noteIn = document.getElementById("mExNote");
    const stepHint = document.getElementById("mExStepHint");
    const modalBody = document.getElementById("modalBody");

    function updateModalWeightStepUI() {
      const nextStep = S.getExerciseWeightStep(muscleSel.value, nameIn.value);
      if (stepHint) stepHint.textContent = `±${nextStep} kg`;
      const stepper = weightIn ? weightIn.closest(".weight-stepper") : null;
      if (stepper) {
        stepper.dataset.step = String(nextStep);
        const minusBtn = stepper.querySelector(".minus");
        const plusBtn = stepper.querySelector(".plus");
        if (minusBtn) {
          minusBtn.dataset.delta = `-${nextStep}`;
          minusBtn.querySelector("small").textContent = String(nextStep);
        }
        if (plusBtn) {
          plusBtn.dataset.delta = String(nextStep);
          plusBtn.querySelector("small").textContent = String(nextStep);
        }
      }
    }

    function setModalStimulusPills(stim) {
      focusInput.value = stim;
      modalBody.querySelectorAll(".js-m-stim").forEach(btn => {
        const s = btn.dataset.stim;
        btn.classList.remove("active-forza", "active-iper", "active-core");
        if (s === stim) {
          btn.classList.add(s === "Forza" ? "active-forza" : s === "Core" ? "active-core" : "active-iper");
        }
      });
    }

    modalBody.querySelectorAll(".js-m-stim").forEach(btn => {
      btn.addEventListener("click", () => {
        const stim = btn.dataset.stim;
        setModalStimulusPills(stim);
        const refEx = {
          catalogId: catSel.value !== "__custom__" ? catSel.value : (existingEx ? existingEx.catalogId : null),
          name: nameIn.value.trim(),
          muscleGroup: muscleSel.value,
          defaultWeight: S.parseNum(weightIn.value)
        };
        const preset = computeStimulusPreset(refEx, stim);
        setsIn.value = String(preset.sets);
        repsIn.value = preset.repsTarget;
        restIn.value = String(preset.restSec);
        if (preset.suggestedWeight > 0) {
          weightIn.value = weightInputValue(preset.suggestedWeight);
        }
      });
    });

    modalBody.querySelectorAll(".js-w-step").forEach(btn => {
      btn.addEventListener("click", () => {
        const delta = parseFloat(btn.dataset.delta) || 1;
        const curr = S.parseNum(weightIn.value);
        const next = Math.max(0, Math.round((curr + delta) * 100) / 100);
        weightIn.value = weightInputValue(next);
      });
    });

    muscleSel.addEventListener("change", updateModalWeightStepUI);
    nameIn.addEventListener("input", updateModalWeightStepUI);

    function populateDropdown(filterText) {
      const q = S.normalizeName(filterText);
      const filtered = sortedCat.filter(c => !q || S.normalizeName(c.name).includes(q) || S.normalizeName(c.muscleGroup).includes(q));
      const current = catSel.value;
      const customLabel = isEdit ? "✍️ Mantieni / Personalizza esercizio" : "+ Crea nuovo esercizio nel catalogo";
      catSel.innerHTML = `<option value="__custom__">${customLabel}</option>` +
        filtered.map(c => `<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.muscleGroup)})</option>`).join("");
      if (filtered.some(c => c.id === current)) {
        catSel.value = current;
      }
    }

    searchIn.addEventListener("input", () => populateDropdown(searchIn.value));

    catSel.addEventListener("change", () => {
      const id = catSel.value;
      if (id === "__custom__") return;
      const cat = state.catalog.find(c => c.id === id);
      if (!cat) return;

      nameIn.value = cat.name;
      muscleSel.value = cat.muscleGroup;
      const stim = cat.muscleGroup === "Core" ? "Core" : (cat.defaultStimulus === "Forza" ? "Forza" : "Ipertrofia");
      setModalStimulusPills(stim);

      const refEx = { catalogId: cat.id, name: cat.name, muscleGroup: cat.muscleGroup, defaultWeight: 0 };
      const lastSummary = getLastExerciseSummary(refEx);
      const preset = computeStimulusPreset(refEx, stim);

      setsIn.value = String(preset.sets);
      repsIn.value = preset.repsTarget;
      restIn.value = String(cat.defaultRestSec || preset.restSec);
      noteIn.value = cat.note || "";

      if (preset.suggestedWeight > 0) {
        weightIn.value = weightInputValue(preset.suggestedWeight);
      } else if (lastSummary && lastSummary.bestSet && lastSummary.bestSet.weight > 0) {
        weightIn.value = weightInputValue(lastSummary.bestSet.weight);
      }
      updateModalWeightStepUI();
    });
  }

  function exportCatalogCsv() {
    try {
      const csv = S.buildCatalogCsv(state.catalog);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gymtracker-catalogo-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`Catalogo esportato (${state.catalog.length} esercizi)`, "success");
    } catch (err) {
      console.error("Export catalogo fallito:", err);
      showToast("Export del catalogo non riuscito", "danger");
    }
  }

  function processCatalogImport(rawText, fileName) {
    let parsed;
    try {
      parsed = S.parseCatalogText(rawText);
    } catch (err) {
      console.error("Import catalogo fallito:", err);
      showToast("File non leggibile", "danger");
      return;
    }

    if (!parsed || !parsed.items.length) {
      const firstError = parsed && parsed.errors && parsed.errors.length ? parsed.errors[0] : "Nessun esercizio valido nel file";
      showToast(firstError, "danger");
      return;
    }

    const existing = new Set(state.catalog.map(c => S.normalizeName(c.name)));
    const newItems = [];
    let alreadyPresent = 0;
    parsed.items.forEach(item => {
      const key = S.normalizeName(item.name);
      if (existing.has(key)) {
        alreadyPresent++;
        return;
      }
      existing.add(key);
      newItems.push(item);
    });

    if (!newItems.length) {
      showToast("Tutti gli esercizi del file sono già nel catalogo", "danger");
      return;
    }

    const preview = newItems.slice(0, 8).map(item =>
      `<li>${esc(item.name)} · ${esc(item.muscleGroup)} · Rec ${item.defaultRestSec}s</li>`
    ).join("");

    openModal({
      title: "Importa Esercizi",
      bodyHtml: `
        <p style="margin-top:0; color:var(--text-muted); font-size:0.88rem;">
          File: <strong>${esc(fileName || "import")}</strong>
        </p>
        <div class="catalog-import-preview">
          <div>Nuovi esercizi: <strong>${newItems.length}</strong></div>
          <div>Già presenti nel catalogo: <strong>${alreadyPresent}</strong></div>
          ${parsed.skipped ? `<div>Righe non valide o duplicate nel file: <strong>${parsed.skipped}</strong></div>` : ""}
        </div>
        <ul style="margin:0 0 10px; padding-left:18px; font-size:0.8rem; color:var(--text); line-height:1.5;">
          ${preview}
        </ul>
        ${newItems.length > 8 ? `<div style="font-size:0.78rem; color:var(--text-muted); margin-bottom:10px;">…e altri ${newItems.length - 8} esercizi</div>` : ""}
        <p style="margin-bottom:0; font-size:0.8rem; color:#86efac;">
          ✓ Verranno aggiunti solo al catalogo. Schede e storico non vengono modificati.
        </p>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: `Importa ${newItems.length}`,
          className: "btn-primary",
          onClick: () => {
            newItems.forEach(item => {
              state.catalog.push(Object.assign({ id: S.uid("cat") }, item));
            });
            persist();
            showToast(`${newItems.length} esercizi importati nel catalogo`, "success");
            openCatalogManagerModal();
            renderManageView();
            return true;
          }
        }
      ]
    });
  }

  function openCatalogManagerModal() {
    openModal({
      title: "Catalogo Esercizi",
      bodyHtml: `
        <div class="form-group">
          <input id="catMgrSearch" class="input-field" type="search" placeholder="Cerca esercizio o gruppo muscolare..." />
        </div>
        <div style="margin-bottom:8px;">
          <button type="button" id="btnCatNew" class="btn btn-primary btn-sm btn-block">+ Nuovo esercizio nel catalogo</button>
        </div>
        <div class="catalog-io-grid">
          <button type="button" id="btnCatExportCsv" class="btn btn-secondary btn-sm">⬇️ Esporta CSV</button>
          <button type="button" id="btnCatImport" class="btn btn-secondary btn-sm">⬆️ Importa esercizi</button>
        </div>
        <div style="font-size:0.72rem; color:var(--text-muted); margin:-4px 0 10px; line-height:1.4;">
          CSV compatibile con Excel (salva come CSV, separatore “;”) · Import supporta CSV e JSON
        </div>
        <input type="file" id="catImportFile" accept=".csv,.txt,.json,text/csv,application/json" style="display:none;" />
        <div id="catMgrList" class="catalog-mgr-list"></div>
      `,
      buttons: [{ label: "Chiudi", className: "btn-secondary" }]
    });

    function renderCatalogRows(query) {
      const q = S.normalizeName(query);
      const listEl = document.getElementById("catMgrList");
      if (!listEl) return;
      const items = state.catalog
        .filter(c => !q || S.normalizeName(c.name).includes(q) || S.normalizeName(c.muscleGroup).includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, "it"));

      if (!items.length) {
        listEl.innerHTML = `<div class="empty-state" style="padding:16px;">Nessun esercizio trovato.</div>`;
        return;
      }

      listEl.innerHTML = items.map(c => `
        <div class="catalog-row-card">
          <div>
            <div style="font-weight:800; font-size:0.9rem;">${esc(c.name)}</div>
            <div style="font-size:0.76rem; color:var(--text-muted);">
              ${esc(c.muscleGroup)} · ${esc(c.defaultStimulus)} · Rec ${c.defaultRestSec}s
            </div>
            ${c.note ? `<div style="font-size:0.74rem; color:#fde68a;">${esc(c.note)}</div>` : ""}
          </div>
          <div class="catalog-row-actions">
            <button type="button" class="btn btn-secondary btn-sm js-cat-edit" data-cid="${esc(c.id)}">Modifica</button>
            <button type="button" class="btn btn-secondary btn-sm js-cat-dup" data-cid="${esc(c.id)}">Duplica</button>
          </div>
        </div>
      `).join("");

      listEl.querySelectorAll(".js-cat-edit").forEach(btn => {
        btn.addEventListener("click", () => {
          const item = state.catalog.find(c => c.id === btn.dataset.cid);
          if (item) openCatalogItemModal(item);
        });
      });

      listEl.querySelectorAll(".js-cat-dup").forEach(btn => {
        btn.addEventListener("click", () => {
          const orig = state.catalog.find(c => c.id === btn.dataset.cid);
          if (!orig) return;
          const dup = Object.assign({}, orig, {
            id: S.uid("cat"),
            name: `${orig.name} (Variante)`
          });
          state.catalog.push(dup);
          persist();
          openCatalogItemModal(dup);
          showToast("Variante creata nel catalogo!", "success");
        });
      });
    }

    document.getElementById("catMgrSearch").addEventListener("input", e => renderCatalogRows(e.target.value));
    document.getElementById("btnCatNew").addEventListener("click", () => openCatalogItemModal(null));

    document.getElementById("btnCatExportCsv").addEventListener("click", exportCatalogCsv);

    const importInput = document.getElementById("catImportFile");
    document.getElementById("btnCatImport").addEventListener("click", () => {
      importInput.value = "";
      importInput.click();
    });
    importInput.addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => processCatalogImport(ev.target.result, file.name);
      reader.onerror = () => {
        console.error("Lettura file catalogo fallita:", reader.error);
        showToast("Lettura del file non riuscita", "danger");
      };
      reader.readAsText(file, "utf-8");
    });

    renderCatalogRows("");
  }

  function openCatalogItemModal(existingItem) {
    const isEdit = Boolean(existingItem);
    openModal({
      title: isEdit ? "Modifica nel Catalogo" : "Nuovo nel Catalogo",
      bodyHtml: `
        <div class="form-group">
          <label class="form-label" for="cItemName">Nome esercizio *</label>
          <input id="cItemName" class="input-field" type="text" value="${esc(existingItem ? existingItem.name : "")}" placeholder="Es. Panca Piana Manubri" />
        </div>
        <div class="form-row-2">
          <div class="form-group">
            <label class="form-label" for="cItemMuscle">Gruppo muscolare</label>
            <select id="cItemMuscle" class="select-field">
              ${S.MUSCLE_GROUPS.map(mg => `<option value="${esc(mg)}" ${(existingItem ? existingItem.muscleGroup : "Petto") === mg ? "selected" : ""}>${esc(mg)}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="cItemStim">Stimolo default</label>
            <select id="cItemStim" class="select-field">
              <option value="Ipertrofia" ${(!existingItem || existingItem.defaultStimulus !== "Forza") ? "selected" : ""}>Ipertrofia</option>
              <option value="Forza" ${(existingItem && existingItem.defaultStimulus === "Forza") ? "selected" : ""}>Forza</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="cItemRest">Recupero default (secondi)</label>
          <input id="cItemRest" class="input-field" type="number" min="10" step="5" inputmode="numeric" value="${existingItem ? existingItem.defaultRestSec : 90}" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="cItemNote">Nota fissa (opzionale)</label>
          <input id="cItemNote" class="input-field" type="text" value="${esc(existingItem ? existingItem.note : "")}" />
        </div>
      `,
      buttons: [
        { label: "Indietro", className: "btn-secondary", onClick: () => { openCatalogManagerModal(); return true; } },
        {
          label: "Salva",
          className: "btn-primary",
          onClick: () => {
            const name = document.getElementById("cItemName").value.trim();
            if (!name) {
              showToast("Inserisci il nome dell'esercizio", "danger");
              return true;
            }
            const muscleGroup = document.getElementById("cItemMuscle").value;
            const defaultStimulus = document.getElementById("cItemStim").value;
            const defaultRestSec = Math.max(10, Math.round(S.parseNum(document.getElementById("cItemRest").value)) || 90);
            const note = document.getElementById("cItemNote").value.trim();

            if (isEdit) {
              Object.assign(existingItem, { name, muscleGroup, defaultStimulus, defaultRestSec, note });
              S.syncCatalogItemReferences(state, existingItem);
              showToast("Catalogo, schede e storico aggiornati!", "success");
            } else {
              state.catalog.push({
                id: S.uid("cat"),
                name,
                muscleGroup,
                defaultStimulus,
                defaultRestSec,
                note
              });
              showToast("Aggiunto al catalogo!", "success");
            }
            persist();
            renderManageView();
            openCatalogManagerModal();
            return true;
          }
        }
      ]
    });
  }

  function openTransferModal(sourceRoutine, exercise) {
    const targets = state.routines.filter(r => r.id !== sourceRoutine.id);
    if (!targets.length) return;
    openModal({
      title: "Sposta Esercizio",
      bodyHtml: `
        <p style="margin-top:0; font-size:0.9rem; color:var(--text-muted);">
          Trasferisci <strong>${esc(exercise.name)}</strong> da <em>${esc(sourceRoutine.name)}</em> a:
        </p>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="mTargetRoutine">Scheda di destinazione</label>
          <select id="mTargetRoutine" class="select-field">
            ${targets.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}
          </select>
        </div>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Sposta Ora",
          className: "btn-primary",
          onClick: () => {
            const targetId = document.getElementById("mTargetRoutine").value;
            const target = state.routines.find(r => r.id === targetId);
            if (!target) return;
            if (exercise.supersetGroupId) {
              sourceRoutine.exercises.forEach(e => {
                if (e.supersetGroupId === exercise.supersetGroupId) e.supersetGroupId = null;
              });
            }
            sourceRoutine.exercises = sourceRoutine.exercises.filter(e => e.id !== exercise.id);
            target.exercises.push(exercise);
            if (state.drafts[sourceRoutine.id] && state.drafts[sourceRoutine.id].exercises) {
              delete state.drafts[sourceRoutine.id].exercises[exercise.id];
            }
            persist();
            renderManageView();
            showToast(`Spostato in "${target.name}"`, "success");
          }
        }
      ]
    });
  }

  function openRoutineModal(existingRoutine) {
    const isEdit = Boolean(existingRoutine);
    openModal({
      title: isEdit ? "Rinomina Scheda" : "Crea Nuova Scheda",
      bodyHtml: `
        <div class="form-group">
          <label class="form-label" for="mRName">Nome scheda *</label>
          <input id="mRName" class="input-field" type="text" value="${esc(isEdit ? existingRoutine.name : "")}" placeholder="Es. Scheda D — Variante Volume" />
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="mRSub">Sottotitolo / Focus</label>
          <input id="mRSub" class="input-field" type="text" value="${esc(isEdit ? existingRoutine.subtitle : "")}" placeholder="Es. Alternativa da fare ogni 4 settimane" />
        </div>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: isEdit ? "Salva" : "Crea Scheda",
          className: "btn-primary",
          onClick: () => {
            const name = document.getElementById("mRName").value.trim();
            if (!name) {
              showToast("Inserisci un nome per la scheda", "danger");
              return true;
            }
            const subtitle = document.getElementById("mRSub").value.trim();
            if (isEdit) {
              existingRoutine.name = name;
              existingRoutine.subtitle = subtitle;
              showToast("Scheda aggiornata", "success");
            } else {
              const created = { id: S.uid("routine"), name, subtitle, stimulus: "Misto", exercises: [] };
              state.routines.push(created);
              state.manageRoutineId = created.id;
              showToast("Nuova scheda creata!", "success");
            }
            persist();
            renderManageView();
          }
        }
      ]
    });
  }

  /* ========================================================================
     SEZIONE 3: TAB "ANALISI PROGRESSI" (VOLUMI + TEMPO + GRAFICI + STORICO)
     ======================================================================== */
  function formatCompactHoursMinutes(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    if (sec <= 0) return "0m";
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)}m`;
  }

  function renderWeeklyVolumeCard() {
    const container = document.getElementById("weeklyVolumeContainer");
    if (!container) return;

    const now = new Date();
    let cutoffMs = 0;
    let prevStartMs = 0;
    let prevEndMs = 0;
    let prevLabel = "";
    let headingTitle = "Volume Settimanale";

    if (weeklyScope === "week") {
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay(); // 0=Dom, 1=Lun
      const diffToMon = (day + 6) % 7;
      startOfWeek.setDate(startOfWeek.getDate() - diffToMon);
      startOfWeek.setHours(0, 0, 0, 0);
      cutoffMs = startOfWeek.getTime();
      prevEndMs = cutoffMs;
      prevStartMs = cutoffMs - 7 * 86400000;
      prevLabel = "sett. prec.";
      headingTitle = "Volume Settimanale";
    } else if (weeklyScope === "month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      cutoffMs = startOfMonth.getTime();
      prevEndMs = cutoffMs;
      prevStartMs = startOfPrevMonth.getTime();
      prevLabel = "mese prec.";
      headingTitle = "Volume Mensile";
    } else if (weeklyScope === "year") {
      const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      cutoffMs = startOfYear.getTime();
      headingTitle = "Volume Annuale";
    } else {
      cutoffMs = 0;
      headingTitle = "Volume Totale (Tutto)";
    }

    const byMuscle = new Map();
    let periodSessions = 0;
    let periodSets = 0;
    let periodVolume = 0;
    let periodDurationSec = 0;
    let timedSessions = 0;
    let prevSets = 0;
    let prevVolume = 0;

    state.history.forEach(sess => {
      const t = new Date(sess.dateISO).getTime();
      if (isNaN(t)) return;
      if (prevLabel && t >= prevStartMs && t < prevEndMs) {
        (sess.exercises || []).forEach(ex => {
          (ex.sets || []).forEach(s => {
            if (s.warmup) return;
            prevSets += 1;
            prevVolume += S.parseNum(s.weight) * Math.round(S.parseNum(s.reps));
          });
        });
      }
      if (t < cutoffMs) return;
      periodSessions++;
      const dur = Math.max(0, parseInt(sess.durationSec, 10) || 0);
      if (dur > 0) {
        periodDurationSec += dur;
        timedSessions++;
      }
      (sess.exercises || []).forEach(ex => {
        const mg = ex.muscleGroup || S.inferMuscleGroup(ex.name, ex.focus);
        (ex.sets || []).forEach(s => {
          if (s.warmup) return;
          if (!byMuscle.has(mg)) byMuscle.set(mg, { sets: 0, volume: 0 });
          const acc = byMuscle.get(mg);
          const w = S.parseNum(s.weight);
          const r = Math.round(S.parseNum(s.reps));
          acc.sets += 1;
          acc.volume += w * r;
          periodSets += 1;
          periodVolume += w * r;
        });
      });
    });

    function buildDeltaHtml(curr, prev, unit) {
      if (!prevLabel || (prev === 0 && curr === 0)) return "";
      const diff = Math.round(curr - prev);
      if (diff === 0) return `<div class="kpi-delta">= ${prevLabel}</div>`;
      const sign = diff > 0 ? "+" : "−";
      const cls = diff > 0 ? "up" : "down";
      return `<div class="kpi-delta ${cls}">${sign}${formatInt(Math.abs(diff))}${unit ? " " + unit : ""} vs ${prevLabel}</div>`;
    }

    const avgDurationSec = timedSessions > 0 ? Math.round(periodDurationSec / timedSessions) : 0;
    const rows = Array.from(byMuscle.entries()).sort((a, b) => b[1].sets - a[1].sets || b[1].volume - a[1].volume);
    const maxSets = rows.length ? Math.max(...rows.map(r => r[1].sets)) : 1;

    container.innerHTML = `
      <div class="card">
        <div class="weekly-head" style="flex-wrap:wrap;">
          <div>
            <h2 class="section-heading" style="margin:0;">${headingTitle}</h2>
            <p class="section-subtitle" style="margin:2px 0 0;">Ogni esercizio (anche in superserie) è conteggiato separatamente.</p>
          </div>
          <div class="stimulus-switch">
            <button type="button" class="stim-btn ${weeklyScope === "week" ? "active-iper" : ""} js-week-scope" data-scope="week">Sett.</button>
            <button type="button" class="stim-btn ${weeklyScope === "month" ? "active-iper" : ""} js-week-scope" data-scope="month">Mese</button>
            <button type="button" class="stim-btn ${weeklyScope === "year" ? "active-iper" : ""} js-week-scope" data-scope="year">Anno</button>
            <button type="button" class="stim-btn ${weeklyScope === "all" ? "active-iper" : ""} js-week-scope" data-scope="all">Tutto</button>
          </div>
        </div>

        <div class="kpi-grid-4" style="margin-top:10px; margin-bottom:12px;">
          <div class="kpi-card">
            <div class="kpi-value green">${periodSessions}</div>
            <div class="kpi-label">Sedute</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">${periodSets}</div>
            <div class="kpi-label">Serie totali</div>
            ${buildDeltaHtml(periodSets, prevSets, "")}
          </div>
          <div class="kpi-card">
            <div class="kpi-value pr">${formatInt(periodVolume)} kg</div>
            <div class="kpi-label">Volume totale</div>
            ${buildDeltaHtml(periodVolume, prevVolume, "kg")}
          </div>
          <div class="kpi-card">
            <div class="kpi-value">${periodDurationSec > 0 ? formatCompactHoursMinutes(periodDurationSec) : "—"}</div>
            <div class="kpi-label">${avgDurationSec > 0 ? "Tempo (media " + formatCompactHoursMinutes(avgDurationSec) + ")" : "Tempo totale"}</div>
          </div>
        </div>

        ${rows.length ? `
          <div class="muscle-bars">
            ${rows.map(([mg, data]) => {
              const pct = Math.max(8, Math.round((data.sets / maxSets) * 100));
              return `
                <div class="muscle-bar-item">
                  <div class="muscle-bar-top">
                    <span style="font-weight:700;">${esc(mg)}</span>
                    <span style="color:var(--text-muted); font-variant-numeric:tabular-nums;"><strong>${data.sets} serie</strong> · ${formatInt(data.volume)} kg</span>
                  </div>
                  <div class="progress-track" style="height:7px;">
                    <div class="progress-fill" style="width:${pct}%;"></div>
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        ` : `<div style="font-size:0.84rem; color:var(--text-muted); text-align:center; padding:8px 0;">Nessuna serie registrata in questo intervallo.</div>`}
      </div>
    `;

    container.querySelectorAll(".js-week-scope").forEach(btn => {
      btn.addEventListener("click", () => {
        weeklyScope = btn.dataset.scope;
        renderWeeklyVolumeCard();
      });
    });
  }

  function renderProgressView() {
    document.querySelectorAll(".metric-tab-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.metric === selectedProgressMetric);
    });
    renderWeeklyVolumeCard();
    renderProgressExerciseAnalysis();
    renderProgressSessionsHistory();
  }

  function renderProgressExerciseAnalysis() {
    const selectEl = document.getElementById("progressExerciseSelect");
    const contentEl = document.getElementById("progressExerciseContent");
    const metricTabs = document.getElementById("metricTabsContainer");

    const itemMap = new Map();
    state.history.forEach(sess => {
      (sess.exercises || []).forEach(ex => {
        const key = ex.catalogId ? `id:${ex.catalogId}` : `name:${S.normalizeName(ex.name)}`;
        if (!itemMap.has(key)) {
          itemMap.set(key, { key, catalogId: ex.catalogId || null, name: ex.name });
        }
      });
    });

    const loggedItems = Array.from(itemMap.values()).sort((a, b) => a.name.localeCompare(b.name, "it"));

    if (!loggedItems.length) {
      selectEl.innerHTML = `<option value="">Nessun esercizio nello storico</option>`;
      metricTabs.style.opacity = "0.5";
      contentEl.innerHTML = `
        <div class="card empty-state">
          Nessun dato di progressione ancora salvato.<br/>
          Completa e salva il tuo primo allenamento nella tab <strong>Allena</strong> per sbloccare grafici e record personali (PR).
        </div>
      `;
      return;
    }

    metricTabs.style.opacity = "1";

    if (!selectedProgressKey || !loggedItems.some(it => it.key === selectedProgressKey)) {
      selectedProgressKey = loggedItems[0].key;
    }

    selectEl.innerHTML = loggedItems.map(it =>
      `<option value="${esc(it.key)}" ${it.key === selectedProgressKey ? "selected" : ""}>${esc(it.name)}</option>`
    ).join("");

    const selectedItem = loggedItems.find(it => it.key === selectedProgressKey) || loggedItems[0];
    const entries = [];
    const sortedAsc = getSortedHistoryDesc().slice().reverse();

    for (const sess of sortedAsc) {
      const ex = (sess.exercises || []).find(e => {
        if (!e.sets || !e.sets.length) return false;
        if (selectedItem.catalogId && e.catalogId) return e.catalogId === selectedItem.catalogId;
        return S.normalizeName(e.name) === S.normalizeName(selectedItem.name);
      });
      if (ex) {
        const workingSets = ex.sets.filter(s => !s.warmup);
        if (!workingSets.length) continue;
        let bestOrm = 0;
        let maxW = 0;
        let vol = 0;
        const rirNums = [];
        workingSets.forEach(s => {
          const w = S.parseNum(s.weight);
          const r = Math.round(S.parseNum(s.reps));
          const orm = s.orm != null ? S.parseNum(s.orm) : S.calcEpley1RM(w, r);
          if (orm > bestOrm) bestOrm = orm;
          if (w > maxW) maxW = w;
          vol += w * r;
          const rn = parseRirNumeric(s.rir);
          if (rn !== null) rirNums.push(rn);
        });
        entries.push({
          dateISO: sess.dateISO,
          routineName: sess.routineName,
          orm: Math.round(bestOrm * 10) / 10,
          maxWeight: maxW,
          volume: Math.round(vol),
          rirNums,
          sets: workingSets
        });
      }
    }

    if (!entries.length) {
      contentEl.innerHTML = `<div class="card empty-state">Nessuna serie allenante registrata per questo esercizio (solo serie di riscaldamento).</div>`;
      return;
    }

    const pr1RM = Math.max(...entries.map(e => e.orm));
    const maxWeightEver = Math.max(...entries.map(e => e.maxWeight));
    const recentRirs = entries.slice(-5).flatMap(e => e.rirNums);
    const avgRir = recentRirs.length > 0
      ? formatDec(recentRirs.reduce((a, b) => a + b, 0) / recentRirs.length)
      : "—";

    const kpiHtml = `
      <div class="kpi-grid-4">
        <div class="kpi-card">
          <div class="kpi-value pr">${pr1RM > 0 ? formatDec(pr1RM) + " kg" : "—"}</div>
          <div class="kpi-label">Miglior 1RM (PR)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${maxWeightEver > 0 ? formatDec(maxWeightEver) + " kg" : "—"}</div>
          <div class="kpi-label">Carico Max</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value green">${avgRir}</div>
          <div class="kpi-label">RIR medio recente</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${entries.length}</div>
          <div class="kpi-label">Sedute registrate</div>
        </div>
      </div>
    `;

    contentEl.innerHTML = buildResponsiveSVGChart(entries, selectedProgressMetric) + kpiHtml;
  }

  function buildResponsiveSVGChart(entries, metricKey) {
    const meta = {
      orm: { title: "1RM Stimato (kg)", color: "#fbbf24", format: v => formatDec(v) },
      maxWeight: { title: "Carico Max (kg)", color: "#38bdf8", format: v => formatDec(v) },
      volume: { title: "Volume Esercizio (kg)", color: "#34d399", format: v => formatInt(v) }
    }[metricKey] || { title: "1RM Stimato (kg)", color: "#fbbf24", format: v => formatDec(v) };

    const values = entries.map(e => e[metricKey]);
    let minV = Math.min(...values);
    let maxV = Math.max(...values);

    if (minV === maxV) {
      const delta = Math.max(5, Math.round(minV * 0.1));
      minV = Math.max(0, minV - delta);
      maxV = maxV + delta;
    } else {
      const pad = (maxV - minV) * 0.16;
      minV = Math.max(0, minV - pad);
      maxV = maxV + pad;
    }

    const W = 460;
    const H = 215;
    const padL = maxV >= 10000 ? 54 : 48;
    const padR = 20;
    const padT = 26;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const getX = i => entries.length === 1 ? padL + plotW / 2 : padL + (i / (entries.length - 1)) * plotW;
    const getY = v => padT + plotH - ((v - minV) / (maxV - minV)) * plotH;

    function formatYAxisTick(val) {
      const rounded = Math.round(val);
      if (rounded >= 10000) return (rounded / 1000).toFixed(1).replace(/\.0$/, "").replace(".", ",") + "k";
      return String(rounded);
    }

    let gridSvg = "";
    for (let g = 0; g <= 3; g++) {
      const frac = g / 3;
      const y = padT + plotH * frac;
      const val = maxV - (maxV - minV) * frac;
      gridSvg += `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#26334a" stroke-dasharray="3,3" stroke-width="1" />
        <text x="${padL - 8}" y="${(y + 4).toFixed(1)}" fill="#9aa9c0" font-size="10.5" text-anchor="end">${formatYAxisTick(val)}</text>
      `;
    }

    const pts = entries.map((e, i) => ({
      x: getX(i),
      y: getY(e[metricKey]),
      val: e[metricKey],
      date: formatShortDateIT(e.dateISO)
    }));

    const polyStr = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const areaPath = pts.length > 1
      ? `M ${pts[0].x.toFixed(1)},${(padT + plotH).toFixed(1)} ` +
        pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
        ` L ${pts[pts.length - 1].x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : "";

    const lastPtX = pts.length ? pts[pts.length - 1].x : 0;
    let lastLabelX = -999;
    let xLabelsSvg = "";
    pts.forEach((p, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === pts.length - 1;
      if (isFirst || isLast || (p.x - lastLabelX >= 56 && lastPtX - p.x >= 46)) {
        xLabelsSvg += `<text x="${p.x.toFixed(1)}" y="${H - 9}" fill="#9aa9c0" font-size="10.5" text-anchor="middle">${p.date}</text>`;
        lastLabelX = p.x;
      }
    });

    const dotsSvg = pts.map((p, idx) => {
      const showVal = pts.length <= 8 || idx === 0 || idx === pts.length - 1 || idx % Math.ceil(pts.length / 6) === 0;
      return `
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="${meta.color}" stroke="#0a0e16" stroke-width="2.2" />
        ${showVal ? `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" fill="#f4f7fc" font-size="10.5" font-weight="700" text-anchor="middle">${meta.format(p.val)}</text>` : ""}
      `;
    }).join("");

    const gradId = "grad_" + metricKey;

    return `
      <div class="chart-box">
        <div class="chart-header">
          <span>${meta.title}</span>
          <span style="color:${meta.color}; font-size:0.76rem;">${entries.length} ${entries.length === 1 ? "punto" : "sedute"}</span>
        </div>
        <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafico ${meta.title}">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${meta.color}" stop-opacity="0.32" />
              <stop offset="100%" stop-color="${meta.color}" stop-opacity="0.0" />
            </linearGradient>
          </defs>
          ${gridSvg}
          ${areaPath ? `<path d="${areaPath}" fill="url(#${gradId})" />` : ""}
          ${pts.length > 1 ? `<polyline fill="none" stroke="${meta.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${polyStr}" />` : ""}
          ${dotsSvg}
          ${xLabelsSvg}
        </svg>
      </div>
    `;
  }

  function openEditSessionModal(sess) {
    const exercisesHtml = (sess.exercises || []).map((ex, exIdx) => `
      <div class="edit-sess-ex-box">
        <div style="font-weight:800; font-size:0.88rem; margin-bottom:4px;">${esc(ex.name)}</div>
        ${(ex.sets || []).map((s, sIdx) => `
          <div class="edit-sess-set-row">
            <span style="font-size:0.78rem; color:var(--text-muted); font-weight:800;">${s.warmup ? "W" : "#" + (sIdx + 1)}</span>
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false"
              class="set-input js-es-w" data-ex="${exIdx}" data-set="${sIdx}" value="${esc(weightInputValue(s.weight))}" aria-label="Kg" />
            <input type="number" step="1" min="0" inputmode="numeric"
              class="set-input js-es-r" data-ex="${exIdx}" data-set="${sIdx}" value="${esc(s.reps)}" aria-label="Reps" />
            <select class="set-select js-es-rir" data-ex="${exIdx}" data-set="${sIdx}" aria-label="RIR">
              ${S.RIR_OPTIONS.map(opt => `<option value="${esc(opt)}" ${(s.rir || "-") === opt ? "selected" : ""}>${esc(opt)}</option>`).join("")}
            </select>
          </div>
        `).join("")}
      </div>
    `).join("");

    openModal({
      title: `Modifica Seduta · ${formatDateIT(sess.dateISO)}`,
      bodyHtml: `
        <div class="form-group">
          <label class="form-label" for="mSessDurationMin">Durata seduta (minuti)</label>
          <input id="mSessDurationMin" class="input-field" type="number" min="0" step="1" inputmode="numeric" value="${Math.round((sess.durationSec || 0) / 60)}" />
        </div>
        <div class="form-group">
          <label class="form-label" for="mSessNote">Note di seduta</label>
          <textarea id="mSessNote" class="textarea-field">${esc(sess.note || "")}</textarea>
        </div>
        ${exercisesHtml}
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Salva Modifiche",
          className: "btn-success",
          onClick: () => {
            const durMin = Math.max(0, Math.round(S.parseNum(document.getElementById("mSessDurationMin").value)));
            sess.durationSec = durMin * 60;
            sess.note = document.getElementById("mSessNote").value.trim();
            let totalVolume = 0;
            let best1RM = 0;
            let totalSets = 0;

            document.querySelectorAll(".js-es-w").forEach(inp => {
              const exIdx = parseInt(inp.dataset.ex, 10);
              const sIdx = parseInt(inp.dataset.set, 10);
              sess.exercises[exIdx].sets[sIdx].weight = S.parseNum(inp.value);
            });
            document.querySelectorAll(".js-es-r").forEach(inp => {
              const exIdx = parseInt(inp.dataset.ex, 10);
              const sIdx = parseInt(inp.dataset.set, 10);
              sess.exercises[exIdx].sets[sIdx].reps = Math.max(0, Math.round(S.parseNum(inp.value)));
            });
            document.querySelectorAll(".js-es-rir").forEach(sel => {
              const exIdx = parseInt(sel.dataset.ex, 10);
              const sIdx = parseInt(sel.dataset.set, 10);
              sess.exercises[exIdx].sets[sIdx].rir = S.RIR_OPTIONS.includes(sel.value) ? sel.value : "-";
            });

            (sess.exercises || []).forEach(ex => {
              (ex.sets || []).forEach(s => {
                const orm = s.warmup ? 0 : S.calcEpley1RM(s.weight, s.reps);
                s.orm = orm;
                if (!s.warmup) {
                  totalVolume += s.weight * s.reps;
                  if (orm > best1RM) best1RM = orm;
                  totalSets++;
                }
              });
            });

            sess.totalSets = totalSets;
            sess.totalVolume = Math.round(totalVolume);
            sess.best1RM = best1RM;

            // Aggiorna eventuali bozze attive non ancora iniziate in Allena per gli esercizi modificati
            (sess.exercises || []).forEach(he => {
              state.routines.forEach(r => {
                const draft = state.drafts[r.id];
                if (!draft || !draft.exercises) return;
                r.exercises.forEach(ex => {
                  if (!matchesExercise(he, ex) || isExerciseLocked(draft, ex.id)) return;
                  const arr = draft.exercises[ex.id];
                  if (!Array.isArray(arr) || arr.some(x => x.done)) return;
                  const lastInfo = getLastExerciseSummary(ex);
                  if (!lastInfo) return;
                  const autoAdvice = (state.prefs && state.prefs.autoApplyAdvice)
                    ? computeProgressionAdvice(ex, lastInfo)
                    : null;
                  const useSug = Boolean(autoAdvice && autoAdvice.suggestedWeight && autoAdvice.suggestedWeight > 0);
                  arr.forEach((sDraft, idx) => {
                    const prev = lastInfo.sets[idx] || lastInfo.sets[lastInfo.sets.length - 1];
                    const w = useSug ? autoAdvice.suggestedWeight : (prev ? prev.weight : sDraft.weight);
                    const reps = (useSug && autoAdvice.suggestedReps) ? autoAdvice.suggestedReps : (prev ? prev.reps : sDraft.reps);
                    sDraft.weight = w === 0 || w === "" ? "" : weightInputValue(w);
                    sDraft.reps = String(reps);
                  });
                });
              });
            });

            persist();
            renderProgressView();
            showToast("Seduta aggiornata!", "success");
          }
        }
      ]
    });
  }

  function renderProgressSessionsHistory() {
    const filterEl = document.getElementById("historyFilterPills");
    const listEl = document.getElementById("progressSessionsList");
    const sortedHistory = getSortedHistoryDesc();

    if (filterEl) {
      if (!sortedHistory.length) {
        filterEl.innerHTML = "";
      } else {
        const names = Array.from(new Set(sortedHistory.map(s => s.routineName).filter(Boolean)));
        if (selectedHistoryRoutine !== "ALL" && !names.includes(selectedHistoryRoutine)) {
          selectedHistoryRoutine = "ALL";
        }
        filterEl.innerHTML = [`<button type="button" class="routine-pill ${selectedHistoryRoutine === "ALL" ? "active" : ""} js-hist-filter" data-filter="ALL">Tutte (${sortedHistory.length})</button>`]
          .concat(names.map(name => `<button type="button" class="routine-pill ${selectedHistoryRoutine === name ? "active" : ""} js-hist-filter" data-filter="${esc(name)}">${esc(name)}</button>`))
          .join("");
        filterEl.querySelectorAll(".js-hist-filter").forEach(btn => {
          btn.addEventListener("click", () => {
            selectedHistoryRoutine = btn.dataset.filter;
            renderProgressSessionsHistory();
          });
        });
      }
    }

    const filtered = selectedHistoryRoutine === "ALL"
      ? sortedHistory
      : sortedHistory.filter(s => s.routineName === selectedHistoryRoutine);

    if (!filtered.length) {
      listEl.innerHTML = `<div class="card empty-state">Lo storico delle sedute è vuoto.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(sess => `
      <div class="history-session-card" data-sid="${esc(sess.id)}">
        <button type="button" class="history-session-head js-toggle-sess">
          <div>
            <div style="font-weight:800; font-size:0.95rem;">${esc(sess.routineName)}</div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">
              ${formatDateIT(sess.dateISO)} · ${sess.totalSets || 0} serie${sess.durationSec > 0 ? " · ⏱️ " + formatDuration(sess.durationSec) : ""}${sess.note ? " · 📝 Nota" : ""}
            </div>
          </div>
          <div style="text-align:right; flex-shrink:0;">
            <div style="font-weight:900; color:var(--accent); font-size:0.92rem;">${formatInt(sess.totalVolume || 0)} kg</div>
            <div style="font-size:0.72rem; color:var(--text-dim);">Dettagli <span class="history-chevron">▾</span></div>
          </div>
        </button>

        <div class="history-session-body">
          ${sess.note ? `<div class="session-note-highlight"><strong>📝 Note di seduta:</strong><br/>${esc(sess.note)}</div>` : ""}

          ${(sess.exercises || []).map(ex => `
            <div class="history-ex-block">
              <div style="font-weight:800; font-size:0.87rem;">${esc(ex.name)}</div>
              <div class="history-set-chips">
                ${(ex.sets || []).map((s, idx) => {
                  const orm = s.warmup ? 0 : (s.orm != null ? S.parseNum(s.orm) : S.calcEpley1RM(s.weight, s.reps));
                  const rirBadge = s.warmup ? "Riscald." : (s.rir && s.rir !== "-" ? `RIR ${esc(s.rir)}` : "RIR —");
                  return `
                    <div class="history-set-line">
                      <span><strong>${s.warmup ? "W" : "#" + (idx + 1)}</strong> · ${formatDec(s.weight)} kg × ${s.reps}</span>
                      <span style="color:var(--text-muted);">${rirBadge}</span>
                      <span style="color:#fbbf24; font-weight:800;">${s.warmup ? "Warm-up" : (orm > 0 ? "1RM " + formatDec(orm) + " kg" : "—")}</span>
                    </div>
                  `;
                }).join("")}
              </div>
            </div>
          `).join("")}

          <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
            <button type="button" class="btn btn-secondary btn-sm js-edit-sess" data-sid="${esc(sess.id)}">
              Modifica seduta
            </button>
            <button type="button" class="btn btn-danger btn-sm js-del-sess" data-sid="${esc(sess.id)}">
              Elimina seduta
            </button>
          </div>
        </div>
      </div>
    `).join("");

    listEl.querySelectorAll(".js-toggle-sess").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.closest(".history-session-card").classList.toggle("expanded");
      });
    });

    listEl.querySelectorAll(".js-edit-sess").forEach(btn => {
      btn.addEventListener("click", () => {
        const sess = state.history.find(s => s.id === btn.dataset.sid);
        if (sess) openEditSessionModal(sess);
      });
    });

    listEl.querySelectorAll(".js-del-sess").forEach(btn => {
      btn.addEventListener("click", () => {
        const sid = btn.dataset.sid;
        openModal({
          title: "Elimina Seduta",
          bodyHtml: `<p style="margin:0; color:var(--text-muted);">Vuoi rimuovere definitivamente questa seduta dallo storico locale?</p>`,
          buttons: [
            { label: "Annulla", className: "btn-secondary" },
            {
              label: "Elimina",
              className: "btn-danger",
              onClick: () => {
                state.history = state.history.filter(s => s.id !== sid);
                persist();
                renderProgressView();
                showToast("Seduta eliminata dallo storico");
              }
            }
          ]
        });
      });
    });
  }

  /* ========================================================================
     SEZIONE 4: TAB "DATI" (BACKUP, PREFERENZE & RIPRISTINO)
     ======================================================================== */
  const GOAL_DESCRIPTIONS = {
    Misto: "50% Forza / 50% Ipertrofia: esercizi fondamentali pesanti (4×5–6, rec. 150–180s) uniti a complementari e superserie ad alto volume (3×8–15, rec. 60–90s).",
    Forza: "Solo Forza: focus su multiarticolari principali con 4 serie da 4–6 ripetizioni, recuperi ampi (150–180s) e massimo controllo tecnico.",
    Ipertrofia: "Solo Ipertrofia: più ripetizioni (8–15 rip.), recuperi contenuti (60–105s) e superserie braccia per massimizzare volume e stimolo muscolare."
  };

  function ensureProposedCatalogEntries(proposed) {
    (proposed || []).forEach(r => {
      (r.exercises || []).forEach(ex => {
        if (!state.catalog.some(c => c.id === ex.catalogId)) {
          state.catalog.push({
            id: ex.catalogId || S.uid("cat"),
            name: ex.name,
            muscleGroup: ex.muscleGroup,
            defaultRestSec: ex.restSec,
            defaultStimulus: ex.stimulus || "Ipertrofia",
            note: ex.note || ""
          });
        }
      });
    });
  }

  function generateGoalRoutinesForUser(goal) {
    const proposed = S.buildGoalRoutinesTemplate(goal);
    proposed.forEach(r => {
      r.exercises.forEach(ex => {
        const best1RM = getBestHistorical1RM(ex);
        if (best1RM > 0) {
          const isForza = ex.focus === "Forza" || ex.stimulus === "Forza";
          const pct = isForza ? 0.825 : 0.70;
          const step = getPreferredRoundingStep();
          const calibrated = S.roundToGymStep(best1RM * pct, step);
          if (calibrated > 0) ex.defaultWeight = calibrated;
        }
      });
    });
    return proposed;
  }

  function openGoalProposalModal(goal) {
    const chosenGoal = GOAL_DESCRIPTIONS[goal] ? goal : "Misto";
    const proposed = generateGoalRoutinesForUser(chosenGoal);

    const previewHtml = proposed.map(r => `
      <div class="goal-preview-card">
        <div style="font-weight:800; font-size:0.9rem; margin-bottom:3px;">${esc(r.name)}</div>
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:6px;">${esc(r.subtitle)}</div>
        <ul style="margin:0; padding-left:16px; font-size:0.78rem; color:var(--text); line-height:1.45;">
          ${r.exercises.map(ex => `
            <li>
              <strong>${esc(ex.name)}</strong> · ${ex.sets}×${esc(ex.repsTarget)}
              ${ex.defaultWeight > 0 ? ` · ${formatDec(ex.defaultWeight)} kg` : ""}
              · Rec ${ex.restSec}s
              ${ex.supersetGroupId ? ` <span style="color:#e9d5ff;">(SS)</span>` : ""}
            </li>
          `).join("")}
        </ul>
      </div>
    `).join("");

    openModal({
      title: `Proposta Schede · ${chosenGoal}`,
      bodyHtml: `
        <p style="margin-top:0; font-size:0.86rem; color:var(--text-muted);">
          ${esc(GOAL_DESCRIPTIONS[chosenGoal])}
        </p>
        <div style="max-height:52vh; overflow-y:auto;">${previewHtml}</div>
        <p style="margin-bottom:0; font-size:0.78rem; color:#86efac;">
          ✓ Lo storico allenamenti e il catalogo resteranno sempre intatti.
        </p>
      `,
      buttons: [
        { label: "Annulla", className: "btn-secondary" },
        {
          label: "Aggiungi alle attuali",
          className: "btn-secondary",
          onClick: () => {
            ensureProposedCatalogEntries(proposed);
            state.routines.push(...proposed);
            state.manageRoutineId = proposed[0].id;
            persist();
            renderDataView();
            showToast(`Aggiunte 3 schede (${chosenGoal})!`, "success");
          }
        },
        {
          label: "Sostituisci schede",
          className: "btn-primary",
          onClick: () => {
            ensureProposedCatalogEntries(proposed);
            state.routines = proposed;
            state.activeRoutineId = proposed[0].id;
            state.manageRoutineId = proposed[0].id;
            state.drafts = {};
            T.closeRestTimer();
            T.resetSessionTimer();
            state.activeSession.routineId = null;
            recoveryBannerDismissed = true;
            persist();
            renderRecoveryBanner();
            renderDataView();
            showToast(`Nuove schede ${chosenGoal} attivate!`, "success");
          }
        }
      ]
    });
  }

  function updateGoalDescriptionUI(goal) {
    const box = document.getElementById("goalDescriptionText");
    if (box) box.textContent = GOAL_DESCRIPTIONS[goal] || GOAL_DESCRIPTIONS.Misto;
  }

  function markBackupDone() {
    if (!state || !state.prefs) return;
    state.prefs.lastBackupAt = Date.now();
    state.prefs.lastBackupReminderAt = 0;
    persist();
    renderBackupStatus();
  }

  function renderBackupStatus() {
    const el = document.getElementById("backupStatusLine");
    if (!el) return;
    const last = Number(state.prefs.lastBackupAt) || 0;
    if (!last) {
      el.textContent = state.history.length
        ? "⚠️ Nessun backup ancora eseguito: esporta ora una copia dei dati."
        : "Nessun backup ancora eseguito.";
      el.classList.toggle("is-stale", state.history.length > 0);
      return;
    }

    const days = Math.max(0, Math.floor((Date.now() - last) / 86400000));
    const dateTxt = new Date(last).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
    el.textContent = days === 0
      ? `✅ Ultimo backup: oggi (${dateTxt}).`
      : `Ultimo backup: ${dateTxt} (${days} ${days === 1 ? "giorno" : "giorni"} fa).`;
    el.classList.toggle("is-stale", days >= 14);
    if (days >= 14) el.textContent += " Consigliato un nuovo export.";
  }

  async function renderStorageHealth() {
    const el = document.getElementById("storageHealthLine");
    const btn = document.getElementById("btnPersistStorage");
    if (!el) return;

    el.textContent = "Verifica spazio locale…";
    const lines = [];
    let persisted = null;

    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      try {
        const est = await navigator.storage.estimate();
        const usage = Number(est.usage) || 0;
        const quota = Number(est.quota) || 0;
        if (quota > 0) {
          const pct = Math.min(100, (usage / quota) * 100);
          lines.push(`Spazio usato: ${formatBytes(usage)} su ${formatBytes(quota)} (${pct < 0.1 ? "<0,1" : formatDec(pct)}%).`);
          if (pct >= 80) lines.push("⚠️ Spazio quasi esaurito: esporta un backup e libera dati.");
        } else {
          lines.push(`Spazio usato: ${formatBytes(usage)}.`);
        }
      } catch (err) {
        console.error("Stima dello spazio non disponibile:", err);
        lines.push("Stima dello spazio non disponibile.");
      }
    } else {
      lines.push("Stima dello spazio non supportata da questo browser.");
    }

    if (navigator.storage && typeof navigator.storage.persisted === "function") {
      try {
        persisted = await navigator.storage.persisted();
      } catch (err) {
        console.error("Verifica archiviazione persistente fallita:", err);
        persisted = null;
      }
      if (persisted === true) {
        lines.push("✅ Archiviazione persistente attiva: il browser non dovrebbe cancellare i dati automaticamente.");
      } else if (persisted === false) {
        lines.push("⚠️ Archiviazione non persistente: il browser può cancellare i dati se lo spazio scarseggia.");
      }
    } else {
      lines.push("Archiviazione persistente non supportata da questo browser.");
    }

    el.innerHTML = lines.map(line => `<div>${esc(line)}</div>`).join("");
    if (btn) {
      btn.disabled = persisted === true;
      btn.textContent = persisted === true
        ? "Archiviazione già protetta"
        : "Proteggi i dati dallo svuotamento automatico";
    }
  }

  async function requestPersistentStorage() {
    if (!navigator.storage || typeof navigator.storage.persist !== "function") {
      showToast("Archiviazione persistente non supportata", "danger");
      return;
    }
    try {
      const granted = await navigator.storage.persist();
      showToast(
        granted ? "Archiviazione persistente attivata!" : "Il browser non ha concesso l'archiviazione persistente",
        granted ? "success" : "danger"
      );
    } catch (err) {
      console.error("Richiesta archiviazione persistente fallita:", err);
      showToast("Richiesta non riuscita", "danger");
    }
    renderStorageHealth();
  }

  function maybeRemindBackup() {
    if (!state || !state.history.length) return;
    const now = Date.now();
    const dayMs = 86400000;
    const lastBackupAt = Number(state.prefs.lastBackupAt) || 0;
    const lastReminderAt = Number(state.prefs.lastBackupReminderAt) || 0;
    const backupAgeMs = lastBackupAt ? now - lastBackupAt : Infinity;

    if (backupAgeMs < 14 * dayMs) return;
    if (lastReminderAt && now - lastReminderAt < 3 * dayMs) return;

    state.prefs.lastBackupReminderAt = now;
    persist();
    showToast(
      lastBackupAt
        ? "Backup consigliato: l'ultimo export ha più di 14 giorni"
        : "Backup consigliato: non hai ancora esportato i dati",
      "danger"
    );
  }

  function renderCorruptionBanner() {
    const el = document.getElementById("corruptionBanner");
    if (!el) return;
    const info = S.getLastLoadError ? S.getLastLoadError() : null;
    if (!info) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }

    const recoveryNote = info.recoveredFromV2
      ? "I dati sono stati recuperati dal backup automatico v2."
      : "L'app è ripartita con le schede originali.";
    const copyNote = info.recoveryKey
      ? "Una copia del dato danneggiato è stata conservata: scaricala prima di continuare."
      : "Non è stato possibile conservare una copia: esporta subito un backup dei nuovi dati.";

    el.style.display = "block";
    el.innerHTML = `
      <div class="recovery-banner corruption-banner" role="alert">
        <div class="recovery-info">
          <div class="recovery-title">⚠️ Salvataggio locale danneggiato</div>
          <div class="recovery-sub">${esc(recoveryNote)} ${esc(copyNote)}</div>
        </div>
        <div class="recovery-actions">
          ${info.recoveryKey ? `<button type="button" class="btn btn-primary btn-sm" id="btnDownloadRecovery">Scarica copia</button>` : ""}
          <button type="button" class="btn btn-secondary btn-sm" id="btnDismissCorruption">Chiudi</button>
        </div>
      </div>
    `;

    const downloadBtn = document.getElementById("btnDownloadRecovery");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        const raw = S.getRecoveryData(info.recoveryKey);
        if (!raw) {
          showToast("Copia di recovery non più disponibile", "danger");
          return;
        }
        try {
          const blob = new Blob([raw], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `gymtracker-abc-recovery-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          showToast("Copia di recovery scaricata", "success");
        } catch (err) {
          console.error("Download della copia di recovery fallito:", err);
          showToast("Download non riuscito", "danger");
        }
      });
    }

    const dismissBtn = document.getElementById("btnDismissCorruption");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", () => {
        el.style.display = "none";
      });
    }
  }

  function renderDataView() {
    const totalSets = state.history.reduce((acc, s) => acc + (s.totalSets || 0), 0);
    document.getElementById("dataStatsGrid").innerHTML = `
      <div class="kpi-card">
        <div class="kpi-value">${state.routines.length}</div>
        <div class="kpi-label">Schede</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value green">${state.history.length}</div>
        <div class="kpi-label">Sedute salvate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value pr">${totalSets}</div>
        <div class="kpi-label">Serie totali</div>
      </div>
    `;
    document.getElementById("prefAutoRest").checked = Boolean(state.prefs.autoRest);
    document.getElementById("prefSound").checked = Boolean(state.prefs.sound);
    document.getElementById("prefNotifications").checked = Boolean(state.prefs.notifications);
    document.getElementById("prefWakeLock").checked = Boolean(state.prefs.wakeLock);
    const rirAdvEl = document.getElementById("prefUseRirInAdvice");
    if (rirAdvEl) rirAdvEl.checked = state.prefs.useRirInAdvice !== false;
    const autoApplyEl = document.getElementById("prefAutoApplyAdvice");
    if (autoApplyEl) autoApplyEl.checked = Boolean(state.prefs.autoApplyAdvice);
    const autoLockEl = document.getElementById("prefAutoLockCompleted");
    if (autoLockEl) autoLockEl.checked = Boolean(state.prefs.autoLockCompleted);
    const stepSel = document.getElementById("prefWeightStep");
    if (stepSel) stepSel.value = String(state.prefs.weightStep || 2.5);
    const goalSel = document.getElementById("prefTrainingGoal");
    const currGoal = state.prefs.trainingGoal || "Misto";
    if (goalSel) goalSel.value = currGoal;
    updateGoalDescriptionUI(currGoal);
    const buildEl = document.getElementById("appBuildLabel");
    if (buildEl) buildEl.textContent = `Build ${APP_BUILD} · schema v${S.SCHEMA_VERSION}`;
    renderBackupStatus();
    renderStorageHealth();
  }

  function exportHistoryCsv() {
    if (!state.history.length) {
      showToast("Lo storico sedute è vuoto", "danger");
      return;
    }
    const csvCell = val => {
      const str = String(val == null ? "" : val).replace(/"/g, '""');
      return `"${str}"`;
    };
    const rows = ["Data;Scheda;Durata (min);Esercizio;Gruppo;Serie;Warmup;Carico (kg);Ripetizioni;RIR;1RM Stimato (kg)"];
    getSortedHistoryDesc().forEach(sess => {
      const d = formatDateIT(sess.dateISO);
      const durMin = Math.round((sess.durationSec || 0) / 60);
      (sess.exercises || []).forEach(ex => {
        (ex.sets || []).forEach((s, idx) => {
          const orm = s.warmup ? 0 : (s.orm != null ? S.parseNum(s.orm) : S.calcEpley1RM(s.weight, s.reps));
          rows.push([
            csvCell(d),
            csvCell(sess.routineName),
            csvCell(durMin),
            csvCell(ex.name),
            csvCell(ex.muscleGroup || ""),
            csvCell(idx + 1),
            csvCell(s.warmup ? "Si" : "No"),
            csvCell(formatDec(s.weight)),
            csvCell(s.reps),
            csvCell(s.rir || "-"),
            csvCell(orm > 0 ? formatDec(orm) : "")
          ].join(";"));
        });
      });
    });

    try {
      const blob = new Blob(["\uFEFF" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gymtracker-abc-storico-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Storico CSV esportato!", "success");
    } catch (err) {
      console.error("Export storico CSV fallito:", err);
      showToast("Export CSV non riuscito", "danger");
    }
  }

  function exportBackupFile() {
    try {
      const jsonStr = S.buildExportJsonString(state);
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gymtracker-abc-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      markBackupDone();
      showToast("File backup JSON scaricato!", "success");
    } catch {
      showToast("Download non riuscito: usa 'Copia JSON negli appunti'", "danger");
    }
  }

  async function copyJsonToClipboard() {
    const jsonStr = S.buildExportJsonString(state);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(jsonStr);
        markBackupDone();
        showToast("Backup JSON copiato negli appunti!", "success");
        return;
      }
    } catch { /* fallback */ }

    try {
      const ta = document.createElement("textarea");
      ta.value = jsonStr;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) {
        markBackupDone();
        showToast("Backup JSON copiato negli appunti!", "success");
      } else {
        showToast("Copia non riuscita", "danger");
      }
    } catch {
      showToast("Errore nella copia del JSON", "danger");
    }
  }

  function processImportedJsonText(rawText) {
    try {
      const migrated = S.parseAndMigrateBackup(rawText);
      openModal({
        title: "Conferma Importazione",
        bodyHtml: `
          <p style="margin:0; color:var(--text-muted); font-size:0.9rem;">
            Trovate <strong>${migrated.routines.length} schede</strong>, <strong>${migrated.catalog.length} esercizi in catalogo</strong> e <strong>${migrated.history.length} sedute storiche</strong>.
            Confermando sostituirai i dati attualmente salvati su questo dispositivo.
          </p>
        `,
        buttons: [
          { label: "Annulla", className: "btn-secondary" },
          {
            label: "Importa Ora",
            className: "btn-primary",
            onClick: () => {
              state = migrated;
              ensureValidRoutineIds();
              persist();
              document.getElementById("pasteJsonInput").value = "";
              renderRecoveryBanner();
              renderCurrentTab();
              syncScreenWakeLock();
              showToast("Backup importato con successo!", "success");
            }
          }
        ]
      });
    } catch {
      showToast("Formato JSON non valido per GymTracker ABC", "danger");
    }
  }

  /* ========================================================================
     NAVIGAZIONE & COLLEGAMENTO EVENTI GLOBALI
     ======================================================================== */
  function syncScreenWakeLock() {
    const shouldHold = Boolean(state && state.prefs.wakeLock) && currentTab === "train" && document.visibilityState === "visible";
    T.syncWakeLock(shouldHold);
  }

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll(".view-section").forEach(sec => {
      sec.classList.toggle("active", sec.id === `view-${tab}`);
    });
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    renderCurrentTab();
    syncScreenWakeLock();
    global.scrollTo({ top: 0, behavior: "auto" });
  }

  function renderCurrentTab() {
    if (currentTab === "train") renderTrainView();
    else if (currentTab === "manage") renderManageView();
    else if (currentTab === "progress") renderProgressView();
    else if (currentTab === "data") renderDataView();
  }

  function bindGlobalEvents() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.getElementById("modalCloseBtn").addEventListener("click", closeModal);
    document.getElementById("modalBackdrop").addEventListener("click", e => {
      if (e.target.id === "modalBackdrop") closeModal();
    });

    document.getElementById("restMinus15").addEventListener("click", () => T.adjustRestTimer(-15));
    document.getElementById("restPlus15").addEventListener("click", () => {
      clearRestAutoCloseTimer();
      T.adjustRestTimer(15);
    });
    const restPlus30Btn = document.getElementById("restPlus30");
    if (restPlus30Btn) {
      restPlus30Btn.addEventListener("click", () => {
        clearRestAutoCloseTimer();
        T.adjustRestTimer(30);
      });
    }
    document.getElementById("restStopAlarmBtn").addEventListener("click", () => {
      T.stopAlarm();
      updateTimersUI();
      showRestCompletedToast();
    });
    const restFinishBtn = document.getElementById("restFinishBtn");
    if (restFinishBtn) {
      restFinishBtn.addEventListener("click", () => {
        T.finishRestManually();
        updateTimersUI();
        showRestCompletedToast();
      });
    }
    document.getElementById("restCloseBtn").addEventListener("click", () => {
      clearRestAutoCloseTimer();
      T.closeRestTimer();
      updateTimersUI();
    });

    document.getElementById("btnSaveWorkout").addEventListener("click", handleSaveWorkout);
    document.getElementById("btnResetDraft").addEventListener("click", handleResetDraft);

    // Tab Gestisci
    document.getElementById("manageRoutineSelect").addEventListener("change", e => {
      state.manageRoutineId = e.target.value;
      persist();
      renderManageView();
    });

    document.getElementById("btnNewRoutine").addEventListener("click", () => openRoutineModal(null));
    document.getElementById("btnRenameRoutine").addEventListener("click", () => {
      const r = state.routines.find(x => x.id === state.manageRoutineId);
      if (r) openRoutineModal(r);
    });

    document.getElementById("btnDuplicateRoutine").addEventListener("click", () => {
      const r = state.routines.find(x => x.id === state.manageRoutineId);
      if (!r) return;
      const gidMap = new Map();
      const dupExercises = r.exercises.map(ex => {
        let nextGid = null;
        if (ex.supersetGroupId) {
          if (!gidMap.has(ex.supersetGroupId)) gidMap.set(ex.supersetGroupId, S.uid("ss"));
          nextGid = gidMap.get(ex.supersetGroupId);
        }
        return Object.assign({}, ex, { id: S.uid("ex"), supersetGroupId: nextGid });
      });
      const dup = {
        id: S.uid("routine"),
        name: `${r.name} (Copia)`,
        subtitle: r.subtitle,
        stimulus: r.stimulus || "Misto",
        exercises: dupExercises
      };
      state.routines.push(dup);
      state.manageRoutineId = dup.id;
      persist();
      renderManageView();
      showToast("Scheda duplicata!", "success");
    });

    document.getElementById("btnDeleteRoutine").addEventListener("click", () => {
      if (state.routines.length <= 1) {
        showToast("Devi mantenere almeno una scheda", "danger");
        return;
      }
      const r = state.routines.find(x => x.id === state.manageRoutineId);
      if (!r) return;
      openModal({
        title: "Elimina Scheda",
        bodyHtml: `<p style="margin:0; color:var(--text-muted);">Eliminare <strong>${esc(r.name)}</strong>? Le sedute già salvate nello storico rimarranno intatte.</p>`,
        buttons: [
          { label: "Annulla", className: "btn-secondary" },
          {
            label: "Elimina",
            className: "btn-danger",
            onClick: () => {
              state.routines = state.routines.filter(x => x.id !== r.id);
              delete state.drafts[r.id];
              ensureValidRoutineIds();
              persist();
              renderManageView();
              showToast("Scheda eliminata");
            }
          }
        ]
      });
    });

    document.getElementById("btnAddExercise").addEventListener("click", () => {
      const r = state.routines.find(x => x.id === state.manageRoutineId);
      if (r) openExerciseModal(r, null);
    });

    const catBtn = document.getElementById("btnManageCatalog");
    if (catBtn) catBtn.addEventListener("click", openCatalogManagerModal);

    // Tab Progressioni
    document.getElementById("progressExerciseSelect").addEventListener("change", e => {
      selectedProgressKey = e.target.value;
      renderProgressExerciseAnalysis();
    });

    document.querySelectorAll(".metric-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedProgressMetric = btn.dataset.metric;
        renderProgressView();
      });
    });

    // Tab Dati
    document.getElementById("prefAutoRest").addEventListener("change", e => {
      state.prefs.autoRest = e.target.checked;
      persist();
    });

    document.getElementById("prefSound").addEventListener("change", e => {
      state.prefs.sound = e.target.checked;
      persist();
      if (e.target.checked) T.playBeepPattern();
    });

    document.getElementById("prefNotifications").addEventListener("change", async e => {
      if (e.target.checked) {
        const ln = await T.ensureNativeNotificationReady();
        let allowed = Boolean(ln);
        if (!ln && "Notification" in global) {
          if (Notification.permission === "granted") {
            allowed = true;
          } else if (Notification.permission === "default") {
            try {
              const res = await Notification.requestPermission();
              allowed = res === "granted";
            } catch {
              allowed = false;
            }
          }
        }
        if (!allowed) {
          e.target.checked = false;
          state.prefs.notifications = false;
          persist();
          showToast("Permesso notifiche non concesso dal sistema", "danger");
          return;
        }
        state.prefs.notifications = true;
        persist();
      } else {
        state.prefs.notifications = false;
        persist();
        T.cancelRestNotification();
      }
    });

    document.getElementById("prefWakeLock").addEventListener("change", e => {
      state.prefs.wakeLock = e.target.checked;
      persist();
      syncScreenWakeLock();
    });

    const rirAdvToggle = document.getElementById("prefUseRirInAdvice");
    if (rirAdvToggle) {
      rirAdvToggle.addEventListener("change", e => {
        state.prefs.useRirInAdvice = e.target.checked;
        persist();
      });
    }

    const autoApplyToggle = document.getElementById("prefAutoApplyAdvice");
    if (autoApplyToggle) {
      autoApplyToggle.addEventListener("change", e => {
        state.prefs.autoApplyAdvice = e.target.checked;
        persist();
      });
    }

    const autoLockToggle = document.getElementById("prefAutoLockCompleted");
    if (autoLockToggle) {
      autoLockToggle.addEventListener("change", e => {
        state.prefs.autoLockCompleted = e.target.checked;
        persist();
      });
    }

    const stepSel = document.getElementById("prefWeightStep");
    if (stepSel) {
      stepSel.addEventListener("change", e => {
        state.prefs.weightStep = S.normalizeWeightStep(e.target.value);
        persist();
      });
    }

    const goalSel = document.getElementById("prefTrainingGoal");
    if (goalSel) {
      goalSel.addEventListener("change", e => {
        state.prefs.trainingGoal = e.target.value;
        persist();
        updateGoalDescriptionUI(state.prefs.trainingGoal);
      });
    }

    const proposeBtn = document.getElementById("btnProposeGoalRoutines");
    if (proposeBtn) {
      proposeBtn.addEventListener("click", () => {
        openGoalProposalModal(state.prefs.trainingGoal || "Misto");
      });
    }

    document.getElementById("btnExportJson").addEventListener("click", exportBackupFile);
    const exportCsvBtn = document.getElementById("btnExportCsv");
    if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportHistoryCsv);
    document.getElementById("btnCopyJson").addEventListener("click", copyJsonToClipboard);

    const persistBtn = document.getElementById("btnPersistStorage");
    if (persistBtn) persistBtn.addEventListener("click", requestPersistentStorage);

    document.getElementById("btnImportJsonFile").addEventListener("click", () => {
      const inp = document.getElementById("importFileInput");
      inp.value = "";
      inp.click();
    });

    document.getElementById("importFileInput").addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => processImportedJsonText(ev.target.result);
      reader.readAsText(file);
    });

    document.getElementById("btnImportJsonText").addEventListener("click", () => {
      const txt = document.getElementById("pasteJsonInput").value.trim();
      if (!txt) {
        showToast("Incolla prima il testo JSON nel riquadro", "danger");
        return;
      }
      processImportedJsonText(txt);
    });

    document.getElementById("btnRestoreDefaults").addEventListener("click", () => {
      openModal({
        title: "Ripristina Schede Originali",
        bodyHtml: `
          <p style="margin-top:0; color:var(--text-muted); font-size:0.9rem;">
            Vuoi ripristinare le <strong>3 schede A-B-C originali</strong>? Eventuali schede personalizzate verranno sostituite.
          </p>
          <p style="margin-bottom:0; color:#86efac; font-size:0.86rem;">
            ✓ Il tuo storico degli allenamenti salvati NON verrà cancellato.
          </p>
        `,
        buttons: [
          { label: "Annulla", className: "btn-secondary" },
          {
            label: "Ripristina A-B-C",
            className: "btn-danger",
            onClick: () => {
              state.routines = S.getDefaultRoutines();
              state.activeRoutineId = state.routines[0].id;
              state.manageRoutineId = state.routines[0].id;
              state.drafts = {};
              T.closeRestTimer();
              T.resetSessionTimer();
              state.activeSession.routineId = null;
              recoveryBannerDismissed = true;
              persist();
              renderRecoveryBanner();
              renderDataView();
              showToast("Schede A-B-C originali ripristinate!", "success");
            }
          }
        ]
      });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        T.tick();
        syncScreenWakeLock();
      }
    });
  }

  /* ========================================================================
     AVVIO APPLICAZIONE
     ======================================================================== */
  global.addEventListener("DOMContentLoaded", () => {
    state = S.loadState();

    // Se c'è una sessione attiva salvata, imposta automaticamente quella scheda come attiva
    const rec = detectRecoverableSession();
    if (rec && rec.routine) {
      state.activeRoutineId = rec.routine.id;
    }

    T.init({
      getState: () => state,
      saveState: () => persist(),
      onTick: updateTimersUI
    });

    bindGlobalEvents();
    renderCorruptionBanner();
    renderRecoveryBanner();
    renderTrainView();
    syncScreenWakeLock();

    if (navigator.storage && typeof navigator.storage.persist === "function") {
      navigator.storage.persist().catch(() => {});
    }
    setTimeout(maybeRemindBackup, 1600);

    if (T.getCapacitorLocalNotifications()) {
      const pill = document.getElementById("headerStatusPill");
      if (pill) pill.textContent = "App Android";
    }

    const isNativeCapacitor = Boolean(
      T.getCapacitorLocalNotifications() ||
      (global.Capacitor && typeof global.Capacitor.isNativePlatform === "function" && global.Capacitor.isNativePlatform())
    );
    if (!isNativeCapacitor && "serviceWorker" in navigator && (location.protocol === "https:" || location.protocol === "http:")) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (global.__gymSwReloading) return;
          global.__gymSwReloading = true;
          location.reload();
        });
      }
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
        .then(reg => reg.update().catch(() => {}))
        .catch(() => {});
    }
  });

  global.GymApp = {
    getState: () => state,
    groupRoutineExercises,
    computeStimulusPreset,
    computeProgressionAdvice,
    detectDeloadNeed
  };
})(window);
