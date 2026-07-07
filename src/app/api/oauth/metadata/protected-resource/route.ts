import { getPublicOrigin } from "mcp-handler";
import { jsonCors, corsPreflight } from "@/lib/mcp/oauth";

// RFC 9728 Protected Resource Metadata. Servírováno i na
// /.well-known/oauth-protected-resource (přes rewrite v next.config).
// Ukazuje klientovi, který Authorization Server použít (náš vlastní origin).

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export function GET(req: Request) {
  const origin = getPublicOrigin(req);
  return jsonCors({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["mcp"],
    resource_name: "Toggled",
    bearer_methods_supported: ["header"],
  });
}
