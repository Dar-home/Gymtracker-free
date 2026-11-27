/* ==========================================================================
   GYMTRACKER ABC — LAYER PERSISTENZA, CATALOGO E MIGRAZIONE SCHEMA V3
   ========================================================================== */
(function (global) {
  "use strict";

  const STORAGE_KEY_V3 = "gymtracker_abc_v3";
  const LEGACY_STORAGE_KEY_V2 = "gymtracker_abc_v2";
  const RECOVERY_KEY_PREFIX = "gymtracker_abc_corrupt_";
  const MAX_RECOVERY_COPIES = 3;
  const CATALOG_IMPORT_MAX = 2000;
  const SCHEMA_VERSION = 3;
  let lastLoadError = null;
  const RIR_OPTIONS = ["-", "0", "1", "2", "3+"];
  const MUSCLE_GROUPS = [
    "Quadricipiti",
    "Femorali/Glutei",
    "Petto",
    "Schiena",
    "Spalle",
    "Bicipiti",
    "Tricipiti",
    "Polpacci",
    "Core",
    "Altro"
  ];

  function uid(prefix) {
    const p = prefix || "id";
    return p + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function parseNum(val) {
    if (val === "" || val === null || val === undefined) return 0;
    const n = parseFloat(String(val).replace(",", ".").trim());
    return isNaN(n) || n < 0 ? 0 : n;
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function calcEpley1RM(weight, reps) {
    const w = parseNum(weight);
    const r = Math.round(parseNum(reps));
    if (w <= 0 || r <= 0) return 0;
    if (r === 1) return Math.round(w * 10) / 10;
    return Math.round(w * (1 + r / 30) * 10) / 10;
  }

  function extractTargetRepsDefault(repsTarget) {
    const m = String(repsTarget || "").match(/\d+/);
    return m ? parseInt(m[0], 10) : 10;
  }

  function roundToGymStep(val, step) {
    const v = parseNum(val);
    if (v <= 0) return 0;
    const s = step || (v < 20 ? 1.25 : 2.5);
    return Math.round(Math.round(v / s) * s * 100) / 100;
  }

  function inferMuscleGroup(name, focus) {
    const n = normalizeName(name);
    if (n.includes("leg press") || n.includes("leg extension") || n.includes("squat") || n.includes("affond")) {
      return "Quadricipiti";
    }
    if (n.includes("leg curl") || n.includes("stacco") || n.includes("hip thrust") || n.includes("rdl") || n.includes("glute")) {
      return "Femorali/Glutei";
    }
    if (n.includes("calf") || n.includes("polpacc")) {
      return "Polpacci";
    }
    if (n.includes("chest") || n.includes("panca") || n.includes("pectoral") || n.includes("butterfly") || n.includes("pec deck") || n.includes("croci")) {
      return "Petto";
    }
    if (n.includes("lat") || n.includes("row") || n.includes("rematore") || n.includes("pulley") || n.includes("trazioni") || n.includes("upper back")) {
      return "Schiena";
    }
    if (n.includes("shoulder") || n.includes("alzate") || n.includes("military") || n.includes("lento") || n.includes("spalle")) {
      return "Spalle";
    }
    if (n.includes("curl") || n.includes("bicip")) {
      return "Bicipiti";
    }
    if (n.includes("pushdown") || n.includes("french") || n.includes("tricip")) {
      return "Tricipiti";
    }
    if (n.includes("crunch") || n.includes("plank") || n.includes("abdom") || n.includes("core") || String(focus || "").toLowerCase().includes("core")) {
      return "Core";
    }
    return "Altro";
  }

  function inferStimulus(focus) {
    const f = String(focus || "").toLowerCase();
    if (f.includes("forza")) return "Forza";
    if (f.includes("core")) return "Ipertrofia";
    return "Ipertrofia";
  }

  function isLegExercise(muscleGroup, name) {
    if (["Quadricipiti", "Femorali/Glutei", "Polpacci"].includes(muscleGroup)) return true;
    const n = normalizeName(name);
    return n.includes("leg") || n.includes("squat") || n.includes("affond") ||
      n.includes("calf") || n.includes("polpacc") || n.includes("pressa") ||
      n.includes("stacco") || n.includes("hip thrust") || n.includes("glute");
  }

  function isHeavyLegExercise(muscleGroup, name) {
    const n = normalizeName(name);
    return n.includes("leg press") || n.includes("pressa") || n.includes("squat") ||
      n.includes("stacco") || n.includes("hip thrust") || n.includes("rdl") ||
      n.includes("affond");
  }

  function getExerciseWeightStep(exOrMuscle, name) {
    if (exOrMuscle && typeof exOrMuscle === "object") {
      return isHeavyLegExercise(exOrMuscle.muscleGroup, exOrMuscle.name) ? 10 : 5;
    }
    return isHeavyLegExercise(exOrMuscle, name) ? 10 : 5;
  }

  function estimateRecommendedRestSec(ex, stimulus, isSuperset) {
    const mg = ex && ex.muscleGroup ? ex.muscleGroup : "";
    const name = ex && ex.name ? ex.name : "";
    const stim = stimulus || (ex && (ex.focus || ex.stimulus)) || "Ipertrofia";
    const isForza = stim === "Forza";
    const isCore = stim === "Core" || mg === "Core" || (ex && ex.focus === "Core");
    const n = normalizeName(name);

    let sec = 90;
    if (isCore || n.includes("crunch") || n.includes("plank") || n.includes("abdom")) {
      sec = 60;
    } else if (isHeavyLegExercise(mg, name)) {
      sec = isForza ? 180 : 135;
    } else if (mg === "Polpacci" || n.includes("calf") || n.includes("polpacc")) {
      sec = isForza ? 75 : 60;
    } else if (n.includes("leg curl") || n.includes("leg ext") || mg === "Quadricipiti" || mg === "Femorali/Glutei") {
      sec = isForza ? 120 : 90;
    } else if (
      mg === "Bicipiti" || mg === "Tricipiti" ||
      n.includes("alzate") || n.includes("butterfly") || n.includes("pec deck") || n.includes("croci") ||
      mg === "Altro"
    ) {
      sec = isForza ? 90 : 75;
    } else {
      // Multiarticolari parte alta (Petto, Schiena, Spalle compatte)
      sec = isForza ? 150 : 105;
    }

    if (isSuperset) {
      sec = Math.max(90, Math.min(180, sec + 15));
    }
    return sec;
  }

  function getDefaultCatalog() {
    return [
      { id: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", defaultRestSec: 180, defaultStimulus: "Forza", note: "" },
      { id: "cat_lat_machine", name: "Lat Machine (presa avanti)", muscleGroup: "Schiena", defaultRestSec: 150, defaultStimulus: "Forza", note: "Testa i 90 kg" },
      { id: "cat_chest_inc", name: "Chest Press Inclinata", muscleGroup: "Petto", defaultRestSec: 120, defaultStimulus: "Ipertrofia", note: "65–70 kg" },
      { id: "cat_upper_back", name: "Upper Back / Rematore gomiti aperti", muscleGroup: "Schiena", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_leg_curl", name: "Leg Curl", muscleGroup: "Femorali/Glutei", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_alzate_lat", name: "Alzate laterali (cavo o macchina)", muscleGroup: "Spalle", defaultRestSec: 75, defaultStimulus: "Ipertrofia", note: "8–10 kg per lato" },
      { id: "cat_curl_macc", name: "Curl bicipiti (macchina o cavo)", muscleGroup: "Bicipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_pushdown_barra", name: "Pushdown tricipiti al cavo (barra)", muscleGroup: "Tricipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_crunch", name: "Crunch al cavo / Abdominal Machine", muscleGroup: "Core", defaultRestSec: 60, defaultStimulus: "Ipertrofia", note: "Da calibrare" },
      { id: "cat_chest_orizz", name: "Chest Press Orizzontale", muscleGroup: "Petto", defaultRestSec: 180, defaultStimulus: "Forza", note: "" },
      { id: "cat_low_row", name: "Low Row (gomiti vicini al busto)", muscleGroup: "Schiena", defaultRestSec: 150, defaultStimulus: "Forza", note: "" },
      { id: "cat_shoulder_press", name: "Shoulder Press (macchina)", muscleGroup: "Spalle", defaultRestSec: 150, defaultStimulus: "Forza", note: "" },
      { id: "cat_affondi", name: "Affondi sul posto al Multipower (o manubri)", muscleGroup: "Quadricipiti", defaultRestSec: 120, defaultStimulus: "Ipertrofia", note: "Da calibrare" },
      { id: "cat_leg_ext", name: "Leg Extension", muscleGroup: "Quadricipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_curl_manubri", name: "Curl manubri (o cavo basso)", muscleGroup: "Bicipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_french_press", name: "French Press / Estensioni sopra testa al cavo", muscleGroup: "Tricipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_calf", name: "Calf alla Leg Press (polpacci)", muscleGroup: "Polpacci", defaultRestSec: 60, defaultStimulus: "Ipertrofia", note: "Da calibrare" },
      { id: "cat_pulley", name: "Pulley Basso", muscleGroup: "Schiena", defaultRestSec: 120, defaultStimulus: "Forza", note: "60–65 kg" },
      { id: "cat_high_row", name: "High Row (o Lat Machine)", muscleGroup: "Schiena", defaultRestSec: 105, defaultStimulus: "Ipertrofia", note: "Da calibrare" },
      { id: "cat_butterfly", name: "Butterfly / Pec Deck", muscleGroup: "Petto", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "Da calibrare" },
      { id: "cat_curl_martello", name: "Curl a martello al cavo (corda)", muscleGroup: "Bicipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "" },
      { id: "cat_pushdown_corda", name: "Pushdown tricipiti con corda", muscleGroup: "Tricipiti", defaultRestSec: 90, defaultStimulus: "Ipertrofia", note: "20–22.5 kg" }
    ];
  }

  function normalizeHeaderKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function stripCsvFormulaGuard(value) {
    const s = String(value == null ? "" : value).trim();
    return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
  }

  function pickFirst(obj, keys) {
    if (!obj || typeof obj !== "object") return "";
    for (const key of keys) {
      if (obj[key] != null && obj[key] !== "") return obj[key];
    }
    return "";
  }

  function detectCsvDelimiter(text) {
    const line = String(text || "").split(/\r?\n/).find(l => l.trim() !== "") || "";
    let semis = 0;
    let commas = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && ch === ";") {
        semis++;
      } else if (!inQuotes && ch === ",") {
        commas++;
      }
    }
    return semis >= commas ? ";" : ",";
  }

  function parseCsvRows(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch !== "\r") {
        field += ch;
      }
    }

    if (field !== "" || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter(r => r.some(c => String(c).trim() !== ""));
  }

  function normalizeCatalogImportItem(raw) {
    const name = stripCsvFormulaGuard(raw && raw.name).slice(0, 80);
    if (!name) return null;

    const muscleRaw = stripCsvFormulaGuard(raw.muscleGroup);
    const muscleGroup = MUSCLE_GROUPS.includes(muscleRaw) ? muscleRaw : inferMuscleGroup(name, "");
    const stimRaw = stripCsvFormulaGuard(raw.defaultStimulus);
    const defaultStimulus = muscleGroup === "Core"
      ? "Ipertrofia"
      : (/forza/i.test(stimRaw) ? "Forza" : "Ipertrofia");
    const restNum = parseInt(parseNum(raw.defaultRestSec), 10);
    const defaultRestSec = Math.min(600, Math.max(10, restNum || 90));

    return {
      name,
      muscleGroup,
      defaultStimulus,
      defaultRestSec,
      note: stripCsvFormulaGuard(raw.note).slice(0, 200)
    };
  }

  /**
   * Importa esercizi da CSV (separatore ; o ,) o JSON.
   * Accetta un array, {catalog:[...]} oppure un backup completo {data:{catalog:[...]}}.
   */
  function parseCatalogText(rawText) {
    const text = String(rawText == null ? "" : rawText).replace(/^\uFEFF/, "").trim();
    if (!text) return { items: [], skipped: 0, errors: ["File vuoto"] };

    const errors = [];
    const items = [];
    let skipped = 0;
    const seen = new Set();

    function addItem(raw, rowLabel) {
      if (items.length >= CATALOG_IMPORT_MAX) {
        skipped++;
        return;
      }
      const item = normalizeCatalogImportItem(raw);
      if (!item) {
        skipped++;
        if (errors.length < 20) errors.push(`${rowLabel}: nome mancante`);
        return;
      }
      const key = normalizeName(item.name);
      if (seen.has(key)) {
        skipped++;
        if (errors.length < 20) errors.push(`${rowLabel}: duplicato "${item.name}"`);
        return;
      }
      seen.add(key);
      items.push(item);
    }

    if (text[0] === "{" || text[0] === "[") {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return { items: [], skipped: 0, errors: ["JSON non valido: " + err.message] };
      }

      const list = Array.isArray(parsed) ? parsed
        : Array.isArray(parsed.catalog) ? parsed.catalog
        : parsed.data && Array.isArray(parsed.data.catalog) ? parsed.data.catalog
        : Array.isArray(parsed.exercises) ? parsed.exercises
        : parsed.data && Array.isArray(parsed.data.exercises) ? parsed.data.exercises
        : null;

      if (!list) {
        return { items: [], skipped: 0, errors: ["JSON senza elenco esercizi (catalog/exercises)"] };
      }

      list.forEach((raw, idx) => {
        addItem({
          name: pickFirst(raw, ["name", "nome", "exercise", "esercizio"]),
          muscleGroup: pickFirst(raw, ["muscleGroup", "muscle", "gruppo", "gruppoMuscolare"]),
          defaultStimulus: pickFirst(raw, ["defaultStimulus", "stimulus", "stimolo", "focus"]),
          defaultRestSec: pickFirst(raw, ["defaultRestSec", "restSec", "rest", "recupero"]),
          note: pickFirst(raw, ["note", "nota", "notes"])
        }, `Riga ${idx + 1}`);
      });
      return { items, skipped, errors };
    }

    const delimiter = detectCsvDelimiter(text);
    const rows = parseCsvRows(text, delimiter);
    if (!rows.length) return { items: [], skipped: 0, errors: ["Nessuna riga valida"] };

    const aliases = {
      name: ["nome", "name", "esercizio", "exercise", "esercizionome", "exercisename"],
      muscle: ["gruppo", "gruppomuscolare", "muscle", "musclegroup", "distretto", "categoria"],
      stimulus: ["stimolo", "stimulus", "focus", "tipo", "obiettivo"],
      rest: ["recupero", "recuperos", "rest", "restsec", "recuperosecondi", "secondi", "restseconds", "riposo"],
      note: ["note", "nota", "notes", "commento", "annotazioni"]
    };

    const headerRow = rows[0].map(normalizeHeaderKey);
    const headerMap = {};
    let headerMatches = 0;
    Object.keys(aliases).forEach(key => {
      const idx = headerRow.findIndex(h => aliases[key].includes(h));
      if (idx !== -1) {
        headerMap[key] = idx;
        headerMatches++;
      }
    });

    const isHeader = headerMatches >= 2 || headerMap.name != null;
    const startIdx = isHeader ? 1 : 0;
    if (!isHeader) {
      headerMap.name = 0;
      headerMap.muscle = 1;
      headerMap.stimulus = 2;
      headerMap.rest = 3;
      headerMap.note = 4;
    } else if (headerMap.name == null) {
      headerMap.name = 0;
    }

    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i];
      addItem({
        name: headerMap.name != null ? row[headerMap.name] : "",
        muscleGroup: headerMap.muscle != null ? row[headerMap.muscle] : "",
        defaultStimulus: headerMap.stimulus != null ? row[headerMap.stimulus] : "",
        defaultRestSec: headerMap.rest != null ? row[headerMap.rest] : "",
        note: headerMap.note != null ? row[headerMap.note] : ""
      }, `Riga ${i + 1}`);
    }

    return { items, skipped, errors };
  }

  function csvCell(value) {
    let s = String(value == null ? "" : value);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    if (/[;"\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCatalogCsv(catalog) {
    const rows = [["Nome", "Gruppo muscolare", "Stimolo", "Recupero (s)", "Note"]];
    (catalog || [])
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "it"))
      .forEach(c => {
        rows.push([
          c.name,
          c.muscleGroup,
          c.defaultStimulus || "Ipertrofia",
          c.defaultRestSec || 90,
          c.note || ""
        ]);
      });
    return "\uFEFF" + rows.map(r => r.map(csvCell).join(";")).join("\r\n") + "\r\n";
  }

  function getDefaultRoutines() {
    return [
      {
        id: "routine_a",
        name: "Lunedì — Giorno A",
        subtitle: "Forza: Gambe e Tirata | Volume: Petto, Alta schiena e Braccia",
        stimulus: "Misto",
        exercises: [
          { id: "ex_a1", catalogId: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 170, restSec: 180, supersetGroupId: null, note: "" },
          { id: "ex_a2", catalogId: "cat_lat_machine", name: "Lat Machine (presa avanti)", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–7", defaultWeight: 85, restSec: 150, supersetGroupId: null, note: "Testa i 90 kg" },
          { id: "ex_a3", catalogId: "cat_chest_inc", name: "Chest Press Inclinata", muscleGroup: "Petto", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–10", defaultWeight: 65, restSec: 120, supersetGroupId: null, note: "65–70 kg" },
          { id: "ex_a4", catalogId: "cat_upper_back", name: "Upper Back / Rematore gomiti aperti", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 65, restSec: 90, supersetGroupId: null, note: "" },
          { id: "ex_a5", catalogId: "cat_leg_curl", name: "Leg Curl", muscleGroup: "Femorali/Glutei", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–10", defaultWeight: 60, restSec: 90, supersetGroupId: null, note: "" },
          { id: "ex_a6", catalogId: "cat_alzate_lat", name: "Alzate laterali (cavo o macchina)", muscleGroup: "Spalle", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 9, restSec: 75, supersetGroupId: null, note: "8–10 kg per lato" },
          { id: "ex_a7", catalogId: "cat_curl_macc", name: "Curl bicipiti (macchina o cavo)", muscleGroup: "Bicipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–10", defaultWeight: 32, restSec: 90, supersetGroupId: "ss_a1", note: "" },
          { id: "ex_a8", catalogId: "cat_pushdown_barra", name: "Pushdown tricipiti al cavo (barra)", muscleGroup: "Tricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–10", defaultWeight: 22.5, restSec: 90, supersetGroupId: "ss_a1", note: "" },
          { id: "ex_a9", catalogId: "cat_crunch", name: "Crunch al cavo / Abdominal Machine", muscleGroup: "Core", focus: "Core", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 0, restSec: 60, supersetGroupId: null, note: "Da calibrare" }
        ]
      },
      {
        id: "routine_b",
        name: "Mercoledì — Giorno B",
        subtitle: "Forza: Petto, Low Row e Spalle | Volume: Affondi, Quadricipiti e Braccia",
        stimulus: "Misto",
        exercises: [
          { id: "ex_b1", catalogId: "cat_chest_orizz", name: "Chest Press Orizzontale", muscleGroup: "Petto", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 85, restSec: 180, supersetGroupId: null, note: "" },
          { id: "ex_b2", catalogId: "cat_low_row", name: "Low Row (gomiti vicini al busto)", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "6–8", defaultWeight: 70, restSec: 150, supersetGroupId: null, note: "" },
          { id: "ex_b3", catalogId: "cat_shoulder_press", name: "Shoulder Press (macchina)", muscleGroup: "Spalle", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–7", defaultWeight: 42, restSec: 150, supersetGroupId: null, note: "" },
          { id: "ex_b4", catalogId: "cat_affondi", name: "Affondi sul posto al Multipower (o manubri)", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–10/gamba", defaultWeight: 0, restSec: 120, supersetGroupId: null, note: "Da calibrare" },
          { id: "ex_b5", catalogId: "cat_leg_ext", name: "Leg Extension", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 65, restSec: 90, supersetGroupId: null, note: "" },
          { id: "ex_b6", catalogId: "cat_curl_manubri", name: "Curl manubri (o cavo basso)", muscleGroup: "Bicipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 14, restSec: 90, supersetGroupId: "ss_b1", note: "" },
          { id: "ex_b7", catalogId: "cat_french_press", name: "French Press / Estensioni sopra testa al cavo", muscleGroup: "Tricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 90, supersetGroupId: "ss_b1", note: "" },
          { id: "ex_b8", catalogId: "cat_calf", name: "Calf alla Leg Press (polpacci)", muscleGroup: "Polpacci", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 0, restSec: 60, supersetGroupId: null, note: "Da calibrare" }
        ]
      },
      {
        id: "routine_c",
        name: "Venerdì — Giorno C",
        subtitle: "Forza/Ipertrofia mista: Gambe, Petto, High Row e Braccia",
        stimulus: "Misto",
        exercises: [
          { id: "ex_c1", catalogId: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 4, repsTarget: "8–10", defaultWeight: 155, restSec: 150, supersetGroupId: null, note: "155–160 kg" },
          { id: "ex_c2", catalogId: "cat_chest_inc", name: "Chest Press Inclinata", muscleGroup: "Petto", focus: "Forza", stimulus: "Forza", sets: 3, repsTarget: "6–8", defaultWeight: 70, restSec: 120, supersetGroupId: null, note: "70–75 kg" },
          { id: "ex_c3", catalogId: "cat_pulley", name: "Pulley Basso", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 3, repsTarget: "6–8", defaultWeight: 60, restSec: 120, supersetGroupId: null, note: "60–65 kg" },
          { id: "ex_c4", catalogId: "cat_high_row", name: "High Row (o Lat Machine)", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–10", defaultWeight: 0, restSec: 105, supersetGroupId: null, note: "Da calibrare" },
          { id: "ex_c5", catalogId: "cat_butterfly", name: "Butterfly / Pec Deck", muscleGroup: "Petto", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 0, restSec: 90, supersetGroupId: null, note: "Da calibrare" },
          { id: "ex_c6", catalogId: "cat_leg_curl", name: "Leg Curl", muscleGroup: "Femorali/Glutei", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 55, restSec: 90, supersetGroupId: null, note: "55–60 kg" },
          { id: "ex_c7", catalogId: "cat_alzate_lat", name: "Alzate laterali (cavo o macchina)", muscleGroup: "Spalle", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 9, restSec: 60, supersetGroupId: null, note: "8–10 kg per lato" },
          { id: "ex_c8", catalogId: "cat_curl_martello", name: "Curl a martello al cavo (corda)", muscleGroup: "Bicipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 90, supersetGroupId: "ss_c1", note: "" },
          { id: "ex_c9", catalogId: "cat_pushdown_corda", name: "Pushdown tricipiti con corda", muscleGroup: "Tricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 90, supersetGroupId: "ss_c1", note: "20–22.5 kg" }
        ]
      }
    ];
  }

  function buildGoalRoutinesTemplate(goal) {
    if (goal === "Forza") {
      return [
        {
          id: uid("routine"),
          name: "Lunedì — Giorno A (Forza)",
          subtitle: "Focus Forza: Gambe, Tirata verticale e Petto inclinato (4–6 rip.)",
          stimulus: "Forza",
          exercises: [
            { id: uid("ex"), catalogId: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "4–6", defaultWeight: 180, restSec: 180, supersetGroupId: null, note: "Carico alto, fermo in buca controllato" },
            { id: uid("ex"), catalogId: "cat_lat_machine", name: "Lat Machine (presa avanti)", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "4–6", defaultWeight: 90, restSec: 165, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_chest_inc", name: "Chest Press Inclinata", muscleGroup: "Petto", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 72.5, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_leg_curl", name: "Leg Curl", muscleGroup: "Femorali/Glutei", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "6–8", defaultWeight: 65, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_crunch", name: "Crunch al cavo / Abdominal Machine", muscleGroup: "Core", focus: "Core", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 0, restSec: 60, supersetGroupId: null, note: "Stabilità core" }
          ]
        },
        {
          id: uid("routine"),
          name: "Mercoledì — Giorno B (Forza)",
          subtitle: "Focus Forza: Spinta orizzontale, Remata e Spalle (4–6 rip.)",
          stimulus: "Forza",
          exercises: [
            { id: uid("ex"), catalogId: "cat_chest_orizz", name: "Chest Press Orizzontale", muscleGroup: "Petto", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "4–6", defaultWeight: 90, restSec: 180, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_low_row", name: "Low Row (gomiti vicini al busto)", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 75, restSec: 165, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_shoulder_press", name: "Shoulder Press (macchina)", muscleGroup: "Spalle", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 45, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_affondi", name: "Affondi sul posto al Multipower (o manubri)", muscleGroup: "Quadricipiti", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "6–8/gamba", defaultWeight: 0, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_calf", name: "Calf alla Leg Press (polpacci)", muscleGroup: "Polpacci", focus: "Forza", stimulus: "Forza", sets: 3, repsTarget: "8–10", defaultWeight: 0, restSec: 90, supersetGroupId: null, note: "" }
          ]
        },
        {
          id: uid("routine"),
          name: "Venerdì — Giorno C (Forza)",
          subtitle: "Focus Forza: Gambe pesanti, Pulley e Braccia pesanti",
          stimulus: "Forza",
          exercises: [
            { id: uid("ex"), catalogId: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 175, restSec: 180, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_pulley", name: "Pulley Basso", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "5–6", defaultWeight: 65, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_chest_inc", name: "Chest Press Inclinata", muscleGroup: "Petto", focus: "Forza", stimulus: "Forza", sets: 4, repsTarget: "4–6", defaultWeight: 72.5, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_upper_back", name: "Upper Back / Rematore gomiti aperti", muscleGroup: "Schiena", focus: "Forza", stimulus: "Forza", sets: 3, repsTarget: "6–8", defaultWeight: 70, restSec: 150, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_curl_macc", name: "Curl bicipiti (macchina o cavo)", muscleGroup: "Bicipiti", focus: "Forza", stimulus: "Forza", sets: 3, repsTarget: "6–8", defaultWeight: 35, restSec: 120, supersetGroupId: null, note: "" }
          ]
        }
      ];
    }

    if (goal === "Ipertrofia") {
      const ssA = uid("ss");
      const ssB = uid("ss");
      const ssC = uid("ss");
      return [
        {
          id: uid("routine"),
          name: "Lunedì — Giorno A (Ipertrofia)",
          subtitle: "Volume & Pump: Gambe, Petto, Schiena e Superserie Braccia (8–15 rip.)",
          stimulus: "Ipertrofia",
          exercises: [
            { id: uid("ex"), catalogId: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 4, repsTarget: "10–12", defaultWeight: 150, restSec: 105, supersetGroupId: null, note: "Controllo eccentrico 3s" },
            { id: uid("ex"), catalogId: "cat_chest_inc", name: "Chest Press Inclinata", muscleGroup: "Petto", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–12", defaultWeight: 62.5, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_lat_machine", name: "Lat Machine (presa avanti)", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 75, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_upper_back", name: "Upper Back / Rematore gomiti aperti", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 60, restSec: 75, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_leg_curl", name: "Leg Curl", muscleGroup: "Femorali/Glutei", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 55, restSec: 75, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_alzate_lat", name: "Alzate laterali (cavo o macchina)", muscleGroup: "Spalle", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 4, repsTarget: "12–15", defaultWeight: 8, restSec: 60, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_curl_macc", name: "Curl bicipiti (macchina o cavo)", muscleGroup: "Bicipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 30, restSec: 75, supersetGroupId: ssA, note: "" },
            { id: uid("ex"), catalogId: "cat_pushdown_barra", name: "Pushdown tricipiti al cavo (barra)", muscleGroup: "Tricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 75, supersetGroupId: ssA, note: "" }
          ]
        },
        {
          id: uid("routine"),
          name: "Mercoledì — Giorno B (Ipertrofia)",
          subtitle: "Volume & Densità: Petto, Tirata, Quadricipiti e Braccia",
          stimulus: "Ipertrofia",
          exercises: [
            { id: uid("ex"), catalogId: "cat_chest_orizz", name: "Chest Press Orizzontale", muscleGroup: "Petto", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "8–12", defaultWeight: 75, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_low_row", name: "Low Row (gomiti vicini al busto)", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 62.5, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_shoulder_press", name: "Shoulder Press (macchina)", muscleGroup: "Spalle", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 37.5, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_affondi", name: "Affondi sul posto al Multipower (o manubri)", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12/gamba", defaultWeight: 0, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_leg_ext", name: "Leg Extension", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 60, restSec: 75, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_curl_manubri", name: "Curl manubri (o cavo basso)", muscleGroup: "Bicipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 14, restSec: 75, supersetGroupId: ssB, note: "" },
            { id: uid("ex"), catalogId: "cat_french_press", name: "French Press / Estensioni sopra testa al cavo", muscleGroup: "Tricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 75, supersetGroupId: ssB, note: "" },
            { id: uid("ex"), catalogId: "cat_calf", name: "Calf alla Leg Press (polpacci)", muscleGroup: "Polpacci", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 0, restSec: 60, supersetGroupId: null, note: "" }
          ]
        },
        {
          id: uid("routine"),
          name: "Venerdì — Giorno C (Ipertrofia)",
          subtitle: "Volume Completo: Isolamento Petto, Dorso, Femorali e Superserie",
          stimulus: "Ipertrofia",
          exercises: [
            { id: uid("ex"), catalogId: "cat_leg_press", name: "Leg Press", muscleGroup: "Quadricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 150, restSec: 105, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_butterfly", name: "Butterfly / Pec Deck", muscleGroup: "Petto", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 0, restSec: 75, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_pulley", name: "Pulley Basso", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 55, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_high_row", name: "High Row (o Lat Machine)", muscleGroup: "Schiena", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 0, restSec: 90, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_leg_curl", name: "Leg Curl", muscleGroup: "Femorali/Glutei", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 55, restSec: 75, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_alzate_lat", name: "Alzate laterali (cavo o macchina)", muscleGroup: "Spalle", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "12–15", defaultWeight: 8, restSec: 60, supersetGroupId: null, note: "" },
            { id: uid("ex"), catalogId: "cat_curl_martello", name: "Curl a martello al cavo (corda)", muscleGroup: "Bicipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 75, supersetGroupId: ssC, note: "" },
            { id: uid("ex"), catalogId: "cat_pushdown_corda", name: "Pushdown tricipiti con corda", muscleGroup: "Tricipiti", focus: "Ipertrofia", stimulus: "Ipertrofia", sets: 3, repsTarget: "10–12", defaultWeight: 20, restSec: 75, supersetGroupId: ssC, note: "" }
          ]
        }
      ];
    }

    // "Misto" (50% Forza / 50% Ipertrofia): restituisce una copia fresca delle schede A-B-C bilanciate
    const base = getDefaultRoutines();
    base.forEach(r => {
      const oldId = r.id;
      r.id = uid("routine");
      const gidMap = new Map();
      r.exercises.forEach(ex => {
        ex.id = uid("ex");
        if (ex.supersetGroupId) {
          if (!gidMap.has(ex.supersetGroupId)) gidMap.set(ex.supersetGroupId, uid("ss"));
          ex.supersetGroupId = gidMap.get(ex.supersetGroupId);
        }
      });
      r._templateSource = oldId;
    });
    return base;
  }

  function createEmptyActiveSession() {
    return {
      routineId: null,
      startedAtMs: 0,
      pausedAccumMs: 0,
      pauseStartMs: 0,
      isPaused: false,
      restTimer: {
        active: false,
        endTimeMs: 0,
        totalSec: 90,
        label: "Recupero",
        exerciseName: "",
        isAlarming: false,
        alarmStartedAtMs: 0
      }
    };
  }

  function getDefaultPrefs() {
    return {
      autoRest: true,
      sound: true,
      notifications: true,
      wakeLock: true,
      useRirInAdvice: true,
      autoApplyAdvice: false,
      autoLockCompleted: false,
      trainingGoal: "Misto",
      weightStep: 2.5,
      lastBackupAt: 0,
      lastBackupReminderAt: 0
    };
  }

  function normalizeWeightStep(value) {
    const n = parseNum(value);
    return Math.abs(n - 1.25) < 0.001 ? 1.25 : 2.5;
  }

  /**
   * Garantisce che nel catalogo esista un esercizio corrispondente e ne restituisce l'entry.
   */
  function ensureCatalogEntry(catalog, byId, byName, opts) {
    if (opts.catalogId && byId.has(opts.catalogId)) {
      return byId.get(opts.catalogId);
    }
    const norm = normalizeName(opts.name);
    if (norm && byName.has(norm)) {
      return byName.get(norm);
    }
    const entry = {
      id: opts.catalogId || uid("cat"),
      name: String(opts.name || "Esercizio").trim() || "Esercizio",
      muscleGroup: MUSCLE_GROUPS.includes(opts.muscleGroup)
        ? opts.muscleGroup
        : inferMuscleGroup(opts.name, opts.focus),
      defaultRestSec: Math.max(10, parseInt(opts.restSec, 10) || 90),
      defaultStimulus: opts.stimulus || inferStimulus(opts.focus),
      note: opts.note || ""
    };
    catalog.push(entry);
    byId.set(entry.id, entry);
    if (norm) byName.set(norm, entry);
    return entry;
  }

  /**
   * Normalizza gli esercizi in superserie: solo coppie adiacenti possono condividere un supersetGroupId.
   * Migra anche i vecchi flag `superset: true` adiacenti dallo schema v2.
   */
  function normalizeRoutineSupersets(exercises) {
    if (!Array.isArray(exercises)) return;
    let i = 0;
    while (i < exercises.length) {
      const curr = exercises[i];
      const next = exercises[i + 1];

      // Caso v3 già con supersetGroupId
      if (curr.supersetGroupId && next && next.supersetGroupId === curr.supersetGroupId) {
        i += 2;
        continue;
      }

      // Caso v2 legacy: coppia adiacente con superset === true e nessun supersetGroupId
      if (!curr.supersetGroupId && curr.superset === true && next && !next.supersetGroupId && next.superset === true) {
        const gid = uid("ss");
        curr.supersetGroupId = gid;
        next.supersetGroupId = gid;
        // Nel v2 il 1° esercizio aveva spesso restSec=20 (pausa di transizione): eredita quello del 2° per il timer condiviso
        if ((parseInt(curr.restSec, 10) || 0) <= 30 && (parseInt(next.restSec, 10) || 0) > 30) {
          curr.restSec = next.restSec;
        }
        delete curr.superset;
        delete next.superset;
        i += 2;
        continue;
      }

      // Qualsiasi gruppo orfano o non adiacente viene ripulito in sicurezza
      curr.supersetGroupId = null;
      delete curr.superset;
      i += 1;
    }
  }

  /**
   * Migra in modo sicuro qualunque stato (v2 o v3) verso schemaVersion 3 senza perdere dati.
   */
  function migrateState(raw) {
    const baseRoutines = getDefaultRoutines();
    const baseCatalog = getDefaultCatalog();

    if (!raw || !Array.isArray(raw.routines) || raw.routines.length === 0) {
      return {
        schemaVersion: SCHEMA_VERSION,
        catalog: baseCatalog,
        routines: baseRoutines,
        activeRoutineId: baseRoutines[0].id,
        manageRoutineId: baseRoutines[0].id,
        drafts: {},
        activeSession: createEmptyActiveSession(),
        history: [],
        prefs: getDefaultPrefs()
      };
    }

    const catalog = Array.isArray(raw.catalog) && raw.catalog.length > 0
      ? raw.catalog.map(c => ({
          id: c.id || uid("cat"),
          name: String(c.name || "Esercizio").trim(),
          muscleGroup: MUSCLE_GROUPS.includes(c.muscleGroup) ? c.muscleGroup : inferMuscleGroup(c.name, ""),
          defaultRestSec: Math.max(10, parseInt(c.defaultRestSec, 10) || 90),
          defaultStimulus: c.defaultStimulus === "Forza" ? "Forza" : "Ipertrofia",
          note: String(c.note || "")
        }))
      : baseCatalog.map(c => Object.assign({}, c));

    const byId = new Map();
    const byName = new Map();
    catalog.forEach(c => {
      byId.set(c.id, c);
      const norm = normalizeName(c.name);
      if (norm && !byName.has(norm)) byName.set(norm, c);
    });

    const routines = raw.routines.map(r => {
      const exList = (Array.isArray(r.exercises) ? r.exercises : []).map(ex => {
        const cat = ensureCatalogEntry(catalog, byId, byName, {
          catalogId: ex.catalogId,
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          focus: ex.focus,
          stimulus: ex.stimulus,
          restSec: ex.restSec,
          note: ex.note
        });
        return {
          id: ex.id || uid("ex"),
          catalogId: cat.id,
          name: cat.name,
          muscleGroup: cat.muscleGroup,
          focus: ex.focus || cat.defaultStimulus || "Ipertrofia",
          stimulus: ex.stimulus || inferStimulus(ex.focus || cat.defaultStimulus),
          sets: Math.max(1, parseInt(ex.sets, 10) || 3),
          repsTarget: String(ex.repsTarget || "8–10"),
          defaultWeight: parseNum(ex.defaultWeight),
          restSec: Math.max(10, parseInt(ex.restSec, 10) || cat.defaultRestSec || 90),
          supersetGroupId: ex.supersetGroupId || null,
          superset: Boolean(ex.superset),
          note: String(ex.note != null ? ex.note : "")
        };
      });

      normalizeRoutineSupersets(exList);

      return {
        id: r.id || uid("routine"),
        name: String(r.name || "Scheda").trim(),
        subtitle: String(r.subtitle || ""),
        stimulus: r.stimulus || "Misto",
        exercises: exList
      };
    });

    const history = (Array.isArray(raw.history) ? raw.history : []).map(sess => {
      const exList = (Array.isArray(sess.exercises) ? sess.exercises : []).map(ex => {
        const cat = ensureCatalogEntry(catalog, byId, byName, {
          catalogId: ex.catalogId,
          name: ex.name,
          muscleGroup: ex.muscleGroup,
          focus: ex.focus
        });
        const sets = (Array.isArray(ex.sets) ? ex.sets : []).map(s => {
          const w = parseNum(s.weight);
          const r = Math.max(0, Math.round(parseNum(s.reps)));
          const rir = RIR_OPTIONS.includes(s.rir) ? s.rir : "-";
          const warmup = Boolean(s.warmup);
          const orm = warmup ? 0 : (s.orm != null ? parseNum(s.orm) : calcEpley1RM(w, r));
          return { weight: w, reps: r, rir, orm, warmup };
        });
        return {
          catalogId: cat.id,
          name: cat.name,
          muscleGroup: cat.muscleGroup,
          focus: ex.focus || cat.defaultStimulus || "Ipertrofia",
          sets
        };
      });
      return {
        id: sess.id || uid("sess"),
        dateISO: sess.dateISO || new Date().toISOString(),
        routineId: sess.routineId || null,
        routineName: String(sess.routineName || "Seduta"),
        durationSec: Math.max(0, parseInt(sess.durationSec, 10) || 0),
        totalSets: parseInt(sess.totalSets, 10) || exList.reduce((a, e) => a + e.sets.length, 0),
        totalVolume: Math.round(parseNum(sess.totalVolume)),
        best1RM: parseNum(sess.best1RM),
        note: String(sess.note || ""),
        exercises: exList
      };
    });

    const activeSessRaw = raw.activeSession || {};
    const restRaw = activeSessRaw.restTimer || {};
    const activeSession = {
      routineId: activeSessRaw.routineId || null,
      startedAtMs: Number(activeSessRaw.startedAtMs) || 0,
      pausedAccumMs: Number(activeSessRaw.pausedAccumMs) || 0,
      pauseStartMs: Number(activeSessRaw.pauseStartMs) || 0,
      isPaused: Boolean(activeSessRaw.isPaused),
      restTimer: {
        active: Boolean(restRaw.active),
        endTimeMs: Number(restRaw.endTimeMs) || 0,
        totalSec: Math.max(5, parseInt(restRaw.totalSec, 10) || 90),
        label: String(restRaw.label || "Recupero"),
        exerciseName: String(restRaw.exerciseName || ""),
        isAlarming: Boolean(restRaw.isAlarming),
        alarmStartedAtMs: Number(restRaw.alarmStartedAtMs) || 0
      }
    };

    const prefs = Object.assign(getDefaultPrefs(), raw.prefs || {});
    prefs.weightStep = normalizeWeightStep(prefs.weightStep);
    prefs.lastBackupAt = Math.max(0, Number(prefs.lastBackupAt) || 0);
    prefs.lastBackupReminderAt = Math.max(0, Number(prefs.lastBackupReminderAt) || 0);

    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      catalog,
      routines,
      activeRoutineId: raw.activeRoutineId || routines[0].id,
      manageRoutineId: raw.manageRoutineId || routines[0].id,
      drafts: raw.drafts && typeof raw.drafts === "object" ? raw.drafts : {},
      activeSession,
      history,
      prefs
    };

    if (!migrated.routines.some(r => r.id === migrated.activeRoutineId)) {
      migrated.activeRoutineId = migrated.routines[0].id;
    }
    if (!migrated.routines.some(r => r.id === migrated.manageRoutineId)) {
      migrated.manageRoutineId = migrated.routines[0].id;
    }
    return migrated;
  }

  function listRecoveryKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf(RECOVERY_KEY_PREFIX) === 0) keys.push(key);
      }
    } catch (err) {
      console.error("Impossibile elencare le copie di recovery:", err);
    }
    return keys.sort();
  }

  function pruneRecoveryCopies(maxKeep) {
    const keep = Math.max(1, maxKeep || MAX_RECOVERY_COPIES);
    const keys = listRecoveryKeys();
    while (keys.length > keep) {
      const oldest = keys.shift();
      try {
        localStorage.removeItem(oldest);
      } catch (err) {
        console.error("Impossibile rimuovere una copia di recovery:", err);
      }
    }
  }

  function preserveCorruptPayload(storageKey, rawValue, error) {
    const recoveryKey = RECOVERY_KEY_PREFIX + new Date().toISOString().replace(/[:.]/g, "-");
    let saved = false;
    try {
      localStorage.setItem(recoveryKey, rawValue);
      saved = true;
      pruneRecoveryCopies(MAX_RECOVERY_COPIES);
    } catch (err) {
      console.error("Impossibile conservare la copia dei dati danneggiati:", err);
    }

    lastLoadError = {
      storageKey,
      recoveryKey: saved ? recoveryKey : null,
      recoveredFromV2: false,
      message: String((error && error.message) || error || "Errore sconosciuto"),
      detectedAtISO: new Date().toISOString()
    };
    console.error(`Dati locali non leggibili in "${storageKey}".`, error);
    return lastLoadError;
  }

  function loadState() {
    lastLoadError = null;

    let rawV3 = null;
    try {
      rawV3 = localStorage.getItem(STORAGE_KEY_V3);
    } catch (err) {
      console.error("localStorage non accessibile:", err);
    }

    if (rawV3) {
      try {
        return migrateState(JSON.parse(rawV3));
      } catch (err) {
        preserveCorruptPayload(STORAGE_KEY_V3, rawV3, err);
      }
    }

    let rawV2 = null;
    try {
      rawV2 = localStorage.getItem(LEGACY_STORAGE_KEY_V2);
    } catch (err) {
      console.error("localStorage non accessibile:", err);
    }

    if (rawV2) {
      try {
        const migrated = migrateState(JSON.parse(rawV2));
        saveState(migrated);
        if (lastLoadError) lastLoadError.recoveredFromV2 = true;
        return migrated;
      } catch (err) {
        preserveCorruptPayload(LEGACY_STORAGE_KEY_V2, rawV2, err);
      }
    }

    const fresh = migrateState(null);
    saveState(fresh);
    return fresh;
  }

  function getLastLoadError() {
    return lastLoadError;
  }

  function getRecoveryData(recoveryKey) {
    if (!recoveryKey) return null;
    try {
      return localStorage.getItem(recoveryKey);
    } catch (err) {
      console.error("Impossibile leggere la copia di recovery:", err);
      return null;
    }
  }

  function saveState(state) {
    try {
      state.schemaVersion = SCHEMA_VERSION;
      localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error("Errore salvataggio localStorage:", err);
      return false;
    }
  }

  /**
   * Propaga la modifica di un esercizio del catalogo a tutte le schede e allo storico
   * tramite catalogId univoco, mantenendo integri grafici e volume settimanale.
   */
  function syncCatalogItemReferences(state, catalogItem) {
    if (!state || !catalogItem) return;
    (state.routines || []).forEach(r => {
      (r.exercises || []).forEach(ex => {
        if (ex.catalogId === catalogItem.id) {
          ex.name = catalogItem.name;
          ex.muscleGroup = catalogItem.muscleGroup;
        }
      });
    });
    (state.history || []).forEach(sess => {
      (sess.exercises || []).forEach(ex => {
        if (ex.catalogId === catalogItem.id) {
          ex.name = catalogItem.name;
          ex.muscleGroup = catalogItem.muscleGroup;
        }
      });
    });
  }

  function buildExportJsonString(state) {
    return JSON.stringify({
      app: "GymTracker ABC",
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      data: state
    }, null, 2);
  }

  function parseAndMigrateBackup(rawText) {
    const parsed = JSON.parse(rawText);
    const payload = parsed && parsed.data ? parsed.data : parsed;
    if (!payload || !Array.isArray(payload.routines) || payload.routines.length === 0) {
      throw new Error("Struttura JSON non valida");
    }
    return migrateState(payload);
  }

  global.GymStorage = {
    SCHEMA_VERSION,
    RIR_OPTIONS,
    MUSCLE_GROUPS,
    uid,
    parseNum,
    normalizeName,
    calcEpley1RM,
    extractTargetRepsDefault,
    roundToGymStep,
    inferMuscleGroup,
    isLegExercise,
    isHeavyLegExercise,
    getExerciseWeightStep,
    estimateRecommendedRestSec,
    getDefaultCatalog,
    parseCatalogText,
    buildCatalogCsv,
    getDefaultRoutines,
    buildGoalRoutinesTemplate,
    createEmptyActiveSession,
    getDefaultPrefs,
    normalizeWeightStep,
    normalizeRoutineSupersets,
    migrateState,
    loadState,
    getLastLoadError,
    getRecoveryData,
    saveState,
    syncCatalogItemReferences,
    buildExportJsonString,
    parseAndMigrateBackup
  };
})(window);
