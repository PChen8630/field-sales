# Field Sales Command Center

A personal territory tool for an RSM: accounts, visit priorities, trip planning, pipeline and weekly reporting.
Rebuilt from scratch based on the Base44 beta. It runs on this PC with Python, and it can also sync through Supabase and be hosted on GitHub Pages for phone use (see below).

## Start it
Double-click **Start Command Center.bat**. Your browser opens at `http://localhost:8765`. Keep the black window open while you use the app.

> Your data is saved in the browser **for that address**. Always open the app with the launcher and the same browser (Edge or Chrome, not both).
> Back up weekly: **Data & settings → Download backup** (save to OneDrive).

## Use it on your phone (Supabase + GitHub)
**Supabase** stores your data online, so every device sees the same accounts. **GitHub Pages** hosts the app at a web address you can open from anywhere.

**A. Supabase (data), about 10 minutes**
1. Go to supabase.com → **Start your project** → sign in with GitHub (or email).
2. **New project**: name `field-sales`, choose a strong database password (save it in your password manager), region **Canada (Central)**, Free plan.
3. When it's ready: **SQL Editor → New query**, paste everything from `supabase-setup.sql`, then click **Run**. You should see "Success. No rows returned".
4. **Authentication → Users → Add user → Create new user**: your email plus a password for the app. Tick **Auto Confirm User**.
5. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up", so nobody else can create an account.
6. **Project Settings → API Keys** (or the **Connect** button): copy the **Project URL** and the **publishable key** (or the legacy **anon public** key). Paste both into `config.js`. Never use the `secret` / `service_role` key.

**B. First sync (on this computer)**
1. Start the app with the launcher and sign in. Your accounts on this computer are uploaded and become the cloud copy.

