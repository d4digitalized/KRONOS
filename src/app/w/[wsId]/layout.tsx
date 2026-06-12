import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WorkspaceHeader from "@/components/WorkspaceHeader";
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
        .select("workspace_id, role, workspaces(id, name)")
        .eq("user_id", user.id),
    ]);

  if (!ws) notFound();

  const membership = memberships?.find((m) => m.workspace_id === wsId);
  const isSuperAdmin = profile?.is_super_admin ?? false;
  const isAdmin = isSuperAdmin || membership?.role === "admin";

  const workspaces: Workspace[] = (memberships ?? [])
    .map((m) => m.workspaces as unknown as Workspace)
    .filter(Boolean);
  if (!workspaces.some((w) => w.id === ws.id)) workspaces.unshift(ws);

  return (
    <div className="min-h-screen bg-neutral-50">
      <WorkspaceHeader
        wsId={wsId}
        workspaces={workspaces}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
        userName={profile?.full_name || profile?.email || ""}
      />
      <main className="mx-auto max-w-4xl p-4">{children}</main>
    </div>
  );
}
