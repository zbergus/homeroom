import { useState } from "react";
import { verifyAdminToken } from "../lib/api";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";

/**
 * Shown on the home page only while the server requires ADMIN_TOKEN and this browser has none.
 * Verifying before storing keeps a typo from hiding the lock while every write still fails.
 */
export default function AdminUnlock({ onUnlocked }: { onUnlocked: (token: string) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (!(await verifyAdminToken(token.trim()))) {
        setErr("That token was not accepted. It must match the server's ADMIN_TOKEN.");
        return;
      }
      onUnlocked(token.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Control room" subtitle="This server requires an admin token for setup and changes">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-300">
          Your teams, schedule and displays stay available. Enter the server&apos;s admin token to reveal
          settings, automations, horns, delays and diagnostics.
        </p>
        <form onSubmit={(e) => void unlock(e)} className="max-w-xl">
          <Field label="Admin Token" htmlFor="admin-token-input" hint="Stored in this browser only, never sent anywhere except this server.">
            <div className="flex gap-2">
              <input
                id="admin-token-input"
                type="password"
                className={inputCls}
                placeholder="Server ADMIN_TOKEN"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
              />
              <Button variant="primary" type="submit" disabled={busy || token.trim() === ""}>
                {busy ? "Checking…" : "Unlock"}
              </Button>
            </div>
          </Field>
          {err && <div className="mt-3"><Notice kind="err">{err}</Notice></div>}
        </form>
      </div>
    </Card>
  );
}
