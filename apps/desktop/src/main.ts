import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";

// Svelte 5: the class component API (`new App(...)`) was removed; mount the root
// component instead.
const app = mount(App, {
  target: document.getElementById("app") as HTMLElement,
});

// Dev-only: expose the Sentry crash-pipeline smoke test on the console
// (`window.__adgitterDebug.triggerCrash()`). Tree-shaken out of release builds.
if (import.meta.env.DEV) {
  void import("./lib/ipc").then(({ debugTriggerCrash }) => {
    (window as unknown as Record<string, unknown>).__adgitterDebug = {
      triggerCrash: debugTriggerCrash,
    };
  });
}

// Production hardening: suppress the WebView devtools/inspector in the shipped
// app (defence-in-depth over the compile-time guarantee — see lib/harden.ts).
// Dev builds keep their inspector. Loaded lazily so it never enters dev bundles.
if (import.meta.env.PROD) {
  void import("./lib/harden").then(({ installInspectorGuards }) => {
    installInspectorGuards();
  });
}

export default app;
