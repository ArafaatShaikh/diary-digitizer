"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";
export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setStatus(
        "This reset link has expired. Request another from the sign-in page.",
      );
      setBusy(false);
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    setStatus(
      error ? error.message : "Password updated. You can open your archive.",
    );
  }
  return (
    <main className="auth">
      <h1>Choose a new password</h1>
      <form className="stack" onSubmit={submit}>
        <label>
          New password
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        <button disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
        {status && <p role="status">{status}</p>}
        <Link href="/">Open your archive</Link>
      </form>
    </main>
  );
}
