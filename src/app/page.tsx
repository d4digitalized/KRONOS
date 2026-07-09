import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (memberships && memberships.length > 0) {
    redirect(`/w/${memberships[0].workspace_id}/my`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();

  if (profile?.is_super_admin) redirect("/admin");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <p className="text-ink-soft">
        Zatím nejsi členem žádného workspace. Požádej admina o pozvánku.
      </p>
    </main>
  );
}
