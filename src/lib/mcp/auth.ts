import crypto from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Osobní API tokeny pro MCP. Tok: plain token z hlavičky → hash → resolve na
// user_id (RPC, anon) → podpis krátkodobého Supabase JWT → klient jednající za
// toho uživatele. Od té chvíle auth.uid() = uživatel a veškerá RLS platí sama.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Nový plain token — ukáže se uživateli jen jednou, ukládáme jen jeho hash. */
export function generateToken(): string {
  return "tgl_" + crypto.randomBytes(32).toString("base64url");
}

/** SHA-256 hex; do DB jde jen tohle, nikdy plain token. */
export function hashToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

/** Plain token → user_id, nebo null (neplatný / zrušený). Orazítkuje last_used_at. */
export async function resolveToken(plain: string): Promise<string | null> {
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.rpc("resolve_api_token", {
    p_hash: hashToken(plain),
  });
  if (error || !data) return null;
  return data as string;
}

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

/** Krátkodobý Supabase-kompatibilní JWT (HS256) jednající za daného uživatele. */
function signUserJwt(userId: string): string {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET není nastaven");

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + 600, // 10 min stačí na jedno volání nástroje
    })
  );
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Supabase klient jednající za uživatele — všechny dotazy nástrojů jdou přes něj. */
export function createUserClient(userId: string): SupabaseClient {
  const jwt = signUserJwt(userId);
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
