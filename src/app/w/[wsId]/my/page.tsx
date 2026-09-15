import { redirectTimeOnlyMember } from "@/lib/auth";
import MyTasksView from "@/components/MyTasksView";

export default async function MyTasksPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user, profile, ws } = await redirectTimeOnlyMember(wsId);

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
