import { describe, it, expect } from "vitest";
import {
  buildFileTree,
  buildTree,
  type DirNode,
  type TreeNode,
} from "./fileTree";
import type { FileChange } from "./ipc";

function f(path: string): FileChange {
  return {
    path,
    status: "modified",
    old_path: null,
    insertions: 1,
    deletions: 0,
  };
}

describe("buildFileTree", () => {
  it("groups files under their directories", () => {
    const tree = buildFileTree([f("src/a.ts"), f("src/b.ts"), f("readme.md")]);
    const dir = tree.find((n) => n.type === "dir") as DirNode;
    expect(dir.name).toBe("src");
    expect(dir.children.map((c) => c.name).sort()).toEqual(["a.ts", "b.ts"]);
    expect(tree.some((n) => n.type === "file" && n.name === "readme.md")).toBe(
      true,
    );
  });

  it("collapses single-child directory chains", () => {
    const tree = buildFileTree([f("a/b/c/file.ts")]);
    const dir = tree.find((n) => n.type === "dir") as DirNode;
    expect(dir.name).toBe("a / b / c");
    expect(dir.children).toHaveLength(1);
    expect(dir.children[0].name).toBe("file.ts");
  });

  it("sorts dirs before files, both alphabetically, regardless of input order", () => {
    const tree = buildFileTree([
      f("z.ts"),
      f("b/two.ts"),
      f("a.ts"),
      f("a/one.ts"),
    ]);
    // dirs ("a", "b") sorted before files ("a.ts", "z.ts"); dirs and files
    // each alphabetical among themselves.
    expect(tree.map((n) => n.name)).toEqual(["a", "b", "a.ts", "z.ts"]);
  });
});

describe("buildTree (generic)", () => {
  interface Entry {
    path: string;
    id: number;
  }
  function e(path: string, id: number): Entry {
    return { path, id };
  }

  it("builds the same shape for any entry with a `path`", () => {
    const tree = buildTree<Entry>([e("src/a.ts", 1), e("readme.md", 2)]);
    const dir = tree.find((n) => n.type === "dir") as DirNode<Entry>;
    expect(dir.name).toBe("src");
    expect(dir.children).toHaveLength(1);
    const [leaf] = dir.children as TreeNode<Entry>[];
    expect(leaf.type).toBe("file");
    expect(leaf.type === "file" && leaf.change.id).toBe(1);
  });
});
