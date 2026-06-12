import { createClient } from "@/lib/supabase/server";
import MyTimeView from "@/components/MyTimeView";

export default async function MyTimePage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <MyTimeView wsId={wsId} userId={user!.id} />;
}
