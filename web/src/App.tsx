import { Route, Routes } from "react-router-dom";
import Dashboard from "./views/Dashboard";
import Scoreboard from "./views/Scoreboard";
import Plate from "./views/Plate";
import Matchup from "./views/Matchup";
import Grid from "./views/Grid";
import Ticker from "./views/Ticker";
import Tracker from "./views/Tracker";
import Screen from "./views/Screen";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/scoreboard" element={<Scoreboard />} />
      <Route path="/plate" element={<Plate />} />
      <Route path="/matchup" element={<Matchup />} />
      <Route path="/vs" element={<Matchup />} />
      <Route path="/grid" element={<Grid />} />
      <Route path="/ticker" element={<Ticker />} />
      <Route path="/tracker" element={<Tracker />} />
      <Route path="/player" element={<Tracker />} />
      <Route path="/screen" element={<Screen />} />
      <Route path="/screen/:name" element={<Screen />} />
      <Route path="*" element={<Dashboard />} />
    </Routes>
  );
}
