import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWsMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import VykazView from "@/components/VykazView";

export const metadata: Metadata = {
  title: "Pracovní výkaz — Kronos",
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function VykazPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

  const ws = str(sp.ws);
  const userParam = str(sp.user);
  const from = str(sp.from);
  const to = str(sp.to);
  if (!ws || !userParam || !DAY_RE.test(from) || !DAY_RE.test(to)) notFound();

  const { user, isAdmin } = await requireWsMember(ws);

  // Běžný člen si smí vytáhnout jen svůj výkaz a bez sazby (jen hodiny).
  // Admin může kohokoli a se sazbou; HR své přidělené lidi (hr_grants), bez sazby.
  let userId = isAdmin ? userParam : user.id;
  if (!isAdmin && userParam !== user.id) {
    const supabase = await createClient();
    const [{ data: grant }, { data: me }] = await Promise.all([
      supabase
        .from("hr_grants")
        .select("target_id")
        .eq("workspace_id", ws)
        .eq("user_id", user.id)
        .eq("target_id", userParam)
        .maybeSingle(),
      supabase
        .from("workspace_members")
        .select("can_hr")
        .eq("workspace_id", ws)
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    if (grant && me?.can_hr) userId = userParam;
  }

  const rateRaw = Number(str(sp.rate));
  const rate =
    isAdmin && Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : null;
  const unit = str(sp.unit) === "hod" ? ("hod" as const) : ("mesic" as const);

  return (
    <VykazView wsId={ws} userId={userId} from={from} to={to} rate={rate} unit={unit} />
  );
}
