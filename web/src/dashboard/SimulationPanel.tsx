import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { errMsg } from "../lib/errors";
import { Button, Card, Notice } from "../components/ui";

export type SimStatus = {
  active: boolean;
  game_id?: string | undefined;
  started_at?: number | undefined;
  ends_at?: number | undefined;
  step_index?: number | undefined;
};

interface Props {
  onChange?: ((s: SimStatus) => void) | undefined;
}

export default function SimulationPanel({ onChange }: Props) {
  const [sim, setSim] = useState<SimStatus>({ active: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.simulation();
      setSim(s);
      onChange?.(s);
    } catch {
      /* ignore poll errors */
    }
  }, [onChange]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  const start = async () => {
    setBusy(true); setMsg(null);
    try {
      const s = await api.simulationStart();
      setSim(s);
      onChange?.(s);
      setMsg({ k: "ok", t: "NHL simulation started. Real horns, TTS and lights will fire. Auto-stops in 10 minutes." });
    } catch (e) {
      setMsg({ k: "err", t: `Could not start simulation: ${errMsg(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true); setMsg(null);
    try {
      const s = await api.simulationStop();
      setSim(s);
      onChange?.(s);
      setMsg({ k: "ok", t: "Simulation stopped. Fake game cleared." });
    } catch (e) {
      setMsg({ k: "err", t: `Could not stop simulation: ${errMsg(e)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Simulation"
      subtitle="Scripted fake NHL game through the real alert path (horns, TTS, lights). Not the live feed."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => void start()} disabled={busy || sim.active}>
            Start NHL simulation
          </Button>
          <Button variant="danger" onClick={() => void stop()} disabled={busy || !sim.active}>
            Stop simulation
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {msg && <Notice kind={msg.k}>{msg.t}</Notice>}
        <p className="text-sm text-slate-300">
          {sim.active
            ? `Running${sim.game_id ? ` (${sim.game_id})` : ""}${typeof sim.step_index === "number" ? ` · step ${sim.step_index + 1}` : ""}. Stop clears the fake game; auto-expires after 10 minutes.`
            : "Idle. Start walks game start → period → power play → goal → … against ConnectedRoom / HomePod."}
        </p>
      </div>
    </Card>
  );
}
