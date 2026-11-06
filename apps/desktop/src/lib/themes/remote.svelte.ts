/**
 * Remote theme delivery.
 *
 * The seam between the two Rust IPC commands (`theme_catalog`, `theme_pack`)
 * and the theme engines in `lib/theme.ts` / `lib/graphTheme.ts`. It owns three
 * things:
 *
 * 1. **The merged store listing.** Built-in catalog entries (bundled, with
 *    their packs already in the binary) plus whatever the remote catalog
 *    advertises. A built-in wins on an id collision, which is what guarantees
 *    the promise below.
 * 2. **The resolution order** — built-in → cache → download. A built-in theme
 *    never touches the network: {@link ensureThemePack} returns immediately for
 *    one, without an IPC call at all. Cache-vs-download is decided in Rust,
 *    where the cache lives.
 * 3. **Recoverable failure.** Applying an owned theme that is neither built-in
 *    nor cached, with no network, must leave the current theme alone and say
 *    why. Callers get a typed {@link ThemeLoadError} rather than a raw IPC
 *    rejection, and nothing is applied until a pack is actually in hand.
 *
 * Sanitisation is *not* this module's job — it happens in Rust before anything
 * is cached, so every pack that arrives here has already been vetted.
 */
import {
  themeCatalog,
  themePack,
  type CatalogThemeDto,
  type ThemePackErrorCode,
} from "../ipc";
import {
  registerRemoteThemePack,
  themePackAvailable,
  type ThemePack,
} from "../theme";
import {
  registerRemoteGraphThemePack,
  graphThemePackAvailable,
  type GraphThemePack,
} from "../graphTheme";
import { catalog } from "./catalog";
import { graphThemes } from "../graphTheme";
import type { MessageKey } from "../i18n/messages";

/** A store row, whatever its provenance. */
export interface StoreListing {
  id: string;
  kind: "app" | "graph";
  name: string;
  priceUsd: number;
  /** Colour swatches for the preview. Remote rows only ever get this subset —
   *  the full pack stays behind the license — so the store must be able to sell
   *  from it alone. */
  swatches: string[];
  /** A representative asset for graph themes (already-sanitised data URI). */
  nodeUrl?: string;
  /** True when the pack ships inside the binary, so applying it is instant and
   *  offline-safe. */
  builtIn: boolean;
  /** Whether the server can actually take money for this theme (it has a Polar
   *  product mapped). `true` whenever the server said nothing — an unreachable
   *  or older server is not evidence that a theme is unsellable, and the
   *  checkout still fails safely if it turns out to be. */
  purchasable: boolean;
}

/** Why a theme could not be made ready to apply. */
export class ThemeLoadError extends Error {
  constructor(
    readonly code: ThemePackErrorCode,
    /** The user-facing message key — every failure has something to say. */
    readonly messageKey: MessageKey,
    readonly themeId: string,
  ) {
    super(`theme ${themeId}: ${code}`);
    this.name = "ThemeLoadError";
  }
}

/** Map a backend code onto the sentence the user should read. */
function messageKeyFor(code: ThemePackErrorCode): MessageKey {
  switch (code) {
    case "NOT_SIGNED_IN":
      return "themeStore.error.signIn";
    case "THEME_NOT_OWNED":
      return "themeStore.error.notOwned";
    case "THEME_NOT_FOUND":
      return "themeStore.error.notFound";
    case "THEME_REJECTED":
      return "themeStore.error.rejected";
    default:
      return "themeStore.error.offline";
  }
}

function codeOf(err: unknown): ThemePackErrorCode {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? (err as { code: unknown }).code
      : undefined;
  return typeof code === "string"
    ? (code as ThemePackErrorCode)
    : "THEME_UNAVAILABLE";
}

// ── Catalog ─────────────────────────────────────────────────────────────────

let remote = $state<CatalogThemeDto[]>([]);
let loading = $state(false);
/** True once a catalog load has completed, however it went. */
let loaded = $state(false);

/** Whether a catalog fetch is in flight (drives the store's busy state). */
export function catalogLoading(): boolean {
  return loading;
}

export function catalogLoaded(): boolean {
  return loaded;
}

/**
 * Load the remote catalog. Safe to call on every store open: the Rust side
 * serves it from cache inside a 24 h TTL, and `force` (the Refresh button)
 * skips that.
 *
 * Never throws. The command already degrades an unreachable server to the last
 * cached catalog, or to an empty list — in which case the store simply shows
 * the built-ins, which is the correct offline experience for a shop.
 */
export async function loadCatalog(force = false): Promise<void> {
  loading = true;
  try {
    remote = (await themeCatalog(force)).themes;
  } catch {
    // A hard IPC failure (rather than a network one, which Rust absorbs) still
    // must not break the dialog — fall back to whatever we already listed.
    remote = remote.length > 0 ? remote : [];
  } finally {
    loading = false;
    loaded = true;
  }
}

