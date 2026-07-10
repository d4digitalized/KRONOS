import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DelegatedView from "@/components/DelegatedView";

export default async function DelegatedPage({
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

  return <DelegatedView wsId={wsId} userId={user.id} />;
}
