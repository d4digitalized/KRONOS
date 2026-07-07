import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { resolveToken } from "@/lib/mcp/auth";
import { verifyAccessToken } from "@/lib/mcp/oauth";
import { registerTools } from "@/lib/mcp/tools";

// Remote MCP server Toggled. Endpoint: /api/mcp (streamable HTTP, stateless).
// Autorizace osobním API tokenem → identita uživatele → RLS řeší zbytek.

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "toggled", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, verboseLogs: false }
);

async function verifyToken(
  _req: Request,
  bearer?: string
): Promise<AuthInfo | undefined> {
  if (!bearer) return undefined;
  // OAuth access token (web/mobil Claude) NEBO osobní token (Claude Code) → user_id
  const userId = verifyAccessToken(bearer) ?? (await resolveToken(bearer));
  if (!userId) return undefined;
  return { token: bearer, clientId: "toggled-mcp", scopes: [], extra: { userId } };
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
export const maxDuration = 60;
