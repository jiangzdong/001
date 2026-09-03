import React from "react";
import { createRoot } from "react-dom/client";
import { StationAdvisorApp } from "./StationAdvisorApp.jsx";
import { VirtualSeniorTestConsole } from "./VirtualSeniorTestConsole.jsx";
import "./station-advisor.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {window.kioskBridge?.virtualSeniorControlSurface
      ? <VirtualSeniorTestConsole open standalone onClose={() => window.kioskBridge?.closeVirtualSeniorControl?.()} />
      : <StationAdvisorApp />}
  </React.StrictMode>,
);
