import { describe, it, expect, afterEach } from "vitest";
import {
  applyTheme,
  resolveThemePack,
  registerRemoteThemePack,
  __resetRemoteThemePacks,
  THEMES,
  COLOR_SCHEMES,
  TEXT_SIZE_PX,
} from "./theme";

function root(): HTMLElement {
  return document.createElement("div");
}

describe("applyTheme", () => {
  it("applies dark theme vars and the text-size font-size", () => {
    const el = root();
    applyTheme(
      {
        theme: "dark",
        color: "default",
        textSize: "large",
        font: "system",
        graphTheme: "default",
      },
      el,
    );
    expect(el.style.getPropertyValue("--panel-bg")).toBe("#262629");
    expect(el.style.fontSize).toBe(TEXT_SIZE_PX.large);
  });

  it("layers a color scheme over the theme", () => {
    const el = root();
    applyTheme(
      {
        theme: "default",
        color: "ocean",
        textSize: "medium",
        font: "system",
        graphTheme: "default",
      },
      el,
    );
    expect(el.style.getPropertyValue("--select-ring")).toBe("#0ea5e9");
  });

  it("clears managed overrides when switching back to default", () => {
    const el = root();
    applyTheme(
      {
        theme: "dark",
        color: "ocean",
        textSize: "small",
        font: "system",
        graphTheme: "default",
      },
      el,
    );
    expect(el.style.getPropertyValue("--panel-bg")).not.toBe("");
    applyTheme(
      {
        theme: "default",
        color: "default",
        textSize: "small",
        font: "system",
        graphTheme: "default",
      },
      el,
    );
    expect(el.style.getPropertyValue("--panel-bg")).toBe("");
    expect(el.style.getPropertyValue("--select-ring")).toBe("");
  });

  it("falls back to default for unknown ids", () => {
    const el = root();
    applyTheme(
      {
        theme: "nope",
        color: "bogus",
        textSize: "medium",
        font: "system",
        graphTheme: "default",
      },
      el,
    );
    expect(el.style.getPropertyValue("--panel-bg")).toBe(""); // default = no overrides
    expect(el.style.fontSize).toBe(TEXT_SIZE_PX.medium);
  });

  it("ships at least default + dark themes and color schemes", () => {
    expect(THEMES.map((t) => t.id)).toContain("dark");
    expect(COLOR_SCHEMES.map((c) => c.id)).toContain("ocean");
  });
});

describe("catalog packs through the engine", () => {
  it("resolveThemePack falls back to default for unknown ids", () => {
    expect(resolveThemePack("no-such-theme").id).toBe("default");
  });
});

describe("remote pack resolution order", () => {
  afterEach(() => __resetRemoteThemePacks());

  const personalize = (theme: string) => ({
    theme,
    color: "default",
    textSize: "medium" as const,
    font: "system" as const,
    graphTheme: "default",
  });

  it("resolves a registered remote pack", () => {
    registerRemoteThemePack({
      id: "nebula",
      name: "Nebula",
      vars: { "select-ring": "#7c5cff" },
    });
    expect(resolveThemePack("nebula").vars["select-ring"]).toBe("#7c5cff");
  });

  // The order is built-in → cache → download precisely so a bundled theme can
  // never be altered by whatever a server decides to serve under the same id.
  it("a remote pack can never shadow a built-in of the same id", () => {
    registerRemoteThemePack({
      id: "dark",
      name: "Not Dark",
      vars: { fg: "#ff0000" },
    });
    expect(resolveThemePack("dark")).toEqual(
      THEMES.find((t) => t.id === "dark"),
    );
  });

  // A remote pack sets vars no built-in mentions; if those weren't cleared,
  // switching away would leave the downloaded theme's colours stuck on :root.
  it("clears a remote pack's vars when switching away", () => {
    const el = root();
    registerRemoteThemePack({
      id: "nebula",
      name: "Nebula",
      vars: { "nebula-only": "#123456" },
    });
    applyTheme(personalize("nebula"), el);
    expect(el.style.getPropertyValue("--nebula-only")).toBe("#123456");

    applyTheme(personalize("default"), el);
    expect(el.style.getPropertyValue("--nebula-only")).toBe("");
  });
});
