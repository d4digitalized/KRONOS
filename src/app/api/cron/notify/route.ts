// Ruční/záložní vyvolání odeslání fronty (Bearer CRON_SECRET).
// Běžně e-maily odchází hned po akci přes /api/notify/run.

import { NextResponse } from "next/server";
import { drainNotifications } from "@/lib/notify-drain";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return NextResponse.json(await drainNotifications());
}
