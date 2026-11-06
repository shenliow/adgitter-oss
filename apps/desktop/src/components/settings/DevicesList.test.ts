import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import type { DeviceDto } from "../../lib/ipc";

const { ipc, lic } = vi.hoisted(() => ({
  ipc: {
    list: vi.fn(async (): Promise<DeviceDto[]> => []),
    remove: vi.fn(async () => {}),
  },
  lic: { plan: "free" },
}));

vi.mock("../../lib/ipc", () => ({
  listDevices: ipc.list,
  removeDevice: ipc.remove,
}));
vi.mock("../../lib/license.svelte", () => ({
  getPlan: () => lic.plan,
  deviceLimit: (p: string) => (p === "advance" || p === "enterprise" ? 5 : 2),
}));

import DevicesList from "./DevicesList.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
  ipc.list.mockClear();
  ipc.remove.mockClear();
});

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(DevicesList, { target: host });
  flushSync();
  return host;
}

describe("DevicesList", () => {
  it("empty/unreachable: shows the friendly state and free-tier seat count", async () => {
    lic.plan = "free";
    ipc.list.mockResolvedValueOnce([]);
    const h = render();
    await vi.waitFor(() => {
      flushSync();
      expect(h.querySelector(".empty")).not.toBeNull();
    });
    expect(h.querySelector(".usage")?.textContent).toBe("0 of 2 devices");
  });

  it("lists devices, marks the current one, and shows advance seat cap", async () => {
    lic.plan = "advance";
    ipc.list.mockResolvedValueOnce([
      {
        id: "a",
        name: "Studio Mac",
        lastSeen: 1_700_000_000_000,
        current: true,
      },
      { id: "b", name: "Laptop", lastSeen: 0, current: false },
    ]);
    const h = render();
    await vi.waitFor(() => {
      flushSync();
      expect(h.querySelectorAll(".row").length).toBe(2);
    });
    expect(h.querySelector(".usage")?.textContent).toBe("2 of 5 devices");
    // Only the non-current device is removable.
    const removeButtons = h.querySelectorAll(".rm");
    expect(removeButtons.length).toBe(1);

    (removeButtons[0] as HTMLButtonElement).click();
    await Promise.resolve();
    expect(ipc.remove).toHaveBeenCalledWith("b");
  });
});
