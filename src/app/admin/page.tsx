import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import WorkspacesAdmin from "@/components/WorkspacesAdmin";
import InviteToWorkspacesAdmin from "@/components/InviteToWorkspacesAdmin";

export default async function AdminPage() {
  await requireSuperAdmin();

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-4 p-3">
          <span className="font-bold">
            Kronos<span className="text-accent">.</span>
          </span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
            super-admin
          </span>
          <Link href="/" className="ml-auto text-sm text-ink-soft hover:underline">
            Zpět do aplikace
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="text-lg font-semibold">Pozvat uživatele do firem</h1>
        <p className="text-sm text-ink-soft">
          Jeden e-mail, výběr více firem najednou. Jednotlivě členy spravuješ
          uvnitř workspace na záložce Členové.
        </p>
        <InviteToWorkspacesAdmin />

        <h1 className="text-lg font-semibold">Workspaces (firmy)</h1>
        <WorkspacesAdmin />
      </main>
    </div>
  );
}
