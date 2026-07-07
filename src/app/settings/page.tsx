import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NotificationSettings from "@/components/NotificationSettings";
import ApiTokens from "@/components/ApiTokens";

export const metadata: Metadata = {
  title: "Nastavení — Toggled",
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-lg space-y-4 p-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="btn-ghost px-2 py-1 text-sm">
          ← Zpět
        </Link>
        <h1 className="font-display text-lg font-semibold">Nastavení</h1>
      </div>
      <NotificationSettings userId={user.id} />
      <ApiTokens />
    </main>
  );
}
