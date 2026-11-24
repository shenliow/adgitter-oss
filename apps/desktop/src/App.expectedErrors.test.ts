/**
 * Expected failures are explained, not reported.
 *
 * Every error the App shows used to go to crash reporting too — so a user with
 * no access token, or simply offline, filed a Sentry event on every push, and
 * the genuine faults drowned in them. The rule now: a failure the user's own
 * setup explains (`isExpectedError`) gets a localized hint and nothing else;
 * only failures nothing explains are reported. Driven through the real
 * App.svelte against the mocked IPC, asserting on the toast the user sees and
 * on the telemetry spy.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupApp,
  errorToast,
  ipc,
  mountApp,
  settle,
  telemetry,
  toolbarButton,
} from "./test/appHarness";
import { t } from "./lib/i18n/index.svelte";

afterEach(() => {
  cleanupApp();
});

const crashWindow = (h: HTMLElement): Element | null =>
  h.querySelector(`[role="alertdialog"][aria-label="${t("crash.title")}"]`);

async function pushFailingWith(reason: unknown): Promise<HTMLElement> {
  const h = await mountApp();
  // After mount: `mountApp()` resets every mock.
  ipc.push.mockRejectedValue(reason);
  toolbarButton(h, t("toolbar.push"))!.click();
  await settle();
  return h;
}

describe("expected failures — a hint, no crash report", () => {
  it("a push with no access token says where to add one, and reports nothing", async () => {
    const h = await pushFailingWith({
      code: "AUTH_REQUIRED",
      message: "git error: authentication required",
    });
    expect(errorToast(h)).toBe(t("error.AUTH_REQUIRED"));
    expect(telemetry.report).not.toHaveBeenCalled();
  });

  it.each([
    ["AUTH_FAILED", "git error: authentication failed"],
    ["PERMISSION_DENIED", "git error: unexpected http status code: 403"],
    ["REMOTE_NOT_FOUND", "git error: unexpected http status code: 404"],
    ["NETWORK_ERROR", "git error: failed to resolve address for github.com"],
    ["PUSH_REJECTED", "push rejected (refs/heads/main: fetch first)"],
    ["INVALID_OPERATION", "cannot push a detached HEAD"],
  ])("%s is shown with its hint and not reported", async (code, message) => {
    const h = await pushFailingWith({ code, message });
    expect(errorToast(h)).toContain(
      t(`error.${code}` as Parameters<typeof t>[0]),
    );
    expect(telemetry.report).not.toHaveBeenCalled();
  });

  it("an unexplained failure is still reported", async () => {
    const h = await pushFailingWith({
      code: "GIT_ERROR",
      message: "git error: object not found",
    });
    expect(errorToast(h)).toContain("object not found");
    expect(telemetry.report).toHaveBeenCalledWith(
      "GIT_ERROR",
      "GIT_ERROR: git error: object not found",
    );
  });

  it("an expected failure that escapes its catch is a toast, not a crash", async () => {
    const h = await mountApp();
    const event = new Event("unhandledrejection", { cancelable: true });
    Object.assign(event, {
      reason: { code: "NETWORK_ERROR", message: "git error: timed out" },
    });
    window.dispatchEvent(event);
    await settle();

    expect(crashWindow(h)).toBeNull();
    expect(errorToast(h)).toContain(t("error.NETWORK_ERROR"));
    expect(telemetry.report).not.toHaveBeenCalled();
  });

  it("an unexpected one still opens the crash window and is reported", async () => {
    const h = await mountApp();
    const event = new Event("unhandledrejection", { cancelable: true });
    Object.assign(event, {
      reason: { code: "INTERNAL_ERROR", message: "internal error: boom" },
    });
    window.dispatchEvent(event);
    await settle();

    expect(crashWindow(h)).not.toBeNull();
    expect(telemetry.report).toHaveBeenCalledWith(
      "INTERNAL_ERROR",
      "INTERNAL_ERROR: internal error: boom",
    );
  });
});
