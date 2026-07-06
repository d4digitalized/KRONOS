import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireWsAdmin } from "@/lib/auth";
import VykazView from "@/components/VykazView";

export const metadata: Metadata = {
  title: "Pracovní výkaz — Toggled",
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
  const user = str(sp.user);
  const from = str(sp.from);
  const to = str(sp.to);
  if (!ws || !user || !DAY_RE.test(from) || !DAY_RE.test(to)) notFound();

  await requireWsAdmin(ws);

  const rateRaw = Number(str(sp.rate));
  const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : null;
  const unit = str(sp.unit) === "hod" ? ("hod" as const) : ("mesic" as const);

  return (
    <VykazView wsId={ws} userId={user} from={from} to={to} rate={rate} unit={unit} />
  );
}
