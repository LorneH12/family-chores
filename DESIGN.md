# Family Chores: look, feel and game design (2026-11-12)

## What we borrow from real-estate tours
- **Dollhouse view** (Matterport): the whole home as a cutaway model you can turn. → Our **House view**: every room as a toy diorama on one map; rooms glow when they're done.
- **Hotspots** (Matterport/Zillow 3D Home): tap a point in the tour to move or learn more. → In a room, each chore is a **hotspot** on the object it's about (sink → dishes, floor → mop). Tap it to see the checklist, claim it, or submit proof.
- **Floor plan with labelled rooms** (Zillow 3D Home): → Room cards show name, size (if entered), value and status.
- **Tour badges in search results**: → rooms with a real scan/tour show a "Real room" badge.

## The room wheel
- Rooms sit on a **3D scroll wheel** (a vertical drum). Swipe or scroll to spin; it snaps so one room faces you, bigger and lit, with the others curving away.
- Each room is a **toy diorama rendered in Blender** from 12 angles (art/rooms_blender.py). Drag the front room left/right and it turns like a real object. No 3D library is downloaded, so it stays fast on phones.
- The front room shows: value this week, whole-room bonus, "Claim the whole room" and "Pick chores", who has it, and a sparkle meter.
- Accessibility: arrow keys/buttons spin the wheel; every card is a real button with a name; reduced-motion users get a simple list.

## Real house (optional, when available)
- An address can't produce a room layout by itself; public records only give totals, and listing tours belong to whoever listed the home (Zillow moved from Matterport to its own 3D Home tours in Oct 2025).
- Three ways to bring the real home in, per room or whole house, all optional:
  1. **Paste a tour link** (Matterport, Zillow 3D Home, Polycam share link) → shown inside the room view.
  2. **Scan a room with a phone** (free apps: Polycam on iPhone 13+; RoomPlan apps on LiDAR iPhones) → upload the 3D file → shown as the room's model (needs a vetted 3D viewer; later).
  3. **A photo** of the real room → used as the card background.
- Scans and photos of the home are private family data (parents upload; family members view; never public).

## Game layer (built on what actually motivates)
Research summary: points and badges help at first but fade; cash and expected rewards can crowd out a child's own motivation, especially for things they already enjoy; what lasts is **competence, autonomy and relatedness** (feeling good at it, having choices, being part of the team). So:
- **Competence:** room **mastery levels** (Bronze → Silver → Gold → Room Master) earned from scores of 4–5, not just volume. Feedback names the skill ("corners were spotless"), not just the money.
- **Autonomy:** children pick rooms/chores from the wheel and set a personal weekly goal; parents can still assign.
- **Relatedness:** a **House Health** meter for the whole family (every done chore fills it); weekly **family quest** (e.g. "every room sparkles by Sunday") with a shared reward chosen together; thank-you reactions between family members.
- **Rooms that need love:** a room's sparkle fades each day since it was last cleaned (dust motes appear), so attention goes where it's needed, without nagging.
- **Celebration:** confetti and a star burst when a parent approves; pole position on the scoreboard (positives only).
- **Streaks, gently:** "3 weeks of done-on-time" streaks with a free skip each month; no shaming, no streak loss notifications at night.
- **Money stays real but not the only thing:** pay is shown with the rating and the praise; some quests reward family time (movie night, pick dinner) instead of cash.
- **Never:** loot boxes, random rewards, purchases, public shaming, or comparing children's money in front of siblings (the scoreboard shows earnings as positives only, and parents can hide it).

## Sources
- Matterport, 8 best virtual tour software (dollhouse, hotspots): https://matterport.com/blog/best-virtual-tour-software-for-real-estate
- Zillow pulls Matterport tours (Oct 2025): https://www.realestatenews.com/2025/10/20/zillow-pulls-matterport-tours-from-listings-blames-costar
- Matterport free plan (1 active space, embed): https://matterport.com/plans/free
- Polycam Space Mode free on iPhone 13+: https://poly.cam/press-release/space-mode-access-expanded-2026 · free exports: https://learn.poly.cam/hc/en-us/articles/27756102599572-What-File-Types-Can-Polycam-Export
- Gamification and family housework apps (competence, autonomy, relatedness): https://dl.ifip.org/hal-01758462v1
- Overjustification effect: https://yukaichou.com/gamification-analysis/overjustification-effect/

## Ownership and the avatar's voice (Lorne, 2026-11-12)
- People pick their chores, goals and plans. The app never suggests "ask for help" or "ask a parent". When someone takes on too much, their avatar offers choices ("Your call: …") and they decide.
- Everything the app says to a person comes from their avatar, in that avatar's personality and costume. No canned lines, no one-size behaviour.
- Built-in voice engine (web/voice.js, no AI, on the device): composes lines from personality + costume vocabulary + real context; learns per person which styles they act on (Thompson sampling over 6 styles, 10% exploration), their best hours, and never repeats a recent line. Tested: 700 lines, no broken output; 60 nudges → 60 different lines.
- Optional AI voice (supabase/functions/avatar-voice, OFF by default, admin switches on): official Anthropic SDK pinned, default model Claude Opus 5.5 at low effort (switchable to Haiku 5.5 for ~40× lower cost via AI_VOICE_MODEL), refusal fallback on, per-person daily line limit and family monthly cap; sends only persona, intent, chore/room/goal labels and numbers. Falls back to the built-in engine whenever it's off, over a limit, declined or unreachable.
