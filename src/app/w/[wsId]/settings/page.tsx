import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import NotificationSettings from "@/components/NotificationSettings";
import ApiTokens from "@/components/ApiTokens";

export const metadata: Metadata = {
  title: "Nastavení — Kronos.",
};

// Osobní nastavení (notifikace, MCP tokeny) — platí napříč firmami, ale
// stránka žije uvnitř firmy kvůli postrannímu panelu a mobilní navigaci.
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="w-full max-w-2xl space-y-4">
      <h1 className="font-display text-lg font-semibold">Nastavení</h1>
      <NotificationSettings userId={user.id} />
      <ApiTokens />
    </div>
  );
}
