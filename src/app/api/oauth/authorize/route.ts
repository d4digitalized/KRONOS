import { createClient } from "@/lib/supabase/server";
import { getPublicOrigin } from "mcp-handler";
import { getOAuthClient, issueAuthCode } from "@/lib/mcp/oauth";

// Finalizace consentu. Ověří session + klienta + redirect_uri (nikdy nevěří
// skrytým polím naslepo), pak vydá auth kód a přesměruje na redirect_uri.

export const dynamic = "force-dynamic";

function redirectTo(base: string, params: Record<string, string>): Response {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return Response.redirect(u.toString(), 302);
}

export async function POST(req: Request) {
  // CSRF: povol jen POST ze stejného originu (navíc k SameSite cookies)
  const origin = req.headers.get("origin");
  if (origin && origin !== getPublicOrigin(req)) {
    return new Response("Cross-origin request blokován.", { status: 403 });
  }

  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? "");
  const action = get("action");
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const state = get("state");

  const client = clientId ? await getOAuthClient(clientId) : null;
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return new Response("Neplatný klient nebo redirect_uri.", { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Nepřihlášen.", { status: 401 });

  if (action !== "approve") {
    return redirectTo(redirectUri, { error: "access_denied", state });
  }

  const code = await issueAuthCode({
    clientId,
    userId: user.id,
    redirectUri,
    codeChallenge: get("code_challenge"),
    scope: get("scope"),
    resource: get("resource") || null,
  });

  return redirectTo(redirectUri, { code, state });
}
