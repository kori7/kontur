import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthGate } from "./features/AuthGate";
import "./styles.css";
import "./brand.css";

// Installed on the phone's home screen, the app opens like an app; the service worker keeps its shell
// available when the plant server is briefly out of reach. Development builds stay without it.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{(user, signOut) => <App user={user} onSignOut={signOut} />}</AuthGate>
  </React.StrictMode>,
);
