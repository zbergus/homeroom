import { useState } from "react";
import { getAdminToken, setAdminToken, verifyAdminToken } from "../lib/api";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";

export default function SecuritySettings({ onTokenChanged }: { onTokenChanged?: (t: string) => void }) {
  const [token, setToken] = useState(() => getAdminToken());
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = token.trim();
    setErr("");
    if (!(await verifyAdminToken(candidate))) {
      setErr("That token was not accepted by this server. Check the value and try again.");
      return;
    }
    onTokenChanged?.(candidate);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clear = () => {
    setToken("");
    setAdminToken("");
    onTokenChanged?.("");
    setErr("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hasToken = token.trim() !== "";

  return (
    <Card
      title="Security & Access"
      subtitle="Only needed if the Homeroom server was started with an ADMIN_TOKEN environment variable."
    >
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        <Field
          label="Admin Token"
          htmlFor="admin-token-input"
          hint="Stored in this browser only. Sent as a Bearer authorization header when saving settings or firing triggers."
        >
          <div className="flex gap-2">
            <input
              id="admin-token-input"
              type="password"
              className={inputCls}
              placeholder="Leave empty if no ADMIN_TOKEN is set"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
            />
            <Button variant="primary" type="submit">
              Save
            </Button>
            {hasToken && (
              <Button variant="danger" type="button" onClick={clear}>
                Clear
              </Button>
            )}
          </div>
        </Field>
        {err && <Notice kind="err">{err}</Notice>}
        {saved && <Notice kind="ok">Token preferences updated for this browser.</Notice>}
      </form>
    </Card>
  );
}
