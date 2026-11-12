// Supabase Edge Function: kid-login
// A child signs in with username + password (+ this device's id). No email is ever used or sent.
// Deploy with "Verify JWT" OFF (the child isn't signed in yet). Secrets come from the function's own
// environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); nothing secret is in this file.
// Flow: kid_auth() checks password/lockout/device → (first time) create a hidden auth user with a
// placeholder address on the reserved .invalid domain (never deliverable) → return a one-time sign-in
// token the app exchanges for a normal session.

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGINS = ["https://lorneh12.github.io", "http://localhost:8080"];

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) } });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const h = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: h });
  let body: { username?: string; password?: string; device_id?: string };
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "Bad request" }), { status: 400, headers: h }); }
  const username = String(body.username || "").slice(0, 20), password = String(body.password || "").slice(0, 40), device = String(body.device_id || "").slice(0, 64);
  if (!username || !password) return new Response(JSON.stringify({ error: "Enter your username and password" }), { status: 400, headers: h });

  const r = await admin("/rest/v1/rpc/kid_auth", { method: "POST", body: JSON.stringify({ uname: username, pass: password, device }) });
  const rows = await r.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.error) return new Response(JSON.stringify({ error: row?.error || "Sign-in failed" }), { status: 401, headers: h });

  const email = `kid-${row.member_id}@family-chores.invalid`;
  let uid: string | null = row.user_id;
  if (!uid) {
    const cu = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({
      email, email_confirm: true, password: crypto.randomUUID() + crypto.randomUUID(), user_metadata: { kind: "child" } }) });
    const u = await cu.json();
    if (!cu.ok || !u.id) return new Response(JSON.stringify({ error: "Could not create the sign-in" }), { status: 500, headers: h });
    uid = u.id;
    await admin("/rest/v1/rpc/link_kid_user", { method: "POST", body: JSON.stringify({ member: row.member_id, uid }) });
  }
  // One-time token (no email is sent by generate_link).
  const gl = await admin("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "magiclink", email }) });
  const link = await gl.json();
  const token_hash = link.hashed_token || link.properties?.hashed_token;
  if (!gl.ok || !token_hash) return new Response(JSON.stringify({ error: "Could not sign in" }), { status: 500, headers: h });
  return new Response(JSON.stringify({ token_hash }), { headers: h });
});
