import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth";
import WorkspacesAdmin from "@/components/WorkspacesAdmin";

export default async function AdminPage() {
  await requireSuperAdmin();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 p-3">
          <span className="font-bold">Toggled</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
            super-admin
          </span>
          <Link href="/" className="ml-auto text-sm text-neutral-500 hover:underline">
            Zpět do aplikace
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="text-lg font-semibold">Workspaces (firmy)</h1>
        <p className="text-sm text-neutral-500">
          Členy a adminy spravuješ uvnitř workspace na záložce Členové.
        </p>
        <WorkspacesAdmin />
      </main>
    </div>
  );
}
