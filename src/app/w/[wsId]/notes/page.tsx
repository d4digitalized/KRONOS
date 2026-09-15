import { redirect } from "next/navigation";
import { redirectTimeOnlyMember } from "@/lib/auth";
import NotesView from "@/components/NotesView";

export default async function NotesPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const { user, canNotes } = await redirectTimeOnlyMember(wsId);

  // funkci musí mít odemčenou admin (flag can_notes); jinak zpět na Priority list
  if (!canNotes) redirect(`/w/${wsId}/priority`);

  return <NotesView wsId={wsId} userId={user.id} />;
}
