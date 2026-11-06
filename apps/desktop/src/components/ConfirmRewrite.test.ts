import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, unmount, flushSync, type ComponentProps } from "svelte";
import ConfirmRewrite from "./ConfirmRewrite.svelte";

let host: HTMLDivElement;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any;

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = undefined;
});

function render(props: ComponentProps<typeof ConfirmRewrite>): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ConfirmRewrite, { target: host, props });
  flushSync();
  return host;
}

function primary(h: HTMLDivElement): HTMLButtonElement {
  return h.querySelector(".primary") as HTMLButtonElement;
}

describe("ConfirmRewrite", () => {
  it("confirms a plain rewriting op (no message field)", () => {
    const onConfirm = vi.fn();
    const h = render({
      title: "Drop commit",
      body: "Remove it.",
      confirmLabel: "Drop",
      danger: true,
      onConfirm,
      onCancel: () => {},
    });
    expect(h.querySelector("textarea")).toBeNull();
    expect(primary(h).classList.contains("danger")).toBe(true);
    primary(h).click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("blocks confirm until a reword message is non-empty", () => {
    const onConfirm = vi.fn();
    const h = render({
      title: "Reword commit",
      withMessage: true,
      defaultMessage: "",
      onConfirm,
      onCancel: () => {},
    });
    const ta = h.querySelector("textarea")!;
    expect(ta).not.toBeNull();
    expect(primary(h).disabled).toBe(true);

    ta.value = "a better message";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();

    expect(primary(h).disabled).toBe(false);
    primary(h).click();
    expect(onConfirm).toHaveBeenCalledWith("a better message");
  });

  it("seeds the message field from defaultMessage", () => {
    const h = render({
      title: "Reword commit",
      withMessage: true,
      defaultMessage: "old subject",
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect((h.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "old subject",
    );
  });

  it("cancels on Escape and on the Cancel button", () => {
    const onCancel = vi.fn();
    const h = render({
      title: "Reset (hard)",
      onConfirm: () => {},
      onCancel,
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    (h.querySelector(".ghost") as HTMLButtonElement).click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("shows no branch chooser when the drop target was unambiguous (zero or one candidate)", () => {
    for (const choices of [[], ["main"]]) {
      const h = render({
        title: "Rebase",
        choices,
        choice: choices[0] ?? "",
        onConfirm: () => {},
        onCancel: () => {},
      });
      expect(h.querySelector(".choices")).toBeNull();
      expect(primary(h).disabled).toBe(false);
      unmount(app);
      h.remove();
      app = undefined;
    }
  });

  it("offers a radio per candidate when the drop target was ambiguous, with the default pre-selected", () => {
    const h = render({
      title: "Rebase",
      choices: ["main", "dev"],
      choiceLabel: "Which branch is the target?",
      choice: "main",
      onConfirm: () => {},
      onCancel: () => {},
    });
    const radios = [
      ...h.querySelectorAll<HTMLInputElement>('.choices input[type="radio"]'),
    ];
    expect(radios.map((r) => r.value)).toEqual(["main", "dev"]);
    expect(radios.map((r) => r.checked)).toEqual([true, false]);
    expect(h.querySelector("legend")?.textContent).toBe(
      "Which branch is the target?",
    );
    // Same radio group, so picking one clears the other.
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
  });

  it("reports the picked branch to the caller (controlled — the caller owns the value)", () => {
    const onChoose = vi.fn();
    const h = render({
      title: "Rebase",
      choices: ["main", "dev"],
      choice: "main",
      onChoose,
      onConfirm: () => {},
      onCancel: () => {},
    });
    const dev = h.querySelectorAll<HTMLInputElement>(
      '.choices input[type="radio"]',
    )[1];
    dev.click();
    expect(onChoose).toHaveBeenCalledWith("dev");
  });

  it("confirms with the caller's current pick still in force", () => {
    const onConfirm = vi.fn();
    const h = render({
      title: "Rebase",
      choices: ["main", "dev"],
      choice: "dev",
      onConfirm,
      onCancel: () => {},
    });
    expect(
      h.querySelectorAll<HTMLInputElement>(".choices input")[1].checked,
    ).toBe(true);
    expect(primary(h).disabled).toBe(false);
    primary(h).click();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("blocks confirm while the ambiguous choice is unresolved", () => {
    const h = render({
      title: "Rebase",
      choices: ["main", "dev"],
      choice: "",
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(primary(h).disabled).toBe(true);
  });

  it("renders one fieldset per ambiguous end, in the order given, each with its own radio group", () => {
    const h = render({
      title: "Merge",
      choiceGroups: [
        {
          label: "Which branch is the source?",
          choices: ["feature", "wip"],
          value: "feature",
          onChoose: () => {},
        },
        {
          label: "Which branch is the target?",
          choices: ["main", "release"],
          value: "main",
          onChoose: () => {},
        },
      ],
      onConfirm: () => {},
      onCancel: () => {},
    });
    const sets = [...h.querySelectorAll("fieldset.choices")];
    expect(sets.map((f) => f.querySelector("legend")?.textContent)).toEqual([
      "Which branch is the source?",
      "Which branch is the target?",
    ]);
    const names = sets.map(
      (f) => f.querySelector<HTMLInputElement>("input")!.name,
    );
    // Independent groups — a pick on one must not clear the other.
    expect(new Set(names).size).toBe(2);
    expect(
      sets.map((f) =>
        [...f.querySelectorAll<HTMLInputElement>("input")].map((r) => r.value),
      ),
    ).toEqual([
      ["feature", "wip"],
      ["main", "release"],
    ]);
  });

  it("routes each group's pick to that group's own callback", () => {
    const onSource = vi.fn();
    const onTarget = vi.fn();
    const h = render({
      title: "Merge",
      choiceGroups: [
        {
          label: "source",
          choices: ["feature", "wip"],
          value: "feature",
          onChoose: onSource,
        },
        {
          label: "target",
          choices: ["main", "release"],
          value: "main",
          onChoose: onTarget,
        },
      ],
      onConfirm: () => {},
      onCancel: () => {},
    });
    const sets = [...h.querySelectorAll("fieldset.choices")];
    sets[0].querySelectorAll<HTMLInputElement>("input")[1].click();
    sets[1].querySelectorAll<HTMLInputElement>("input")[1].click();
    expect(onSource.mock.calls).toEqual([["wip"]]);
    expect(onTarget.mock.calls).toEqual([["release"]]);
  });

  it("blocks confirm until EVERY ambiguous end is resolved", () => {
    const h = render({
      title: "Merge",
      choiceGroups: [
        {
          label: "source",
          choices: ["feature", "wip"],
          value: "feature",
          onChoose: () => {},
        },
        {
          label: "target",
          choices: ["main", "release"],
          value: "",
          onChoose: () => {},
        },
      ],
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(primary(h).disabled).toBe(true);
  });

  it("only shows the ambiguous end when the other one is a single branch", () => {
    const h = render({
      title: "Merge",
      choiceGroups: [
        {
          label: "source",
          choices: ["feature", "wip"],
          value: "feature",
          onChoose: () => {},
        },
        { label: "target", choices: [], value: "main", onChoose: () => {} },
      ],
      onConfirm: () => {},
      onCancel: () => {},
    });
    const sets = [...h.querySelectorAll("fieldset.choices")];
    expect(sets).toHaveLength(1);
    expect(sets[0].querySelector("legend")?.textContent).toBe("source");
    expect(primary(h).disabled).toBe(false);
  });

  it("adds no step at all when neither end is ambiguous", () => {
    const h = render({
      title: "Merge",
      choiceGroups: [
        {
          label: "source",
          choices: ["feature"],
          value: "feature",
          onChoose: () => {},
        },
        {
          label: "target",
          choices: ["main"],
          value: "main",
          onChoose: () => {},
        },
      ],
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(h.querySelector(".choices")).toBeNull();
    expect(primary(h).disabled).toBe(false);
  });

  it("disables both buttons while busy", () => {
    const h = render({
      title: "Reset",
      busy: true,
      onConfirm: () => {},
      onCancel: () => {},
    });
    expect(primary(h).disabled).toBe(true);
    expect((h.querySelector(".ghost") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
