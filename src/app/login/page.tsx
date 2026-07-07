"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkError = searchParams.get("error") === "link";
  // návrat po přihlášení — jen relativní cesta (ne protocol-relative), ať to nejde zneužít k open redirectu
  const nextParam = searchParams.get("next");
  const dest =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")
      ? nextParam
      : "/";

  const [mode, setMode] = useState<"login" | "reset" | "reset-sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("Přihlášení se nezdařilo. Zkontroluj e-mail a heslo.");
      setLoading(false);
      return;
    }
    router.push(dest);
    router.refresh();
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setLoading(false);
    if (error) {
      setError("Odkaz se nepodařilo odeslat. Zkus to za chvíli znovu.");
      return;
    }
    setMode("reset-sent");
  }

  if (mode === "reset-sent") {
    return (
      <div className="w-full max-w-sm space-y-4 panel p-8 shadow-sm">
        <h1 className="font-display text-2xl font-bold">
          Toggled<span className="text-accent">.</span>
        </h1>
        <p className="text-sm">
          Pokud účet pro <span className="font-medium">{email}</span> existuje,
          poslali jsme na něj odkaz pro nastavení nového hesla.
        </p>
        <button onClick={() => setMode("login")} className="btn-ghost px-0">
          ← Zpět na přihlášení
        </button>
      </div>
    );
  }

  const isReset = mode === "reset";

  return (
    <form
      onSubmit={isReset ? handleReset : handleLogin}
      className="w-full max-w-sm space-y-4 panel p-8 shadow-sm"
    >
      <h1 className="font-display text-2xl font-bold">
        Toggled<span className="text-accent">.</span>
      </h1>
      <p className="text-sm text-ink-soft">
        {isReset
          ? "Zadej e-mail účtu a pošleme ti odkaz pro nastavení nového hesla."
          : "Přihlas se. Účet vzniká pozvánkou od admina."}
      </p>
      {linkError && !isReset && (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800">
          Odkaz z e-mailu už není platný. Přihlas se, požádej o novou pozvánku,
          nebo si nech poslat odkaz pro nastavení hesla.
        </p>
      )}
      <label className="block">
        <span className="text-sm font-medium">E-mail</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mt-1 w-full px-3 py-2"
        />
      </label>
      {!isReset && (
        <label className="block">
          <span className="text-sm font-medium">Heslo</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mt-1 w-full px-3 py-2"
          />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
        {loading
          ? "Pracuji…"
          : isReset
            ? "Poslat odkaz na nové heslo"
            : "Přihlásit se"}
      </button>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode(isReset ? "login" : "reset");
        }}
        className="w-full text-center text-sm text-ink-soft hover:text-accent"
      >
        {isReset ? "← Zpět na přihlášení" : "Zapomenuté heslo?"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
