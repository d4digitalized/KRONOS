import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MyTasksView from "@/components/MyTasksView";

export default async function MyTasksPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: ws }] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email, tag_name, avatar_initials, avatar_color")
      .eq("id", user.id)
      .single(),
    supabase.from("workspaces").select("name").eq("id", wsId).single(),
  ]);

  const heading = profile?.tag_name
    ? `@${profile.tag_name}`
    : profile?.full_name || profile?.email || "Moje úkoly";

  return (
    <MyTasksView
      wsId={wsId}
      userId={user.id}
      heading={`${heading} v ${ws?.name ?? "Kronos."}`}
      profile={profile}
    />
  );
}
