"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const local =
      location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (local) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister())),
        );
      return;
    }
    void navigator.serviceWorker.register("/sw.js");
  }, []);
  return null;
}
