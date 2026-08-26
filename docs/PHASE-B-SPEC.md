# Time Audit — Phase B spec (UX rebuild, after reliability is confirmed on TJ's real device)

Phase A (persistent-FGS engine) must be verified FIRING on TJ's phone first. Phase B is the
product/UX rebuild, grounded in the research (viral time-audit apps) + peer review + TJ's feedback.

Design north star (TJ): **fast, efficient, easy, quick — one tap = logged, then gone.**
It's Alex Hormozi's 15-minute audit — the product is the moment you see "I wasted X% of my time."

## 1. Navigation / IA (fix the "back exits the app" trap)
- Material-3 **bottom nav, 3 tabs: Today (timetable) · Stats · Settings.** Default landing = Today.
- Tapping a tab jumps straight there; Back never switches tabs. Back closes a sheet / sub-screen
  and lands on Today; only Back from Today root exits. Every pushed screen / bottom sheet has a
  visible close (X) or back arrow. (Settings must be one tap from anywhere; no dead-ends.)

## 2. Home = LIVE STATS on top + the TIMETABLE (kill the "What are you doing right now?" picker)
TJ (2026-08-26): timetable prominent, and **statistics visible ON the homepage** — logging a
category must immediately show "where your time went" so every tap is rewarded (the retention loop,
§9). Home (Today tab) layout, top to bottom:
1. **Live stats header (the reward):** today's breakdown that updates the INSTANT you log — the
   Deep/Shallow/Reactive split as a slim stacked bar + the headline number ("4h logged · 62% deep
   today" / "2h 15m reactive"). This is the dopamine hit that makes logging feel worth it. Tapping
   it opens the full Stats tab.
2. **The timetable** (the interaction): vertical 15-min list, "now" marked, blocks color in as the
   day fills, empty blocks "tap to log", unlogged gaps honestly gray (Hormozi = confront reality).
- Logging happens TWO ways, never from a home category grid:
  1. **The popup** (native chooser / notification floor) — primary.
  2. **Tap a block** in the timetable → the category picker slides up as a bottom sheet → one tap.
- **Tap-and-drag to paint a range** one category (retroactive bulk fill).
- Every log animates the stats header updating — make the payoff visible and satisfying.

## 3. Missed check-ins → CATCH-UP (TJ's key ask; decided design)
When a ping fires (or the app opens) and there are unlogged slots since the last logged one:
- Show **"What have you been doing since HH:MM?" (N missed blocks · M min)** and **one category tap
  fills the ENTIRE missed stretch** (people were usually doing one thing). Gap gone in one tap.
- A quiet **"split / set each"** link drops into those blocks (timetable) to set them individually.
- Rule: **default to bulk-fill the whole gap with one tap; make splitting easy but optional.**
- This applies both to the popup (chooser shows "covers last N blocks") and an app-open catch-up sheet.

### Missed pings must NOT stack (TJ 2026-08-26)
If pings fire at 10:00, 10:15, 10:30… while the user is away, they must NOT pile up as N separate
notifications/overlays. Design:
- **ONE notification, updated in place** (stable notif id — already the case; each ping REPLACES the
  prior). Its text ACCUMULATES the gap: "3 check-ins to log · since 10:00" (not "what are you doing
  at 10:30"). Tapping → the catch-up flow.
- **ONE overlay window** (reused, not stacked) — when it finally shows (unlocked), it IS the catch-up:
  "You've been away since 10:00 · 3 blocks — what were you doing?" one tap fills all, split optional.
- Engine change: `render()` computes unlogged-slots-since-last-logged and shows the accumulated
  count, so a single surface always reflects the whole backlog. Filling it is the §3 catch-up
  (one-tap bulk-fill for the whole stretch, easy split). Smooth even after hours away.

## 4. Statistics = a first-class tab (the Hormozi payoff; currently buried)
Two views: **Today / Week.** Categories carry a Deep/Shallow/Reactive `kind` (already in the data model).
- **Lead with the blunt sentence, not a chart:** "You spent **11h 45m** — **58%** — on shallow +
  reactive time this week." (The 80/20 gut-punch, made personal.)
- **Category donut** (mix) + **ranked horizontal bars** (Deep/Shallow/Reactive headline, sub-cats below).
- **7-day stacked bar** (one column/day, colored by category/kind) — the single most powerful chart:
  you see the day you lost, and patterns ("afternoons go reactive") jump out.
- **Week-over-week delta** + **annual projection** ("at this rate ~1,200 hrs/yr on shallow"). Annualizing
  the weekly waste is the most visceral stat.
- **Unlogged shown honestly** (gray "unaccounted"), never hidden.
- Push the user here at end of day/week ("See where your day went").

## 5. Onboarding = value-first permission ladder (educate before each OS dialog)
~5 screens: (1) shocking promise + sample stat; (2) how it works (15-min popup, one tap);
(3) privacy — 100% local, no account (lean on it); (4) set waking hours + cadence → fire
POST_NOTIFICATIONS + SCHEDULE_EXACT_ALARM here, framed as "when should we check in?";
(5) log your first block live (feel the one-tap speed). Overlay + full-screen-intent asked
just-in-time with plain "why". **Permissions are runtime-verified + re-nagged, never assumed granted**
(no grant API for overlay/battery/OEM-autostart). Add an OEM (Samsung/Xiaomi/OnePlus) "don't kill me"
step that deep-links autostart/never-sleep with a short how-to. An **engine-health** row
(`isEngineRunning()` + each permission state) so the user can see/fix why pings aren't coming.

## 6. Lock-screen popup = a TOGGLE (TJ's ask)
Setting **"Show over lock screen"** (default ON). When OFF, the engine's locked branch does NOT
fire the full-screen PingActivity — the check-in waits as the notification floor and only goes
full-screen once the phone is in use (unlocked). Native `render()` reads this setting
(persist in PingStore + pass through schedule/setCategories path) + a Settings switch.

## 7. Reliability follow-ups (from the peer review, after Phase A confirmed)
- **WorkManager periodic watchdog** (~20 min): if tracking on and (PingService dead OR next alarm
  not armed) → restart + re-arm. Cheap insurance vs OEM kills. (Adds androidx.work dep.)
- Consider **`setAlarmClock()`** instead of setExactAndAllowWhileIdle if pings still land late on a
  specific OEM (stronger, Doze-immune; cost = status-bar alarm icon).
- Refine the floor notification on the overlay branch to be silent (avoid a heads-up sliding over
  the overlay).

## 8. Virality (later)
Auto-generated **weekly "reckoning card"**: one honest, screenshot-ready image — "My week: 11h 45m
wasted, 58% reactive" + the 7-day stacked bar + annual projection. Built for the "I did Hormozi's
audit, here's the damage" confession format (there's an existing Hormozi-audit content wave to ride).

## 9. Retention — how big companies keep people using it (TJ: "how do they make people keep using this")
The habit loop (Nir Eyal's Hook model, how Duolingo/Daylio/Strava retain):
- **Trigger:** the 15-min popup is the external trigger; the accumulating unfinished day becomes the
  internal trigger ("I should log this").
- **Action, frictionless:** one tap = logged (must beat Daylio's 2-tap/30s bar, or it dies).
- **Variable reward:** the payoff must be IMMEDIATE and visible — the live stats header updates the
  instant you log (that's why stats go on the home, §2). The day filling in is visible progress; the
  end-of-day/week "reckoning" is the emotional reward (confront the truth).
- **Investment:** the more you log, the more your history/timetable is worth → sunk-cost stickiness.
Concrete mechanics to build (ranked):
1. **Live stats on the home** that update on every log (immediate reward). — §2
2. **Daily completion:** "today is 78% audited" progress; nudge to fill gaps.
3. **End-of-day recap** ("Your day is done — here's where it went") pushing to Stats.
4. **Streak** ("6 days audited") — small; the TRUTH is the hook, not the streak (don't over-gamify).
5. **Weekly reckoning card** — the shareable, viral confession artifact (§8).
6. **Honest gaps** — showing unaccounted time creates the tension that pulls the user back to fill it.
Anti-pattern to avoid: a permanent notification + 3am pings + battery drain = uninstall. Quiet hours
(= awake window) are mandatory; keep the persistent notice minimal.

## Competitor note
A live "15-Minute Time Audit" app already exists → differentiate on **timetable + brutal stats +
speed**, not feature count.
</content>
