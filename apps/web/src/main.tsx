import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./features/AuthGate";
import "./styles.css";
import "./brand.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{(user, signOut) => <App user={user} onSignOut={signOut} />}</AuthGate>
  </React.StrictMode>,
);
