import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role klient — POUZE na serveru (pozvánky, lookup uživatele podle e-mailu).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
