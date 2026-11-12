# Family Chores app: plan (game-plan + pwa-app, 2026-11-12)

## Goal
Each family member opens the app on their own phone (web link or installed), sees their chores, marks them done, swaps with someone, and sees what they've earned. Chores rotate weekly/daily (or every N days), only among people old enough for them. Each chore has a money value; parents approve and record payouts.
**Done when:** the family uses it on separate phones for a week, the developer review has no open FAILs, and `check_live.mjs` passes.

## Decisions (Lorne, 2026-11-12)
- Individual phones → **shared family database** (stage 2). Stage 1 runs on one device with the same data model, so nothing is rebuilt.
- Weekly + daily chores, age-appropriate pools, money per job (tracking only, no real payments).

## Data model (same in stage 1 and 2)
| Thing | Fields |
|---|---|
| Person | id, name (first name or nickname), emoji, role (parent/child), age group (little 4–7, kid 8–12, teen 13–17, adult) |
| Chore | id, name, emoji, how often (daily / weekly / every N days), rotate (weekly / daily / every N days / fixed person), value (cents), minimum age group, who can do it |
| Assignment | worked out from the rotation (no storage): eligible people in order, period number since the start date, shifted per chore so jobs spread out |
| Swap | chore, period, from, to, status (asked / accepted / declined / approved), who asked, when |
| Done | chore, period, person, done at, approved by parent (if approval is on), value at the time |
| Payout | person, amount, date, note, recorded by |
| Settings | week starts (Sun/Mon), rotation start date, parent approval for swaps / for done, currency |

## Stage 2: shared database (needs Lorne)
- Candidate: Supabase (Postgres + row-level security + auth), called with plain `fetch` (no SDK) to keep dependencies at zero. Vet with `skill-vet` first; compare with Firebase.
- Parent signs in by email link; parent creates the family and invites people. **Children get a device link from a parent (no email, no password, no child accounts with personal details).**
- Row-level security: a device sees only its own family. Parent-only actions enforced on the server.
- Privacy notice in the app; delete-family and export buttons; data region chosen; children's data minimised (first name/emoji, age group, no birthdays, no photos). COPPA/Children's Code notes in REVIEW.md.
- Reminders: in-app plus optional calendar file; push notifications later (needs the server).

## Risks
- Kids' data on a server → keep it minimal, parent-managed, document it; lawyer only if offered to other families.
- Shared phone or a kid tapping "parent" in stage 1 → parent PIN (convenience lock, not real security; stage 2 uses real sign-in).
- Dates and rotation at week boundaries / daylight saving → store dates as local YYYY-MM-DD, test boundaries.
