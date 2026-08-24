"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { entrySeconds, fmtClock } from "@/lib/format";
import type { TimeEntry } from "@/lib/types";

const THEME_KEY = "kronos:focus-theme";

/** Celoobrazovkový focus mode (iPad na stole): jen úkol, velký čas a
    Pauza / Stop. Černá nebo bílá — volba se pamatuje v prohlížeči.
    Snaží se o skutečný fullscreen a drží obrazovku vzhůru (wake lock);
    obojí best-effort, kde to prohlížeč neumí, zůstane aspoň overlay. */
export default function FocusMode({
  running,
  accumSeconds,
  title,
  projectName,
  busy,
  onPause,
  onResume,
  onStop,
  onClose,
}: {
  running: TimeEntry | null;
  /** sečtené dřívější úseky téhle seance (před pauzami) */
  accumSeconds: number;
  title: string;
  projectName: string | null;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved) setDark(saved !== "light");
    } catch {}
  }, []);

  function toggleTheme() {
    setDark((d) => {
      try {
        localStorage.setItem(THEME_KEY, d ? "light" : "dark");
      } catch {}
      return !d;
    });
  }

  // skutečný fullscreen (iPadOS 16.4+ ho na Safari umí) — best effort
  useEffect(() => {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
    } catch {}
    return () => {
      try {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      } catch {}
    };
  }, []);

  // wake lock: ať iPad při běžícím timeru nezhasne; po probuzení znovu
  useEffect(() => {
    type Lock = { release: () => Promise<void> } | null;
    let lock: Lock = null;
    let disposed = false;
    async function acquire() {
      try {
        const wl = (navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<NonNullable<Lock>> };
        }).wakeLock;
        if (!wl) return;
        lock = await wl.request("screen");
      } catch {}
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && !disposed) acquire();
    };
    acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  // Esc zavře focus mode (první Esc případně ukončí fullscreen prohlížeče)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const paused = !running;
  const seconds =
    accumSeconds + (running ? entrySeconds(running.started_at, null) : 0);
  const frame = dark ? "bg-black text-white" : "bg-white text-black";
  const soft = dark ? "text-white/50" : "text-black/50";
  const ghostBtn = `rounded-full border px-4 py-2 text-sm transition-colors ${
    dark
      ? "border-white/25 text-white/80 hover:border-white/60"
      : "border-black/25 text-black/70 hover:border-black/60"
  }`;

  // portál do <body>: lišta je sticky se z-40 (vlastní stacking context),
  // uvnitř ní by overlay překrýval obsah stránky
  return createPortal(
    <div
      className={`fixed inset-0 z-[100] flex flex-col ${frame}`}
      role="dialog"
      aria-modal="true"
      aria-label="Focus mode"
    >
      {/* horní lišta: motiv + zavřít */}
      <div className="flex items-center justify-between p-4 sm:p-6">
        <button
          onClick={toggleTheme}
          aria-label={dark ? "Přepnout na bílou" : "Přepnout na černou"}
          className={ghostBtn}
        >
          {dark ? "☀ bílá" : "● černá"}
        </button>
        <button
          onClick={onClose}
          aria-label="Zavřít focus mode"
          className={ghostBtn}
        >
          ✕
        </button>
      </div>

      {/* střed: projekt, úkol, čas */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        {projectName && (
          <p className={`text-sm sm:text-base ${soft}`}>{projectName}</p>
        )}
        <p className="max-w-3xl text-2xl font-semibold leading-snug sm:text-4xl">
          {title}
        </p>
        <p
          className={`font-mono text-[clamp(4rem,18vw,11rem)] font-semibold leading-none tabular-nums ${
            paused ? "opacity-40" : ""
          }`}
        >
          {fmtClock(seconds)}
        </p>
        <p className={`h-6 text-sm uppercase tracking-[0.3em] ${soft}`}>
          {paused ? "pauza" : ""}
        </p>
      </div>

      {/* ovládání: pauza/pokračovat + stop */}
      <div className="flex items-center justify-center gap-8 pb-12 sm:pb-16">
        <button
          onClick={paused ? onResume : onPause}
          disabled={busy}
          aria-label={paused ? "Pokračovat v měření" : "Pozastavit měření"}
          className={`flex h-20 w-20 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-50 ${
            dark
              ? "border-white/40 text-white hover:border-white"
              : "border-black/40 text-black hover:border-black"
          }`}
        >
          {paused ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="ml-1 h-8 w-8" aria-hidden>
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          ) : (
            <span className="flex gap-1.5" aria-hidden>
              <span className="block h-7 w-2 rounded-sm bg-current" />
              <span className="block h-7 w-2 rounded-sm bg-current" />
            </span>
          )}
        </button>
        <button
          onClick={onStop}
          disabled={busy}
          aria-label="Zastavit a uložit záznam"
          className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-colors hover:bg-red-500 disabled:opacity-50"
        >
          <span className="block h-7 w-7 rounded-[3px] bg-current" aria-hidden />
        </button>
      </div>
    </div>,
    document.body
  );
}
