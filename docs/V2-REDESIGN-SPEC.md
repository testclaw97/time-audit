# Time Audit v2 — "The Truth" redesign

**Goal:** make it viral. The app people open to face where their time went — Hormozi's brutal-honesty frame.

## The core insight
95% of usage is OUTSIDE the app (lock-screen one-tap popup = the input). So the app's screens are
NOT a logging control panel — they're the PAYOFF. Home = the truth. This is how BeReal / Duolingo /
screen-time apps work: one emotional job per screen, one-tap core action, a shareable artifact.

## Structure
- **HOME ("Today / The Truth")** — the reward, not a form:
  - Header: date + streak, a pause-bell + a settings gear (top-right).
  - HERO: hours tracked today + a Deep/Shallow/Reactive stacked bar + the % split (shallow+reactive in red).
  - Hormozi verdict: one blunt dynamic line ("2h scrolling today — 14h this week, 30 days a year").
  - Day timeline: glanceable rows; tap a row → a modal to log/fill that slot (catch-up). NO always-on picker.
  - Permission nudge banner only when a grant is missing.
- **INSIGHTS** — deeper truth + the viral engine:
  - Today / This week toggle.
  - Deep/Shallow/Reactive split (the Hormozi frame) + logged %.
  - 7-day stacked bars.
  - Top categories ranked.
  - Annual projection ("at this rate, X days/year").
  - **Reckoning Card** — a shareable full-screen card ("I wasted Y% of my 1,000 blocks this week").
- **SETTINGS** — reached via the gear, shown as a dismissible modal (fixes "can't get back").
- **POPUP** — untouched (already verified working). It's the best asset.

## Navigation
2 tabs only — **Today · Insights** — + a settings gear. Rebuild the bottom bar (the old one didn't
render on device) and verify on the real phone.

## Kind colors (Deep/Shallow/Reactive)
- Deep = teal `#38c8b0` (high-value creation)
- Shallow = amber `#f5a623` (necessary but low-value)
- Reactive = red `#f26d5b` (interruptions / distraction — the waste)
- Unlogged = gap grey

## Design bar
Fast, honest, one-tap. One focal point per screen. Premium dark, big type, whitespace. Hormozi voice:
blunt, no sugar, "the truth will piss you off first."
