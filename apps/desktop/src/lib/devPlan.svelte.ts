/**
 * DEV-ONLY runtime plan switcher — the state behind the account menu's dev
 * plan control.
 *
 * # What it is for
 *
 * `VITE_DEV_PLAN` (see `license.svelte.ts`'s `devPlanOverride`, and
 * `src-tauri/build.rs`) pins the dev entitlement at **compile** time. Checking a
 * change at four tiers therefore means four edits and four restarts — and on a
 * machine whose `.env.development` pins a tier (the author's pins `enterprise`)
 * the *real-licence* path cannot be reached at runtime at all, which is the one
 * path most worth exercising. This module adds a runtime choice on top, from the
 * account menu, so the tier can be retargeted live.
 *
 * # Why the gate is stricter than the switch it joins
 *
 * A baked constant is inert in a shipped binary no matter who reads it. A
 * *setter* is not: it changes the answer the entitlement gate gives, and
 * anything executing in the webview could call one. So the two layers are gated
 * **independently**, and neither gate is reachable from configuration — no env
 * var, no setting, no "unlock dev mode" toggle flips either of them in a release
 * build:
 *
 *  1. **Frontend** — every exported function here returns early unless
 *     `import.meta.env.DEV`. That is a literal Vite replaces with `false` in
 *     `vite build`, so the bodies are dead code the bundler drops; there is no
 *     variable to set and no storage key to plant. A value hand-written into
 *     `localStorage` by a release-build webview is read by nobody.
 *  2. **Native** — the `set_dev_plan` command and its `generate_handler!`
 *     registration are both `#[cfg(debug_assertions)]`, with no release-side
 *     fallback arm. The command does not exist in a release binary, so it cannot
 *     be invoked however cleverly; see `src-tauri/src/commands.rs`.
 *
 * A bug in either gate leaves the other standing: with the frontend gate broken,
 * the IPC call lands on a command that is not there; with the native gate
 * broken, nothing in a release bundle ever calls it.
 *
 * # Precedence, and what "no override" means
 *
 * The runtime choice wins over `VITE_DEV_PLAN` whenever one has been made: it is
 * what the developer just picked, looking at the screen, whereas the baked value
 * is a default set once in a file. With **no** runtime choice stored, the baked
 * value still applies, so a developer who never opens the menu keeps exactly the
 * behaviour they had before. Picking **"no override — use the real licence"**
 * is a stored choice like any other, and it beats a baked `VITE_DEV_PLAN`:
 * without that, the real-licence path would stay unreachable.
 *
 * The same rule is implemented on the Rust side (`dev_unlock::resolve_plan`),
 * but it is not resolved twice: {@link syncDevPlanToBackend} pushes the *already
 * resolved* tier to the native gate, so there is one decision and two readers.
 *
 * # It grants capabilities, never purchases
 *
 * Nothing here touches owned themes. The override moves the *tier*;
 * `licensedThemes()` keeps reading the real licence, so a dev build can still
 * complete and observe a real theme purchase.
 */
import type { Plan } from "./license.svelte";
import { setDevPlan as setDevPlanIpc } from "./ipc";

/**
 * What the switcher can be set to: one of the four tiers, or `"real"` — "no
 * override, use the real licence". `"real"` is a first-class stored value and
 * not merely the absence of one, because "the developer chose the real licence"
 * and "the developer has not chosen anything" must resolve differently against a
 * baked `VITE_DEV_PLAN`.
 */
export type DevPlanChoice = Plan | "real";

/**
 * The "no override" sentinel, spelled once. Typed as the literal rather than as
 * `DevPlanChoice` so `!== REAL_LICENCE` narrows a choice down to a real `Plan` —
 * the tier and the sentinel must never be interchangeable to the type checker.
 */
export const REAL_LICENCE = "real" as const;

/** The four real tiers, in ascending order. Mirrors `license.svelte.ts`'s `PLANS`. */
const PLAN_TIERS: readonly Plan[] = ["free", "basic", "advance", "enterprise"];

/** Every value the switcher offers, in menu order. */
export const DEV_PLAN_CHOICES: readonly DevPlanChoice[] = [
  REAL_LICENCE,
  ...PLAN_TIERS,
];

/**
 * Where the choice is persisted. A plain per-machine `localStorage` entry, like
 * `accountProfile.ts` — deliberately *not* a setting, and not synced anywhere:
 * this must not become something a user can carry to a release build. It is read
 * only by code that has already passed the `import.meta.env.DEV` gate, so in a
 * release bundle the key is inert even if it is present.
 */
export const DEV_PLAN_STORAGE_KEY = "adgitter.dev.plan-override";

/**
 * The stored choice, or `null` when the menu has never been used. Reactive, so
 * the star, the plan label and every feature gate follow a change immediately.
 */
