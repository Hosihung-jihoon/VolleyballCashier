# Project Memory: Volleyball Cashier App

## 1. Overview
- **Purpose:** Internal app to calculate and split betting money for volleyball matches.
- **Platforms:** Android (Native App via Expo) & iOS (Web App via Expo Web). Codebase is shared.
- **Tech Stack:** React Native (Expo), Firebase Realtime Database (No auth, Room/PIN based).

## 2. Core Business Logic (Betting Rules)
- **Base Money:** 5,000 VND/person. Total money per set is fixed at 30,000 VND (based on 6 players).
- **Winning/Losing Calculation:**
  - The Losing team pays the total set money (30,000 VND).
  - Losing team's individual payment = Total Money / (Number of players in losing team).
- **Rounding Rule:** Round UP to the nearest 1,000 VND (e.g., 7,500 -> 8,000).
  - Any remainder/change from rounding goes into a "Fund" (`meta.fund` in DB).
- The Winning team receives the EXACT total money collected from the losing team, divided equally among their players (no rounding on the winning side).
- **Substitutions (Slots Logic):**
  - 1 Slot = 1 Unit of Money.
  - If 2 players share 1 slot (substitution), the money for that slot is split equally between them.
  - No "out mid-game" logic; substitutions are treated as sharing a slot.
- **Undo Feature:** Host must have an "Undo" button to revert a completed set to "playing" status and reverse the balance calculations.

## 3. Database Structure (Firebase Realtime DB)
Sessions are stored under `/sessions/{PIN}`.
- `meta`: `{ hostId, createdAt, fund }`
- `players`: `{ player_id: { name, balance, isSettled } }` (Balance is realtime updated; isSettled indicates if player payment/receipt is completed)
- `sets`: `{ set_id: { status, winner, totalMoney, teamA: {slots}, teamB: {slots} } }`
- *Note:* Realtime sync ensures Member devices view changes instantly via PIN.

## 4. Current Progress
- [x] Initialized Expo project with expo-router.
- [x] Defined logic and DB schema.
- [x] Created .env and lib/firebaseConfig.js.
- [x] Created lib/sessionApi.js (Includes: Create/Join/Subscribe/StartSet/FinishSet/UndoSet, AddPlayerManually, ToggleSettled).
- [x] Created lib/bettingEngine.js (Calculates winnings, losses, rounding, fund, custom bet amount).
- [x] Built Home Screen (app/index.js).
- [x] Built Session Screen (app/session.js): Full features (Team division, Substitutions, Undo, Manual add player, Realtime sync, Custom bet, Keep teams for next set, History, Settlement UI with toggle, and Set Details Modal).
- [x] Fixed TypeError crash (`Cannot read property 'teamA' of null`) by adding optional chaining and defensive checks for `latestSet`, `session.sets`, and historical sets `s` during Firebase DB synchronization lags.
- [x] App is fully ready for production testing.
- [x] Generated Android release keystore and configured Gradle 9.0.0 build compatibility.

## 5. Android Build & Compatibility Notes
- **Keystore Information:**
  - Location: `android/volley.keystore`
  - Alias: `volley`
  - Password: (Saved offline by host)
- **Gradle 9.0.0 & JDK Compatibility Fix:**
  - Running Gradle 9.0.0 with JDK 21/24 triggers a `NoSuchFieldError: JvmVendorSpec IBM_SEMERU` due to an outdated `foojay-resolver-convention` plugin (v0.5.0 default in React Native 0.83).
  - **Resolution:**
    1. Update `foojay-resolver-convention` plugin version to `"1.0.0"` in both `android/settings.gradle` and `node_modules/@react-native/gradle-plugin/settings.gradle.kts`.
    2. Execute gradle commands using JDK 21 (bundled JBR) via environment override: `$env:JAVA_HOME="D:\Program file\AndroidStudio\jbr"`.
    3. Clear daemons before building: `./gradlew --stop`.
    4. Compile with: `$env:JAVA_HOME="D:\Program file\AndroidStudio\jbr"; ./gradlew assembleRelease`.
- **Android SDK Path Spaces & NDK CMake Issue:**
  - If `ANDROID_HOME` contains spaces (e.g., `D:\Program file\AndroidSDK`), the build will crash with: `[CXX1101] NDK at ... did not have a source.properties file` due to space handling issues in AGP/CMake.
  - **Resolution:**
    1. Create a directory junction without spaces: `cmd.exe /c mklink /J D:\AndroidSDK "D:\Program file\AndroidSDK"`.
    2. Define `sdk.dir=D\:/AndroidSDK` in `android/local.properties`.

<!-- pass 123456
first and last hung ho
unknow 
PS D:\Individual\volleyball-cashier> cd android
>> keytool -genkey -v -keystore volley.keystore -alias volley -keyalg RSA -keysize 2048 -validity 10000
Enter keystore password:  
Re-enter new password: 
Enter the distinguished name. Provide a single dot (.) to leave a sub-component empty or press ENTER to use the default value in braces.
What is your first and last name?
What is the name of your organizational unit?
What is the name of your organization?                                        
What is the name of your City or Locality?
What is the name of your State or Province?
What is the two-letter country code for this unit?
Is CN="hung ho ", OU=unknow, O=unknow, L=unknow, ST=unknow, C=unknow correct?
  [no]:  y
Generating 2048-bit RSA key pair and self-signed certificate (SHA384withRSA) with a validity of 10,000 days
        for: CN="hung ho ", OU=unknow, O=unknow, L=unknow, ST=unknow, C=unknow
[Storing volley.keystore]-->