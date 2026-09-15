import { redirect } from "next/navigation";
import { getWsContext } from "@/lib/session";
import MembersView from "@/components/MembersView";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const ctx = await getWsContext(wsId);
  if (!ctx) redirect("/login");
  if (!ctx.isAdmin) redirect(`/w/${wsId}`);

  return (
    <MembersView
      wsId={wsId}
      currentUserId={ctx.user.id}
      isSuperAdmin={ctx.isSuperAdmin}
    />
  );
}
