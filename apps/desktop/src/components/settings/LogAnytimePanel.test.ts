import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import LogAnytimePanel from "./LogAnytimePanel.svelte";
import type { LogAnytimeSettings } from "../../lib/settings";

// Controllable entitlement (read lazily inside the closure).
let granted = new Set<string>();
vi.mock("../../lib/license.svelte", () => ({
  hasFeature: (f: string) => granted.has(f),
}));

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  granted = new Set();
});

function defaults(over: Partial<LogAnytimeSettings> = {}): LogAnytimeSettings {
  return {
    enabled: false,
    branch: "adgitter-log",
    intervalMin: 60,
    background: false,
    periodicSquash: false,
    autoPush: false,
    ...over,
  };
}

function render(value: LogAnytimeSettings, repoPath: string | null = null) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(LogAnytimePanel, { target: host, props: { value, repoPath } });
  flushSync();
  return host;
}

// Checkbox order in the markup: [enable, autoPush, …the paid section's].
function checkboxes(h: HTMLElement) {
  return [...h.querySelectorAll("input[type=checkbox]")] as HTMLInputElement[];
}

describe("LogAnytimePanel — free foreground", () => {
  it("disables branch + interval until enabled", () => {
    // Repo open (else everything is disabled regardless) — isolates the
    // enable-gating: branch/interval stay disabled while `enabled` is off.
    const h = render(defaults({ enabled: false }), "/repo");
    expect(
      (
        h.querySelector(
          "input[type=text], input:not([type])",
        ) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect((h.querySelector("select") as HTMLSelectElement).disabled).toBe(
      true,
    );
  });

  it("allows free users to enable auto-push for an enabled repo", () => {
    const value = defaults({ enabled: true });
    const h = render(value, "/repo");
    const [, autoPush] = checkboxes(h);
    expect(autoPush.disabled).toBe(false);
    expect(autoPush.checked).toBe(false);
    autoPush.click();
    expect(value.autoPush).toBe(true);
  });

  it("enables branch + interval (and reflects values) when on", () => {
    const h = render(
      defaults({ enabled: true, branch: "snapshots", intervalMin: 30 }),
      "/repo",
    );
    const branch = h.querySelector(
      "input:not([type=checkbox])",
    ) as HTMLInputElement;
    expect(branch.value).toBe("snapshots");
    const sel = h.querySelector("select") as HTMLSelectElement;
    expect(sel.value).toBe("30");
    expect(sel.disabled).toBe(false);
    expect(branch.disabled).toBe(false);
  });
});

describe("LogAnytimePanel — requires an open repo (aligned with #21)", () => {
  it("disables every control and shows a notice on the Welcome screen (no repo)", () => {
    // Fully entitled + enabled: with no repo the whole page is still inert,
    // because Log Anytime targets a specific repo's working tree.
    granted = new Set(["LogAnytimeBackground", "LogAnytimeSquash"]);
    const h = render(defaults({ enabled: true }), null);

    for (const cb of checkboxes(h)) expect(cb.disabled).toBe(true);
    expect(
      (h.querySelector("input:not([type=checkbox])") as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect((h.querySelector("select") as HTMLSelectElement).disabled).toBe(
      true,
    );
    for (const btn of h.querySelectorAll("button"))
      expect(btn.disabled).toBe(true);
    // A hint explains why the page is inert.
    expect(h.querySelector(".norepo")).not.toBeNull();
  });
});
