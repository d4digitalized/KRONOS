import { getPublicOrigin } from "mcp-handler";
import { jsonCors, corsPreflight } from "@/lib/mcp/oauth";

// RFC 8414 Authorization Server Metadata. Servírováno i na
// /.well-known/oauth-authorization-server (přes rewrite v next.config).

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export function GET(req: Request) {
  const origin = getPublicOrigin(req);
  return jsonCors({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  });
}
