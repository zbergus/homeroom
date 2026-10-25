import { useState } from "react";
import { getAdminToken, setAdminToken } from "../lib/api";
import { Button, Card, Field, inputCls, Notice } from "../components/ui";

export default function SecuritySettings({ onTokenChanged }: { onTokenChanged?: (t: string) => void }) {
  const [token, setToken] = useState(() => getAdminToken());
  const [saved, setSaved] = useState(false);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setAdminToken(token.trim());
    onTokenChanged?.(token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clear = () => {
    setToken("");
    setAdminToken("");
    onTokenChanged?.("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const hasToken = token.trim() !== "";

  return (
    <Card
      title="Security & Access"
      subtitle="Only needed if the Homeroom server was started with an ADMIN_TOKEN environment variable."
    >
      <form onSubmit={save} className="flex flex-col gap-4">
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
        {saved && <Notice kind="ok">Token preferences updated for this browser.</Notice>}
      </form>
    </Card>
  );
}
