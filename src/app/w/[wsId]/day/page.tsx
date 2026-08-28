import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { redirectTimeOnlyMember } from "@/lib/auth";
import MyDayView from "@/components/MyDayView";

export default async function MyDayPage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  await redirectTimeOnlyMember(wsId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <MyDayView userId={user.id} />;
}
