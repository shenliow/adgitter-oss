import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import CrashConsentNotice from "./CrashConsentNotice.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;
afterEach(() => {
  if (app) unmount(app);
  host?.remove();
});

describe("CrashConsentNotice", () => {
  it("asks about Sentry reports alone and forwards each answer", () => {
    const onAllow = vi.fn();
    const onDeny = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    app = mount(CrashConsentNotice, {
      target: host,
      props: { onAllow, onDeny },
    });
    flushSync();
    expect(host.textContent).toContain("Sentry");
    expect(host.textContent).not.toMatch(/\bads?\b/i);
    host.querySelector<HTMLButtonElement>(".primary")!.click();
    host.querySelector<HTMLButtonElement>(".ghost")!.click();
    expect(onAllow).toHaveBeenCalledTimes(1);
    expect(onDeny).toHaveBeenCalledTimes(1);
  });
});
