import { createClient } from "@/lib/supabase/server";
import MyTimeView from "@/components/MyTimeView";
import PercentReportView from "@/components/PercentReportView";

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

  // režim „Výkaz v %": místo timeru a ručních záznamů procentní denní výkaz
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("percent_report")
    .eq("workspace_id", wsId)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (membership?.percent_report) {
    return <PercentReportView wsId={wsId} userId={user!.id} />;
  }

  return <MyTimeView wsId={wsId} userId={user!.id} />;
}
