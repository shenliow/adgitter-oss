/**
 * HTML5 drag-and-drop synthesis for MetroGraph's gesture grammar.
 *
 * Playwright's high-level `Locator.dragTo()` (and manual mouse down/move/up)
 * drives real OS-level pointer events, but Chromium only starts a *native*
 * HTML5 drag session from those in limited circumstances, and — critically —
 * there is no way to hold Shift/Alt/Cmd/Ctrl through a native drag via
 * Playwright's mouse API at all. MetroGraph's gesture grammar
 * (`src/lib/dragDispatch.ts`) disambiguates merge/rebase/cherry-pick/reset
 * entirely by which modifier keys are held during `dragover`/`drop`, so a
 * helper that can't carry them is useless here.
 *
 * Instead, this dispatches synthetic `DragEvent`s directly (`dispatchEvent`,
 * not a real OS drag): dragstart (source) → dragover (target) → drop (target)
 * → dragend (source), sharing one real `DataTransfer` instance across all
 * four, with the requested modifier flags set on every event. Real
 * `DataTransfer`/`DragEvent` constructors are used (supported in Chromium),
 * so the component's own handlers (`startDrag`/`startCommitDrag` in
 * `MetroGraph.svelte`, which call `dataTransfer.setData`/`setDragImage`) run
 * unmodified — only the browser's native drag *session* (and its automatic
 * `dragover`-must-preventDefault-or-no-drop gating) is bypassed, which is
 * fine: we dispatch `drop` unconditionally, so that native gate never needs
 * to fire for the gesture to complete.
 *
 * MetroGraph reads modifiers off whichever event resolves the op —
 * `overTarget` (dragover) for the live affordance/tooltip repaint, `dropOn`
 * (drop) for the actual dispatch (see dragDispatch.resolveDrag's call sites
 * in MetroGraph.svelte) — so the modifier flags are set on BOTH events here,
 * not just `drop`, to keep the hover affordance and the resolved op honest
 * with each other.
 */
import type { Locator, Page } from "@playwright/test";

export interface DragMods {
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  ctrl?: boolean;
}

export async function html5Drag(
  page: Page,
  source: Locator,
  target: Locator,
  opts: DragMods = {},
): Promise<void> {
  const srcHandle = await source.elementHandle();
  const tgtHandle = await target.elementHandle();
  if (!srcHandle) throw new Error("html5Drag: source locator matched nothing");
  if (!tgtHandle) throw new Error("html5Drag: target locator matched nothing");

  const { shift = false, alt = false, meta = false, ctrl = false } = opts;

  await page.evaluate(
    ([src, tgt, mods]) => {
      const el = (h: unknown) => h as Element;
      const init: DragEventInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        shiftKey: mods.shift,
        altKey: mods.alt,
        metaKey: mods.meta,
        ctrlKey: mods.ctrl,
        // One shared DataTransfer across the whole gesture — exactly like a
        // real drag session, and required for MetroGraph's ondragstart
        // handler (which calls `dataTransfer.setData`/`setDragImage`) to have
        // somewhere to write.
        dataTransfer: new DataTransfer(),
      };
      el(src).dispatchEvent(new DragEvent("dragstart", init));
      el(tgt).dispatchEvent(new DragEvent("dragover", init));
      el(tgt).dispatchEvent(new DragEvent("drop", init));
      el(src).dispatchEvent(new DragEvent("dragend", init));
    },
    [srcHandle, tgtHandle, { shift, alt, meta, ctrl }] as const,
  );
}