**C. GitHub (website)**
1. Create a free account at github.com.
2. **New repository**: name it `field-sales`, set it to **Public** (free GitHub Pages needs that; only the app's code goes there, never your data), and don't add a README.
3. Upload the folder (or ask Claude to push it). `.gitignore` keeps CSV and backup files out.
4. **Settings → Pages → Build and deployment**: Source "Deploy from a branch", branch `main`, folder `/ (root)` → **Save**. After about 1 minute your app is at `https://YOUR-NAME.github.io/field-sales/`.

**D. Phone**
Open that address in Safari (iPhone) or Chrome (Android), sign in, then use **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen** (Android). It opens like an app.

**How sync behaves**
- Changes upload within ~2 seconds. Other devices pick them up when you open or switch back to the app, and every minute while it's open.
- With no signal, keep working. Changes upload when you're back online (the ☁ / ⚠ icon shows the state).
- If two devices changed things before syncing, the app asks which copy to keep. The other copy is saved on the device so you can download it.
- Supabase keeps a **daily copy** for 60 days (Data & settings → Cloud sync → Daily cloud copies). It also keeps a copy before any save that would remove more than half your accounts.
- Free Supabase projects **pause after 7 days without use**. If the app says it can't reach the cloud, open supabase.com and click **Restore project**. Your data is kept.

## Car mode and the Talk icon

- **Car mode** (🚘 in the top bar or menu): a dark, full-screen view with three huge buttons — 🎙 Talk, 🧭 Navigate (Google Maps or Waze) and 📞 Call — for the next stop of today's trip. With no trip today it suggests the best drop-in near you (never home-based or closed dealers). Skip, Read prep aloud, and the screen stays awake.
- **Install on the phone:** open the app in Chrome (Android) or Safari (iPhone) and use *Add to Home screen*. It then opens full-screen like an app, and still opens with no signal.
- **Talk icon:** open `talk.html` on the phone and add it to the home screen too. Tapping it opens Car mode already listening. On Android, long-pressing the main app icon also shows *Talk* and *Car mode* shortcuts.

## Talk: update by voice (AI)

Tap **🎙 Talk** (top bar or Today), speak naturally, pause. The AI (Claude Haiku 5.5) picks the dealer, writes the visit summary, creates projects with follow-up reminders and records contacts who changed companies. It reads back what it understood; say **yes** (or tap Save) to save. Every save can be undone. With no signal the note waits on the phone until you tap **Process** on Today.

One-time setup:
1. **Anthropic account:** sign up at console.anthropic.com, add a payment method, set a monthly spend limit, then create an API key.
2. **Store the key in Supabase:** dashboard → Edge Functions → Secrets → add `ANTHROPIC_API_KEY` with the key. (Never put it in `config.js` or GitHub.)
3. **Deploy the function:** dashboard → Edge Functions → Deploy a new function → Via editor → name it `voice-update` → paste `supabase/functions/voice-update/index.ts` → Deploy. Leave "Verify JWT" on.
4. Optional secrets: `VOICE_MODEL` (default `claude-haiku-5-5`; e.g. `claude-opus-5-5` for the most accurate), `ALLOWED_ORIGINS` (default `https://pchen8630.github.io`).

Needs cloud sign-in. Voice notes and your dealer list are sent to Anthropic to be understood.

## Move your data over from Base44
1. Use **`import-ready.csv`** in this folder. It's your Base44 export (316 accounts), cleaned: province codes, tidy city names, POS 2025/2026, distributor and dealer # as their own columns, and relationship status filled from POS sales (bought in 2026 = Active Customer, bought in 2025 only = Follow-up Needed, no sales = Prospect).
2. Go to **Data & settings → Import CSV** and pick that file. Columns are matched automatically. "Additional contacts" in the notes become real contact records (132 of them).
   (A raw Base44 export also works. The importer reads the dealer info packed into its notes.)
3. Review flagged duplicates (Merge / Create / Skip). Merge only fills blank fields.
4. Click **Locate all** to add map pins (about 1 second per account, so ~6–10 min for 316). Fix any it can't find with **Set on map**.
5. On **Accounts**, filter Status = "(no status)", select all, and bulk-set the relationship status.

## What's new vs. the Base44 beta
| Beta gap | Now |
|---|---|
| 0/316 accounts had coordinates | One-click **Locate all** (street → postal code → city fallback), plus manual pin setting |
| 310 blank relationship statuses | Bulk select + set status/priority/region; "Needs attention" panel on Today |
| Visits / contacts / projects never used | 20-second **Log activity** from anywhere (Today, account panel, trip stop) with +1wk/+2wk follow-up buttons |
| Daily end time not enforced | Planner only adds a stop if the day still ends on time (incl. drive back); late days flagged red |
| Flight arrival ignored | Day 1 starts 60 min after landing; last day ends at departure − airport buffer |
| Return-to-start ignored | Included in routing, timing and Google Maps links |
| Round-robin days zig-zag | Each day is built around nearby accounts, then re-ordered for the shortest route (2-opt) |
| No draft→confirmed, no conflict check | Status selector; overlapping-trip warning; late fixed-appointment warning |
| No print / PDF | Print view, **Calendar (.ics)** for Outlook, CSV |
| Region delete left stale IDs | Deleting a region unassigns its accounts in saved data |
| No reporting | Pipeline board (drag between stages, weighted forecast, win rate), 12-week activity chart, annual target meter, **weekly report** text for your manager |

## Visit score (0–100, same as the beta)
Priority (A 40 / B 25 / C 10) + visit timing (never = 40, else 20 × days since visit ÷ target, max 40) + follow-up (overdue 20, ≤ 7 days 10).
Targets default to A 30 / B 60 / C 90 days. Change them in Settings, or per account.

## Files

- `js/car.js` — Car mode. `talk.html`, `talk.webmanifest`, `manifest.webmanifest`, `icons/` — home-screen install. `sw.js` — lets the app open offline (network first, saved copy as fallback).

- `js/talk.js` — Talk button, review screen, applying updates, offline queue.
- `supabase/functions/voice-update/index.ts` — the AI function (runs on Supabase, holds the Anthropic key).
- `index.html`, `styles.css`, `js/` contain the app (`core.js` holds the logic: scoring, planner, geocoding, CSV)
- `vendor/` holds Leaflet maps and Preact (stored locally)
- `js/sync.js` handles cloud sync. `config.js` holds your Supabase address and key, and `supabase-setup.sql` is the one-time database setup
- Online services used: OpenStreetMap (map tiles + address lookup), OSRM (road drive times), and your own Supabase project when cloud sync is on. No data is sent anywhere else.
