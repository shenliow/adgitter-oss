/**
 * The toolbar's Push button while a push is in flight.
 *
 * Behaviour, not markup internals: a real push is driven through the real
 * App.svelte against a deliberately un-resolved `ipc.push`, and the button is
 * inspected while that promise is still pending. Per the repo's standing note,
 * jsdom's `getComputedStyle` does not resolve Svelte's scoped styles, so
 * nothing here reads computed CSS — and nothing checks that the animation
 * actually runs, which jsdom could not tell us either way. What is asserted is
 * what the user can act on: the button is unclickable, it reports itself busy,
 * and a busy indicator stands where its icon was.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupApp,
  ipc,
  mountApp,
  settle,
  toolbarButton,
} from "./test/appHarness";
import { t } from "./lib/i18n/index.svelte";

afterEach(() => {
  cleanupApp();
});

const pushButton = (h: HTMLElement): HTMLButtonElement =>
  toolbarButton(h, t("toolbar.push"))!;

const spinner = (el: HTMLElement): Element | null =>
  el.querySelector('[data-testid="spinner"]');

describe("toolbar Push — busy feedback while a push is in flight", () => {
  it("stays disabled and shows a busy indicator until the push settles, then returns to normal", async () => {
    const h = await mountApp();

    // AFTER mount: `mountApp()` resets every mock, so a pre-mount override on
    // `push` would be wiped before the toolbar ever calls it.
    let finishPush = () => {};
    ipc.push.mockImplementation(
      () => new Promise<void>((resolve) => (finishPush = () => resolve())),
    );

    // Before: the push icon, clickable, nothing busy.
    const idle = pushButton(h);
    expect(idle.disabled).toBe(false);
    expect(idle.hasAttribute("aria-busy")).toBe(false);
    expect(spinner(idle)).toBeNull();
    expect(idle.querySelector("svg.icon")).not.toBeNull();

    idle.click();
    await settle();

    // In flight: the push was asked for and has not come back.
    expect(ipc.push).toHaveBeenCalledTimes(1);
    const busy = pushButton(h);
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(spinner(busy)).not.toBeNull();
    // The indicator stands IN PLACE OF the icon, not beside it — otherwise the
    // button would grow mid-push.
    expect(busy.querySelector("svg.icon")).toBeNull();

    // Disabled means disabled: a second click cannot start a second push.
    busy.click();
    await settle();
    expect(ipc.push).toHaveBeenCalledTimes(1);

    finishPush();
    await settle();

    // After: back to the icon, clickable, no longer busy.
    const done = pushButton(h);
    expect(done.disabled).toBe(false);
    expect(done.hasAttribute("aria-busy")).toBe(false);
    expect(spinner(done)).toBeNull();
    expect(done.querySelector("svg.icon")).not.toBeNull();
  });

  it("clears the busy indicator when the push fails, rather than spinning forever", async () => {
    const h = await mountApp();
    // After mount — see the note above.
    let failPush = () => {};
    ipc.push.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          failPush = () => reject(new Error("remote rejected"));
        }),
    );

    pushButton(h).click();
    await settle();
    expect(spinner(pushButton(h))).not.toBeNull();

    failPush();
    await settle();

    const done = pushButton(h);
    expect(done.disabled).toBe(false);
    expect(spinner(done)).toBeNull();
  });
});
