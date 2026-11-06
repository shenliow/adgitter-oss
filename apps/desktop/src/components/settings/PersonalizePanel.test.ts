import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { PersonalizeSettings } from "../../lib/settings";
import type { TutorialAction } from "../../lib/tutorial/types";
import type { StorePurchase } from "../../lib/themes/storeOwnership.svelte";
import { en, catalogs } from "../../lib/i18n/messages";
import { setLocale } from "../../lib/i18n/index.svelte";

// Controllable mock theme store (ownership drives Apply vs Buy).
const owned = new Set<string>();
const buyStoreTheme = vi.fn<(id: string) => Promise<StorePurchase>>(
  async (id: string) => {
    owned.add(id);
    return { status: "granted" };
  },
);
const refreshOwnership = vi.fn(async () => {});
vi.mock("../../lib/themes/storeOwnership.svelte", () => ({
  ownsStoreTheme: (id: string) => id === "default" || owned.has(id),
  canPurchase: () => true,
  buyStoreTheme: (id: string) => buyStoreTheme(id),
  refreshOwnership: () => refreshOwnership(),
  MOCK_STORE: true,
}));

import PersonalizePanel from "./PersonalizePanel.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  owned.clear();
  buyStoreTheme.mockClear();
  refreshOwnership.mockClear();
  setLocale("en");
});

function value(over: Partial<PersonalizeSettings> = {}): PersonalizeSettings {
  return {
    theme: "default",
    color: "default",
    textSize: "medium",
    font: "system",
    graphTheme: "default",
    ...over,
  };
}

function render(
  v: PersonalizeSettings,
  guard?: (a: TutorialAction) => boolean,
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(PersonalizePanel, { target: host, props: { value: v, guard } });
  flushSync();
  return host;
}

const rowFor = (h: HTMLElement, name: string) =>
  [...h.querySelectorAll<HTMLElement>(".gt-row")].find((r) =>
    r.textContent?.includes(name),
  )!;

describe("PersonalizePanel", () => {
  it("font + text-size selects reflect the draft", () => {
    const h = render(value({ font: "mono", textSize: "large" }));
    const selects = h.querySelectorAll("select");
    expect((selects[0] as HTMLSelectElement).value).toBe("mono"); // font
    expect((selects[1] as HTMLSelectElement).value).toBe("large"); // text size
  });

  // The three built-in descriptions were English literals on the pack objects,
  // so this row stayed English in every language. They now resolve via the
  // catalog; a remote pack, whose text cannot be localized, is unaffected.
  it("renders each built-in description in the active locale", () => {
    const h = render(value({ graphTheme: "default" }));
    expect(rowFor(h, "Default").querySelector(".gt-desc")?.textContent).toBe(
      en["graphTheme.default.description"],
    );

    setLocale("zh-Hant");
    flushSync();
    const desc = rowFor(h, "Default").querySelector(".gt-desc")?.textContent;
    expect(desc).toBe(catalogs["zh-Hant"]["graphTheme.default.description"]);
    expect(desc).not.toBe(en["graphTheme.default.description"]);
    // Not an unresolved key, either.
    expect(desc).not.toMatch(/^graphTheme\./);
  });
});