let stored = $state<DevPlanChoice | null>(null);

/** Whether {@link hydrateDevPlan} has run, so a re-entry cannot clobber state. */
let hydrated = false;

/** Narrow an untrusted string (localStorage is editable) to a real choice. */
function asChoice(v: unknown): DevPlanChoice | null {
  return typeof v === "string" &&
    (DEV_PLAN_CHOICES as readonly string[]).includes(v)
    ? (v as DevPlanChoice)
    : null;
}

/**
 * The baked `VITE_DEV_PLAN`, or `null`. Duplicated from `license.svelte.ts`'s
 * `devPlanOverride` rather than imported to keep the dependency one-way (that
 * module imports this one); both apply the same strict membership test, so an
 * empty or misspelled value is `null` — locked — in both.
 *
 * Read as `unknown` on purpose. `vite-env.d.ts` declares the variable as the
 * tier union, but that is a convenience for whoever writes `.env.development`,
 * not a guarantee: the value is whatever a text file happens to contain, and the
 * two failure modes that have actually happened here are an empty value copied
 * from `.env.example` and a typo. Trusting the declared type would delete the
 * check that catches both — the same strictness `Plan::from_str` enforces on
 * the Rust side, where empty and unknown values also fail closed.
 */
function bakedPlan(): Plan | null {
  const p: unknown = import.meta.env.VITE_DEV_PLAN;
  return typeof p === "string" && (PLAN_TIERS as readonly string[]).includes(p)
    ? (p as Plan)
    : null;
}

/**
 * Read the persisted choice into the reactive store. Idempotent, and called
 * from {@link syncDevPlanToBackend} — i.e. on every `refreshEntitlement()`,
 * including the one at app startup — so the choice survives a reload without
 * App.svelte having to remember to restore it.
 */
export function hydrateDevPlan(): void {
  if (!import.meta.env.DEV || hydrated) return;
  hydrated = true;
  try {
    stored = asChoice(localStorage.getItem(DEV_PLAN_STORAGE_KEY));
  } catch {
    /* private mode / disabled storage — no stored choice, which is the safe
       answer: fall back to the compile-time switch. */
  }
}

/**
 * What the menu should show as selected — never `null`, so the control always
 * displays the tier actually in force. With nothing stored this is the baked
 * `VITE_DEV_PLAN`, or {@link REAL_LICENCE} when nothing is baked either.
 */
export function devPlanSelection(): DevPlanChoice {
  if (!import.meta.env.DEV) return REAL_LICENCE;
  return stored ?? bakedPlan() ?? REAL_LICENCE;
}

/**
 * The tier the entitlement store should run at, or `null` for "use the real
 * licence". The single resolution of the precedence rule described in the module
 * doc; {@link syncDevPlanToBackend} hands this same answer to the native gate so
 * the two layers cannot disagree.
 */
export function effectiveDevPlan(): Plan | null {
  const selection = devPlanSelection();
  return selection === REAL_LICENCE ? null : selection;
}

/**
 * Record a choice and persist it. A no-op outside dev, so nothing a release
 * build could reach can change the entitlement.
 *
 * Callers follow this with `refreshEntitlement()`, which re-derives the plan and
 * features **and** pushes the new tier to the native gate — one path, so the UI
 * cannot end up showing a tier the backend is not honouring.
 */
export function setDevPlanChoice(next: DevPlanChoice): void {
  if (!import.meta.env.DEV) return;
  hydrated = true; // an explicit choice supersedes whatever is on disk
  stored = asChoice(next);
  try {
    if (stored) localStorage.setItem(DEV_PLAN_STORAGE_KEY, stored);
    else localStorage.removeItem(DEV_PLAN_STORAGE_KEY);
  } catch {
    /* private mode / quota — the choice just won't survive a reload */
  }
}

/**
 * Push the effective tier to the native feature gate so both ends agree.
 *
 * Rust state is per-process and the persisted choice lives in the webview, so
 * re-applying at app start is not optional: without it a reload would restore
 * the UI's tier while the backend stayed on whatever `VITE_DEV_PLAN` baked, and
 * a gate would open on one side only. Calling this from `refreshEntitlement()`
 * covers startup, the menu, and the post-checkout refresh with one seam.
 *
 * Failure is swallowed. This runs before every entitlement read, and a dev-only
 * convenience must never be able to break startup; a backend that did not take
 * the tier simply stays where it was, which is the locked direction.
 */
export async function syncDevPlanToBackend(): Promise<void> {
  if (!import.meta.env.DEV) return;
  hydrateDevPlan();
  try {
    await setDevPlanIpc(effectiveDevPlan());
  } catch {
    /* no native side (tests, browser preview), or the command is absent */
  }
}
