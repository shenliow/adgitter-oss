import { describe, it, expect, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import ColorPicker from "./ColorPicker.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(value = "#3a86ff"): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ColorPicker, { target: host, props: { value } });
  flushSync();
  return host;
}

const hexInput = (h: HTMLDivElement) =>
  h.querySelector(".hex") as HTMLInputElement;

describe("ColorPicker", () => {
  it("shows the seeded value", () => {
    expect(hexInput(render("#ffbb00")).value.toLowerCase()).toBe("#ffbb00");
  });

  it("normalizes a typed shorthand hex", () => {
    const h = render();
    const inp = hexInput(h);
    inp.value = "#0f0";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(hexInput(h).value.toLowerCase()).toBe("#00ff00");
  });

  it("hue slider drives the color toward that hue", () => {
    const h = render("#3a86ff"); // blue
    const hue = h.querySelector(".hue") as HTMLInputElement;
    hue.value = "0"; // red
    hue.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(hexInput(h).value.toLowerCase().startsWith("#ff")).toBe(true);
  });

  it("ignores invalid hex input (color unchanged)", () => {
    const h = render("#3a86ff"); // rgb(58, 134, 255)
    const inp = hexInput(h);
    inp.value = "nope";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    const swatch = h.querySelector(".swatch") as HTMLElement;
    expect(swatch.getAttribute("style")).toContain("rgb(58, 134, 255)");
  });
});
