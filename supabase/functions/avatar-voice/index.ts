// Supabase Edge Function: avatar-voice (OPTIONAL AI voice; the app falls back to its built-in voice engine).
// Deploy with "Verify JWT" ON. Secrets (set by an admin in Edge Functions → Secrets; never in chat or code):
//   ANTHROPIC_API_KEY  (required)
//   AI_VOICE_MODEL     (optional; default claude-opus-5-5, e.g. claude-haiku-5-5 for lower cost)
// Privacy: Claude receives ONLY the avatar's personality/costume, the intent, chore/room/goal labels and numbers.
// Never real names, photos, messages, or anything about the person beyond what the avatar needs to speak.
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = Deno.env.get("AI_VOICE_MODEL") || "claude-opus-5-5";
// $ per million tokens (input, output) for the cost ledger; keep in step with current pricing
const PRICE: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
const ALLOWED = ["https://lorneh12.github.io", "http://localhost:8080"];
const INTENTS = ["nudge", "start", "progress", "praise", "streak", "recover", "overload", "checkpoint", "celebrate", "working", "greet", "teamwork"];
const PERSONALITIES = ["goofy", "hype", "dramatic", "chill", "bossy", "cheerful", "shy"];
const OUTFITS = ["bear", "gym", "cape", "hoodie", "apron", "robe", "custom"];
const client = Deno.env.get("ANTHROPIC_API_KEY") ? new Anthropic() : null;   // reads ANTHROPIC_API_KEY

const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && ALLOWED.includes(o) ? o : ALLOWED[0],
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" });
const svc = (path: string, init: RequestInit = {}) => fetch(`${URL_}${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) } });
const clean = (s: unknown, n = 60) => String(s ?? "").replace(/[^\p{L}\p{N} $%.,:'!?&\-]/gu, "").slice(0, n);

const SYSTEM = `You write ONE short line spoken by a cartoon avatar in a family chores app, to the person who owns that avatar.
Voice rules:
- Speak fully in the avatar's personality and costume. Fun, warm, specific to the details given. Vary your wording; never generic.
- The person owns their choices. Encourage, invite, celebrate. Never order, guilt, shame, threaten, or compare them to others.
- Never suggest asking anyone for help or asking a parent. If options are given, present them as the person's choices ("Your call: …").
- Max 28 words. Plain words a 6-year-old can follow. At most one emoji. No hashtags. No quotes around the line.
- Use only the facts given. Never invent money amounts, dates, people or promises.
Reply with the line only.`;

Deno.serve(async (req) => {
  const h = { ...cors(req.headers.get("origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const fallback = (why: string, status = 200) => new Response(JSON.stringify({ text: null, fallback: true, why }), { status, headers: h });
  if (!client) return fallback("ai_not_configured");

  // who is calling (their own session), and is the AI voice on and under limits for them?
  const me = await fetch(`${URL_}/rest/v1/rpc/my_member`, { method: "POST", headers: { apikey: SERVICE, Authorization: req.headers.get("authorization") || "", "Content-Type": "application/json" }, body: "{}" });
  const memberId = me.ok ? await me.json() : null;
  if (!memberId) return fallback("not_signed_in", 401);
  const gate = await svc("/rest/v1/rpc/ai_voice_allowed", { method: "POST", body: JSON.stringify({ member: memberId }) });
  if (!gate.ok || (await gate.json()) !== true) return fallback("ai_off_or_limit");

  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return fallback("bad_request", 400); }
  const intent = INTENTS.includes(String(b.intent)) ? String(b.intent) : "nudge";
  const persona = { personality: PERSONALITIES.includes(String(b.personality)) ? b.personality : "cheerful",
    outfit: OUTFITS.includes(String(b.outfit)) ? b.outfit : "custom", avatarName: clean(b.avatarName, 24) };
  const ctx = { chore: clean(b.chore), room: clean(b.room, 30), goal: clean(b.goal), money: clean(b.money, 12), pct: clean(b.pct, 4), left: clean(b.left, 20),
    when: clean(b.when, 24), streak: clean(b.streak, 4), style: clean(b.style, 20),
    options: Array.isArray(b.options) ? (b.options as unknown[]).slice(0, 3).map(o => clean(o, 70)) : [] };
  const user = `Avatar: ${persona.avatarName || "the avatar"}, personality ${persona.personality}, costume ${persona.outfit}.
Intent: ${intent}. Style this person responds to: ${ctx.style || "unknown"}.
Facts: ${JSON.stringify(ctx)}`;

  const isHaiku = MODEL.startsWith("claude-haiku");
  let text = "", inT = 0, outT = 0;
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,                                   // thinking is on for current models; leave room so the line isn't cut off
      output_config: { effort: "low" },                   // a one-liner doesn't need deep reasoning
      ...(isHaiku ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),   // re-run on Anthropic's recommended model if declined
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
    inT = response.usage?.input_tokens || 0; outT = response.usage?.output_tokens || 0;
    if (response.stop_reason === "refusal") return fallback("declined");
    for (const block of response.content) if (block.type === "text") text += block.text;
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return fallback("rate_limited");
    if (error instanceof Anthropic.AuthenticationError) return fallback("ai_key_invalid");
    if (error instanceof Anthropic.APIError) return fallback("ai_error_" + error.status);
    return fallback("ai_unreachable");
  }
  text = text.replace(/^["']|["']$/g, "").slice(0, 220).trim();

  const fam = await svc(`/rest/v1/members?select=family_id&id=eq.${memberId}`); const famId = (await fam.json())?.[0]?.family_id;
  const [pi, po] = PRICE[MODEL] || PRICE["claude-opus-5-5"];
  await svc("/rest/v1/ai_usage", { method: "POST", body: JSON.stringify({ family_id: famId, member_id: memberId, input_tokens: inT, output_tokens: outT,
    est_cost_micro: Math.ceil(inT * pi + outT * po) }) });   // tokens × $/M = millionths of a dollar
  if (!text || /ask (a |your )?(parent|mom|dad|someone|for help)/i.test(text)) return fallback("filtered");
  return new Response(JSON.stringify({ text, fallback: false }), { headers: h });
});
