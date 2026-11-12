# Family Chores v2: accounts, rubrics, photos, AI scoring, payouts (plan, 2026-11-12)

## What Lorne asked for
- Log-in and a "firewall": each account safe, private, secure.
- Track progress, earnings, payouts and **penalties**.
- Kids upload **photos** as proof, with date completed and tasks done.
- Each **job** has a **task list**; each task scored **1–5** against a visible **rubric/standard**; the job rating and payout come from the task scores; deductions shown.
- **Payouts in the app**, per job, to Cash, Cash App, bank deposit, a mix or other; parents "just pay and it goes where it needs to go"; **cash payments produce an invoice**.
- **AI**: feedback to kids from photos and progress/penalties; suggested task scores and job ratings for parents to approve or reject; rotate tasks; notify about swaps, changes and unclaimed jobs.
- Parents raise or lower job prices.

## Design
**Jobs, tasks, rubric**
- Job = name, base pay, task list, who can do it, rotation, payment method default.
- Task = name, standard ("what a 5 looks like", "what a 3 looks like", "what a 1 looks like"), weight.
- Job rating = weighted average of task scores (1–5). **Pay scale** (editable by parents), e.g. 5 → 100% of base, 4 → 90%, 3 → 75%, 2 → 50%, 1 → 0%. Penalties: fixed deductions with a reason (late, redo, not done), shown on the child's rubric view.
- Kids see the rubric before they start and the scored matrix after: each task, score, standard met or missed, deductions, final pay.

**Accounts and security** (needs a server, so this is stage 2 now)
- Hosted Postgres with **row-level security** (the "firewall": the database itself refuses to show one family's or one child's data to anyone not allowed). Candidate: Supabase, vetted first.
- Parents sign in by email link (+ optional passkey). Children sign in with a **device link + PIN set by a parent**: no child email, no personal details beyond first name, age group and payout handle.
- Roles: parent (everything in their family), child (own jobs, own photos, own money, family board). Audit log of score changes, price changes and payouts.
- Encryption in transit (HTTPS) and at rest; photos in a **private** storage bucket, short-lived links only.

**Payments: the honest version**
- An app can't move money into Cash App or a bank by itself unless it becomes a licensed payments business (identity checks, fees, money-transmission rules). That's not sensible for a family.
- What works: the parent taps **Pay** and the app opens the right place with the amount filled in, then records the payout:
  - **Cash App:** opens Cash App to the child's $cashtag with the amount (cash.app/$tag/amount link; to test). Teens 13–17 need a parent-sponsored Cash App account.
  - **Bank deposit:** shows the amount and the child's saved reference, then opens the parent's bank app; the parent confirms "sent".
  - **Cash:** creates an **invoice** (PDF/printable: jobs, scores, deductions, total, date) for the parent; the child taps "received" to close it.
  - **Mix:** split per job (e.g. 50% Cash App savings, 50% cash).
- Every payout: method, amount, jobs covered, who paid, when, child's confirmation.

**AI**
- Photo check: did the photo show the task done? Suggested 1–5 per task with a one-line reason; job rating; kid-friendly feedback (encouraging, specific, no shaming). **Parents approve or edit before scores count.** Kids see AI feedback only after a parent approves (or instantly, if the parent chooses).
- Rotation and reminders don't need AI: the rules engine already rotates; notifications (push on Android/laptop and installed iPhone app) for swaps, changes, unclaimed jobs, due today, payouts.
- AI runs on the server side only (API keys never in the app).

## Conflicts that need Lorne's decision
1. **Children's photos and AI.** House rule: L's photos stay on local engines (no cloud video/speech services). Photos of chores can include the child. Options: (a) AI runs on the home computer (local vision model; slow on this laptop, but chores are few) and photos are encrypted so the cloud only stores locked files; (b) photos must show the work only, the app blocks photos with a face, and the cloud AI checks them; (c) no AI on photos: parents score, AI only writes feedback from scores.
2. **Payments**: confirm the "tap Pay → opens Cash App / bank with the amount → recorded" approach (no licensed payments provider).
3. **Back end account**: Lorne creates it once the service passes skill-vet (Supabase candidate; free tier to start).

## Decisions (Lorne, 2026-11-12)
1. **Photos:** two kinds of chore.
   - **Work chores** (rooms, dishes, yard): before + after photos of the work only, **no people**. The phone checks for faces before upload and refuses photos with people; the app states this clearly. Cloud AI may score these.
   - **Personal-care chores** (teeth, hair, outfit; mainly little kids): photos will show the child. **Private, family-only**, never sent to cloud AI. Scored by a parent, or by a local AI on the home computer (encrypted upload, decrypted only at home).
2. **Payouts:** tap Pay → Cash App (cashtag + amount) or bank app opens → app records; cash → invoice + child's "received". **Future expansion:** a real payouts provider for automatic transfers (identity checks, fees, money-transmission rules to research).
3. **Back end:** Supabase, vetted 2026-11-12 (PASS with conditions, see skill-vet ledger). Lorne creates the account.

## Sign-in design
- Parents: email sign-in link (later: passkey).
- Children: no email. A parent creates the child's profile and shows a **one-time pairing code/QR**; the child's phone redeems it once (database function) and stays signed in; a 4-digit app PIN opens the app on that phone. Lost phone → parent un-pairs it.
- Database rules (row-level security) on every table and photo bucket, with automated tests: a child can't read a sibling's money, photos or scores; nobody can read another family; only parents change prices, scores and payouts.
- Keys: only the public "anon" key ships in the app; the service key, the AI key and the notification key live only in server-side function secrets that Lorne pastes into the dashboard (never in chat).

## Build order after decisions
1. Back end + sign-in + roles + security rules (tests prove a child can't read a sibling's data or another family's).
2. Jobs/tasks/rubric/pay scale/penalties + parent price edits.
3. Photo proof upload (private bucket or encrypted) + completion date + tasks ticked.
4. Scoring: parent scoring screen, then AI suggestions per decision 1.
5. Payouts: methods per job and child, Pay links, invoices, receipts.
6. Notifications.
7. Developer review (full: COPPA design, privacy notice, OWASP ASVS L2 with accounts, WCAG), penetration-style tests of the security rules, then publish.

## Status 2026-11-12
- Schema + RLS installed in Supabase (001_schema.sql): "Family Chores schema installed".
- 40-check SQL security test (002): ALL SECURITY TESTS PASSED (test data removed).
- External probe with the publishable key: visitor gets permission denied on tables and functions; anonymous unpaired phone sees empty results, cannot create a family, wrong pairing code rejected, pairing_codes table denied, photo list empty, uploads denied (RLS), no public photo URLs.
- Two anonymous test sign-ins exist from the probe (no rights; can be deleted under Authentication → Users).
- Next: connect the app (sign-in, family creation, pairing, jobs/tasks/rubric, photo proof, scoring, payouts), then publish with config injected from GitHub secrets.
