# Developer review: Family Chores, stage 1 (single device), 2026-11-12

Checklist: `~/.claude/skills/pwa-app/references/dev-review.md`. Engineering review, not legal advice.
Verdict: **ready for family testing on one device. Not yet published** (needs Lorne's yes). Stage 2 (shared database) needs its own review.

## 1. Data map
| Data | Whose | Where | Notes |
|---|---|---|---|
| First name/nickname, emoji, role, age group | adults + children | this device (localStorage) | no surnames, birthdays, photos, contacts, location |
| Chores, values, rotation settings | family | this device | |
| Swaps, completions, payouts | family | this device | money is tracking only, no payments |
| Parent PIN | parent | this device, SHA-256 hash | convenience lock, not strong security (short PINs are guessable from the hash) |
| Usage (visits/minutes per device × web/app) | this device | this device | shared only if the user copies a report |
**PASS.** Sync links carry family data (not the PIN or the device identity; fixed in this review): the About page warns to send them only to family.

## 2. Privacy law
- Data minimisation: **PASS** (see map).
- Privacy notice in app (About): **PASS**.
- Delete and export: **PASS** (Setup → Download my data / Delete all data).
- GDPR/UK GDPR: **N/A** for stage 1 (household use, nothing leaves the device). Stage 2 must revisit.
- US state privacy laws: **N/A** (not a business, no collection by an operator).
- Cookies/ePrivacy: **PASS**: no cookies, analytics or third-party scripts; local storage is strictly necessary.

## 3. Children
- COPPA: **N/A in stage 1**: no personal information is collected by any operator; data stays on the family's device. Stage 2 (server) needs parental-consent design: parent-created profiles, no child accounts or emails, minimal fields.
- UK Children's Code: **PASS** for defaults (private, no nudges, no profiling, no geolocation).
- Parent controls: **PASS with condition**: approvals, payouts and setup need a parent; when a PIN is set, choosing a parent identity asks for it (fixed in this review). Setup shows a reminder until a PIN is set. **Condition: set a parent PIN.**
- No ads, tracking, public profiles or chat: **PASS**. No photos/likenesses (emoji only): **PASS**.

## 4. Accessibility (WCAG 2.2 AA target)
- lang, title, one h1 per view, landmarks, skip link: **PASS**.
- Labels on every form field; buttons have text: **PASS** (automated check + review).
- Keyboard and visible focus: **PASS** (native controls, focus outline).
- Contrast: **PASS** (white on #2f6f4f ≈ 6:1; muted text ≈ 6:1; tags ≥ 7:1).
- Targets ≥ 40–44 px, reflow at 320 px, reduced motion: **PASS**.
- Status messages: **PASS** (`role="status"`). Native confirm/prompt dialogs are accessible.
- Segmented "Today / This week" switched from half-built tab roles to links with `aria-current` (fixed).
- Minor: focus isn't moved to the new heading on view change. Acceptable; revisit if screen-reader users join.

## 5. Security
- HTTPS (GitHub Pages) + strict Content-Security-Policy (no inline scripts, no other origins): **PASS**.
- Escaping: **PASS**, tested with a name containing HTML (`<img onerror>`): rendered as text.
- No secrets in code: **PASS**. No third-party code: **PASS**.
- Sync import: validates arrays and string ids, newer edit wins, bad links fail safely: **PASS**. PIN removed from sync links: **fixed**.
- Server-side controls (auth, row-level security): **N/A** until stage 2.

## 6. Back end reality
- Stage 1 is single-device. **Each phone has its own copy**; sync links copy data but are not live. Stated in About and PLAN.md: **PASS**.
- Stage 2 decision made (shared family database, individual phones). Service not yet chosen or vetted; Lorne creates the account. **Open.**
- Notifications: none yet (needs a server for push). **Open (stage 2).**
- `navigator.storage.persist()` requested; export available: **PASS**. Versioned state key `family-chores-v1`: **PASS**.

## 7. Reliability and compatibility
- Offline after first visit (service worker): **PASS** (verified on the published template site; recheck after publishing).
- Rotation tests (automated, 16 checks): one person per weekly chore for 4 weeks; rotation changes week to week; youngest only gets age-suitable chores over 21 days; parents only on "parents too" chores; done → approval → balance; swap → accept → parent approval → reassignment; payout zeroes balance; no JS errors: **PASS**.
- Dates: local calendar days; daylight-saving safe (day differences rounded): **PASS**.
- Device matrix: phone and laptop layouts checked in Chrome; **iPhone Safari and installed app to be checked by Lorne after publishing.**

## 8. Legal housekeeping
- Own icon, system emoji and fonts, generic name: **PASS**.
- Public repo would contain code and fictional sample names only, no family data: **PASS**.

## Open items before release
1. Lorne's yes to publish (public GitHub Pages repo `family-chores`).
2. Set a parent PIN on first use.
3. Stage 2: choose and vet the shared database; then a new review (privacy notice update, COPPA design, server security).
