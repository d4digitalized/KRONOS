import { redirect } from "next/navigation";
import { getWsContext } from "@/lib/session";
import MyTimeView from "@/components/MyTimeView";
import PercentReportView from "@/components/PercentReportView";

export default async function MyTimePage({
  params,
}: {
  params: Promise<{ wsId: string }>;
}) {
  const { wsId } = await params;
  const ctx = await getWsContext(wsId);
  if (!ctx) redirect("/login");

  // režim „Výkaz v %": místo timeru a ručních záznamů procentní denní výkaz
  if (ctx.membership?.percent_report) {
    return <PercentReportView wsId={wsId} userId={ctx.user.id} />;
  }

  return <MyTimeView wsId={wsId} userId={ctx.user.id} />;
}