/**
 * The store listing: built-ins first, then remote entries that don't collide
 * with one. Built-ins are listed from the bundled catalog so they keep working
 * with no server at all.
 */
export function storeListings(): StoreListing[] {
  // Purchasability is a property of the *server deployment*, not of where the
  // pack came from — a bundled theme is sold by the same Polar product as a
  // remote one — so a built-in row inherits the server's verdict.
  //
  // Absence has to be read two different ways, and conflating them is what let
  // an unsellable theme keep a live Buy button:
  //
  //   • An EMPTY catalog carries no verdict at all — offline, not yet loaded,
  //     or the IPC call failed. Everything stays sellable: a shop that greys
  //     itself out the moment the network blinks is worse than one whose
  //     checkout fails safely and says so.
  //   • A catalog that DID arrive lists every theme the deployment serves,
  //     sellable or not (`GET /themes/catalog` reports `purchasable` per row
  //     rather than hiding the ones it can't charge for). So an id missing from
  //     a non-empty catalog is positive evidence that this deployment cannot
  //     sell it — a newly bundled theme against a server that predates it,
  //     which is exactly how Hero shipped: the desktop listed it, the deployed
  //     server had never heard of it, and Buy stayed lit until `/checkout`
  //     failed with the generic "checkout isn't available right now".
  //
  // That second case is the whole reason the `purchasable` flag exists: Buy has
  // to be disabled *before* the click, not after.
  const sellable = (id: string): boolean => {
    if (remote.length === 0) return true;
    const row = remote.find((r) => r.id === id);
    return row ? row.purchasable !== false : false;
  };

  const builtIn: StoreListing[] = catalog().map((c) => ({
    id: c.id,
    kind: "app" as const,
    name: c.name,
    priceUsd: c.priceUsd,
    swatches: swatchesOf(c.pack),
    builtIn: true,
    purchasable: sellable(c.id),
  }));

  const builtInGraph: StoreListing[] = graphThemes()
    .filter((g) => g.priceUsd != null)
    .map((g) => ({
      id: g.id,
      kind: "graph" as const,
      name: g.name,
      priceUsd: g.priceUsd!,
      swatches: (g.lanes ?? []).slice(0, 5),
      nodeUrl: g.node?.normal.url,
      builtIn: true,
      purchasable: sellable(g.id),
    }));

  const local = [...builtIn, ...builtInGraph];
  const localIds = new Set(local.map((l) => l.id));

  const fromServer: StoreListing[] = remote
    .filter((r) => !localIds.has(r.id))
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      priceUsd: r.priceUsd,
      swatches: r.preview.swatches ?? [],
      nodeUrl: r.preview.nodeUrl,
      builtIn: false,
      purchasable: r.purchasable !== false,
    }));

  return [...local, ...fromServer];
}

/** Pull a few representative colours out of a CSS-var pack for the preview. */
function swatchesOf(pack: ThemePack): string[] {
  const prefer = ["topbar-bg", "workspace-bg", "select-ring", "fg", "panel-bg"];
  const picked = prefer
    .map((k) => pack.vars[k])
    .filter((v): v is string => typeof v === "string");
  return picked.slice(0, 5);
}

// ── Pack resolution ─────────────────────────────────────────────────────────

/**
 * Make `id` resolvable by the theme engines, fetching it only if it isn't
 * already — the **built-in → cache → download** order.
 *
 * A built-in (or an already-registered) theme returns without any IPC call, so
 * the offline promise for bundled themes is structural rather than incidental.
 * Everything else defers to `theme_pack`, which is itself cache-first.
 *
 * @throws {ThemeLoadError} when the pack cannot be obtained. The caller must
 * treat this as recoverable and leave the current theme in place.
 */
export async function ensureThemePack(
  id: string,
  kind: "app" | "graph" = "app",
): Promise<void> {
  if (kind === "graph" ? graphThemePackAvailable(id) : themePackAvailable(id)) {
    return;
  }

  let payload;
  try {
    payload = await themePack(id);
  } catch (err) {
    const code = codeOf(err);
    throw new ThemeLoadError(code, messageKeyFor(code), id);
  }

  // The pack body is the shape the engines already consume; the delivery layer
  // adds no format of its own. Stamp the id/name from the envelope so a pack
  // always registers under the id it was requested by.
  const body = (payload.pack ?? {}) as Record<string, unknown>;
  const withIdentity = { ...body, id: payload.id, name: payload.name };

  if (payload.kind === "graph") {
    registerRemoteGraphThemePack(withIdentity as unknown as GraphThemePack);
  } else {
    registerRemoteThemePack(withIdentity as unknown as ThemePack);
  }
}

/** TEST-ONLY: clear the cached catalog state. */
export function __resetRemoteCatalog(): void {
  remote = [];
  loading = false;
  loaded = false;
}
