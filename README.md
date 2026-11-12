# Family Chores

A private family chores app: jobs with task rubrics, 1–5 scoring, swaps, parent takeovers, a positives-only scoreboard, earnings and payouts. Works in any browser and installs as an app.

- `web/`: the app (static site, GitHub Pages)
- `supabase/`: database schema, row-level security and tests; the kid-login Edge Function
- `app/`: the earlier single-device version

No personal data, passwords or keys are stored in this repository. Service settings are injected at deploy time from repository secrets.
