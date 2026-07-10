"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { notifyTasksChanged } from "@/lib/tasksChanged";

// Dialog se dogeneruje až při otevření — nezatěžuje bundle každé stránky.
const NewTaskDialog = dynamic(() => import("@/components/NewTaskDialog"), {
  ssr: false,
});

/** Plovoucí „+" pro rychlé založení úkolu. Visí v layoutu, je tedy všude. */
export default function NewTaskFab({
  wsId,
  userId,
  canDelegate = false,
  canHide = false,
}: {
  wsId: string;
  userId: string;
  canDelegate?: boolean;
  canHide?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Přidat úkol"
        title="Přidat úkol"
        // na mobilu nad tab-barem, od md už u spodní hrany
        className="fixed bottom-24 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg transition hover:bg-[#0a5d54] hover:shadow-xl active:scale-95 md:bottom-6"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {open && (
        <NewTaskDialog
          wsId={wsId}
          userId={userId}
          canDelegate={canDelegate}
          canHide={canHide}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            notifyTasksChanged();
          }}
        />
      )}
    </>
  );
}
