import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

// OAuth 2.1 Authorization Server pro MCP. Access token je podepsaný JWT
// (nese user_id), který resource server ověří bez DB. Auth kódy a refresh
// tokeny drží DB (jen hashe) přes service role. PKCE S256 je povinné.

const ACCESS_TTL = 3600; // s
const CODE_TTL_MS = 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;

// ---------------------------------------------------------------- crypto

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

/** PKCE: challenge = base64url(sha256(verifier)). */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const computed = crypto.createHash("sha256").update(verifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Podepíše access token (JWT) nesoucí user_id. */
export function signAccessToken(userId: string): { token: string; expiresIn: number } {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error("SUPABASE_JWT_SECRET není nastaven");
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: userId, tk: "mcp_oauth", iat: now, exp: now + ACCESS_TTL })
  );
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return { token: `${data}.${sig}`, expiresIn: ACCESS_TTL };
}

/** Ověří access token → user_id, nebo null. */
export function verifyAccessToken(token: string): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest("base64url");
  const sig = Buffer.from(parts[2]);
  const exp = Buffer.from(expected);
  if (sig.length !== exp.length || !crypto.timingSafeEqual(sig, exp)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (p.tk !== "mcp_oauth") return null;
    if (typeof p.exp === "number" && p.exp < Math.floor(Date.now() / 1000)) return null;
    return typeof p.sub === "string" ? p.sub : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- DB (service role)

function admin() {
  return createAdminClient();
}

export type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
};

export async function registerOAuthClient(
  name: string,
  redirectUris: string[]
): Promise<string> {
  const clientId = "mcp_" + crypto.randomBytes(16).toString("base64url");
  const { error } = await admin()
    .from("oauth_clients")
    .insert({
      client_id: clientId,
      client_name: (name || "MCP client").slice(0, 120),
      redirect_uris: redirectUris,
    });
  if (error) throw new Error(error.message);
  return clientId;
}

export async function getOAuthClient(clientId: string): Promise<OAuthClient | null> {
  const { data } = await admin()
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as OAuthClient) ?? null;
}

export async function issueAuthCode(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string | null;
}): Promise<string> {
  const plain = randomToken();
  const { error } = await admin().from("oauth_auth_codes").insert({
    code_hash: sha256(plain),
    client_id: params.clientId,
    user_id: params.userId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    scope: params.scope,
    resource: params.resource,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return plain;
}

type AuthCodeRow = {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  resource: string | null;
};

/** Jednorázově vybere a znehodnotí platný auth kód. Null = neplatný/expirovaný/použitý. */
export async function consumeAuthCode(plain: string): Promise<AuthCodeRow | null> {
  const nowIso = new Date().toISOString();
  const { data } = await admin()
    .from("oauth_auth_codes")
    .update({ consumed_at: nowIso })
    .eq("code_hash", sha256(plain))
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("client_id, user_id, redirect_uri, code_challenge, scope, resource")
    .maybeSingle();
  return (data as AuthCodeRow) ?? null;
}

export async function issueRefreshToken(
  clientId: string,
  userId: string
): Promise<string> {
  const plain = randomToken();
  await admin().from("oauth_refresh_tokens").insert({
    token_hash: sha256(plain),
    client_id: clientId,
    user_id: userId,
    expires_at: new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
  });
  return plain;
}

/** Rotace: znehodnotí starý refresh a vydá nový. Null = neplatný. */
export async function rotateRefreshToken(
  plain: string,
  clientId: string
): Promise<{ userId: string; refresh: string } | null> {
  const nowIso = new Date().toISOString();
  const { data } = await admin()
    .from("oauth_refresh_tokens")
    .update({ revoked_at: nowIso })
    .eq("token_hash", sha256(plain))
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .gt("expires_at", nowIso)
    .select("user_id")
    .maybeSingle();
  if (!data) return null;
  const refresh = await issueRefreshToken(clientId, data.user_id as string);
  return { userId: data.user_id as string, refresh };
}

// ---------------------------------------------------------------- HTTP / CORS

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
};

export function jsonCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
