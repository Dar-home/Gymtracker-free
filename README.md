# GymTracker ABC (Android + PWA)

App per tracciare allenamenti in palestra (**Full Body A-B-C**, Superserie accorpate, 1RM live Epley, RIR, consigli di progressione proporzionali Forza/Ipertrofia, Deload automatico, timer di sessione e recupero con allarme in background).

## Come generare il file `.apk` per Android (senza installare Android Studio)

1. Crea un repository su **GitHub** e carica tutta la cartella `GymTracker/` (inclusi `package.json`, `capacitor.config.json`, `www/`, `android/` e `.github/workflows/build-apk.yml`).
2. Su GitHub, apri il tab **Actions** → seleziona **Build Android APK** → clicca **Run workflow** (oppure parte automaticamente a ogni `push` su `main`/`master`).
3. A fine compilazione (~2-3 minuti), apri la run completata e scarica l'artifact **`GymTracker-ABC-debug-apk`**.
4. Estrai `app-debug.apk`, trasferiscilo sullo smartphone Android e installalo (abilitando *"Installa app sconosciute"* se richiesto).

## Permessi Android per il timer in background
Al primo avvio su Android 13+, consenti le **Notifiche** (e nelle impostazioni app di Android verifica che *"Sveglie e promemoria"* / notifiche esatte e l'ottimizzazione batteria non blocchino l'app), così il timer di recupero suona e vibra puntualmente anche a schermo spento o cambiando app.

## Compilazione locale (opzionale, se hai Java 21 + Android SDK)
```bash
npm install
npx cap sync android
cd android && ./gradlew assembleDebug
```
L'APK verrà generato in `android/app/build/outputs/apk/debug/app-debug.apk`.
