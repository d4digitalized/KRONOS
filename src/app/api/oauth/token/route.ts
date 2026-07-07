import {
  consumeAuthCode,
  issueRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  verifyPkceS256,
  jsonCors,
  corsPreflight,
} from "@/lib/mcp/oauth";

// OAuth token endpoint. Veřejný klient s PKCE (bez client_secretu).
// authorization_code → access + refresh; refresh_token → rotace.

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

function invalid(desc: string, err = "invalid_grant") {
  return jsonCors({ error: err, error_description: desc }, 400);
}

export async function POST(req: Request) {
  // OAuth token endpoint přijímá application/x-www-form-urlencoded
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return invalid("Tělo musí být form-urlencoded.", "invalid_request");
  }
  const get = (k: string) => String(form.get(k) ?? "");
  const grantType = get("grant_type");
  const clientId = get("client_id");
  if (!clientId) return invalid("Chybí client_id.", "invalid_request");

  if (grantType === "authorization_code") {
    const code = get("code");
    const redirectUri = get("redirect_uri");
    const verifier = get("code_verifier");
    if (!code || !verifier) return invalid("Chybí code nebo code_verifier.", "invalid_request");

    const row = await consumeAuthCode(code);
    if (!row) return invalid("Kód je neplatný, expirovaný nebo použitý.");
    if (row.client_id !== clientId) return invalid("Kód nepatří tomuto klientovi.");
    if (row.redirect_uri !== redirectUri) return invalid("redirect_uri nesouhlasí.");
    if (!verifyPkceS256(verifier, row.code_challenge)) return invalid("PKCE ověření selhalo.");

    const access = signAccessToken(row.user_id);
    const refresh = await issueRefreshToken(clientId, row.user_id);
    return jsonCors({
      access_token: access.token,
      token_type: "Bearer",
      expires_in: access.expiresIn,
      refresh_token: refresh,
      scope: row.scope,
    });
  }

  if (grantType === "refresh_token") {
    const refreshToken = get("refresh_token");
    if (!refreshToken) return invalid("Chybí refresh_token.", "invalid_request");
    const rotated = await rotateRefreshToken(refreshToken, clientId);
    if (!rotated) return invalid("Refresh token je neplatný nebo zrušený.");

    const access = signAccessToken(rotated.userId);
    return jsonCors({
      access_token: access.token,
      token_type: "Bearer",
      expires_in: access.expiresIn,
      refresh_token: rotated.refresh,
    });
  }

  return invalid("Nepodporovaný grant_type.", "unsupported_grant_type");
}
