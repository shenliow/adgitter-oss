/**
 * The side panels (branches / files / issues) slide in and out instead of
 * popping. The motion is a plain CSS keyframe picked by a `data-slide`
 * attribute — NOT a Svelte `transition:`, which needs the Web Animations API
 * jsdom lacks (see the note atop Toast.svelte). The consequence this suite
 * guards is the observable one: an exit animation only plays while the element
 * is still in the DOM, so App.svelte keeps a just-closed panel mounted for
 * `PANEL_SLIDE_MS` before dropping it.
 *
 * What matters here is the state machine, not the pixels: that the delayed
 * unmount actually happens, that it collapses to nothing under reduced motion,
 * and that a reopen inside the closing window cannot be torn down afterwards
 * by the timer the close started. The travel direction is CSS and is checked
 * in a browser, not here.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { t } from "./lib/i18n/index.svelte";
import { PANEL_SLIDE_MS } from "./lib/panelSlide.svelte";
import { mountApp, cleanupApp, settle, toolbarButton } from "./test/appHarness";

afterEach(() => {
  cleanupApp();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The panel docked on a given edge, or null when it is not mounted. */
function panel(h: HTMLElement, name: string): HTMLElement | null {
  return h.querySelector<HTMLElement>(`.panel[data-panel="${name}"]`);
}

/** `'in'` | `'out'` | null — the slide state App is asking the panel to show. */
function slide(h: HTMLElement, name: string): string | null {
  return panel(h, name)?.getAttribute("data-slide") ?? null;
}

/** Pretend the OS reduced-motion setting is `reduce`. jsdom ships no
 *  `matchMedia`, so absence is the "no preference" case (same stub
 *  MetroGraph.scroll.test.ts uses). */
function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList,
  );
}

async function toggleBranches(h: HTMLElement): Promise<void> {
  toolbarButton(h, t("toolbar.branches"))!.click();
  await settle();
}

describe("App — side panels slide in and out", () => {
  it("opens the branches panel in its entering state", async () => {
    const h = await mountApp();

    await toggleBranches(h);

    expect(panel(h, "branches")).not.toBeNull();
    expect(slide(h, "branches")).toBe("in");
  });

  it("keeps a closed panel mounted for the slide, then removes it", async () => {
    const h = await mountApp();
    await toggleBranches(h);
    vi.useFakeTimers();

    await toggleBranches(h);

    // Still in the DOM — otherwise there would be nothing for the exit
    // keyframe to animate — but marked as leaving.
    expect(panel(h, "branches")).not.toBeNull();
    expect(slide(h, "branches")).toBe("out");

    vi.advanceTimersByTime(PANEL_SLIDE_MS);
    await settle();

    expect(panel(h, "branches")).toBeNull();
  });

  it("removes the panel outright under prefers-reduced-motion", async () => {
    stubReducedMotion(true);
    const h = await mountApp();
    await toggleBranches(h);
    vi.useFakeTimers();

    await toggleBranches(h);

    // No timer is advanced: reduced motion must not leave an invisible panel
    // sitting in the tree waiting for one.
    expect(panel(h, "branches")).toBeNull();
  });

  it("reopening inside the closing window leaves the panel open, with no timer left to strand it", async () => {
    const h = await mountApp();
    await toggleBranches(h);
    vi.useFakeTimers();

    await toggleBranches(h); // close…
    vi.advanceTimersByTime(PANEL_SLIDE_MS / 3); // …and change your mind mid-slide
    await settle();
    await toggleBranches(h);

    expect(slide(h, "branches")).toBe("in");

    // The timer the close started must have been cancelled: well past the
    // slide window, the reopened panel is still there.
    vi.advanceTimersByTime(PANEL_SLIDE_MS * 10);
    await settle();

    expect(panel(h, "branches")).not.toBeNull();
    expect(slide(h, "branches")).toBe("in");
  });
});
