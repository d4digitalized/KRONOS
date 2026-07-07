"use server";

import { createClient } from "@/lib/supabase/server";
import { generateToken, hashToken } from "@/lib/mcp/auth";

// Vytvoření osobního MCP tokenu. Plain token vzniká a hashuje se na serveru,
// do DB jde jen hash a klientovi se plain vrací JEDNOU. Insert běží pod
// user-scoped klientem, takže RLS vynutí user_id = auth.uid().
export async function createApiToken(
  name: string
): Promise<{ plain?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Nejsi přihlášený." };

  const plain = generateToken();
  const { error } = await supabase.from("api_tokens").insert({
    name: name.trim().slice(0, 60) || "Claude",
    token_hash: hashToken(plain),
  });
  if (error) return { error: "Token se nepodařilo vytvořit." };
  return { plain };
}
