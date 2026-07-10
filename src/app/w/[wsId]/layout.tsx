import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import TimerBar from "@/components/TimerBar";
import NewTaskFab from "@/components/NewTaskFab";
import type { Workspace } from "@/lib/types";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: ws }, { data: memberships }] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("workspaces").select("id, name").eq("id", wsId).maybeSingle(),
      supabase
        .from("workspace_members")
        .select("*, workspaces(id, name)")
        .eq("user_id", user.id),
    ]);

  if (!ws) notFound();

  const membership = memberships?.find((m) => m.workspace_id === wsId);
  const isSuperAdmin = profile?.is_super_admin ?? false;
  const isAdmin = isSuperAdmin || membership?.role === "admin";
  // funkce navíc: adminům vždy, členům dle flagů odemčených adminem
  const canDelegate = isAdmin || !!membership?.can_delegate;
  const canHide = isAdmin || !!membership?.can_hide;

  const workspaces: Workspace[] = (memberships ?? [])
    .map((m) => m.workspaces as unknown as Workspace)
    .filter(Boolean);
  if (!workspaces.some((w) => w.id === ws.id)) workspaces.unshift(ws);

  return (
    <div className="flex min-h-screen bg-paper">
      <Sidebar
        wsId={wsId}
        workspaces={workspaces}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        canDelegate={canDelegate}
        userName={profile?.full_name || profile?.email || ""}
        userProfile={profile}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TimerBar wsId={wsId} userId={user.id} />
        {/* spodní padding drží obsah nad mobilním tab-barem (jen pod md) */}
        <main className="flex-1 space-y-4 p-4 pb-24 md:pb-4">{children}</main>
      </div>
      <MobileNav
        wsId={wsId}
        workspaces={workspaces}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        canDelegate={canDelegate}
        userName={profile?.full_name || profile?.email || ""}
        userProfile={profile}
      />
      <NewTaskFab
        wsId={wsId}
        userId={user.id}
        canDelegate={canDelegate}
        canHide={canHide}
      />
    </div>
  );
}
