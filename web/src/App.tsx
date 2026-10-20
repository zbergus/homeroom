import { Route, Routes } from "react-router-dom";
import Dashboard from "./views/Dashboard";
import Scoreboard from "./views/Scoreboard";
import Plate from "./views/Plate";
import Grid from "./views/Grid";
import Ticker from "./views/Ticker";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/scoreboard" element={<Scoreboard />} />
      <Route path="/plate" element={<Plate />} />
      <Route path="/grid" element={<Grid />} />
      <Route path="/ticker" element={<Ticker />} />
      <Route path="*" element={<Dashboard />} />
    </Routes>
  );
}
