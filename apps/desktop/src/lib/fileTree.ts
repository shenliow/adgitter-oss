/**
 * Build a nested folder/file tree from a flat list of entries, so panels can
 * render a grouped layout from the mockups (top_folder / second_level →
 * files, third_level → nested files).
 *
 * Generic over any entry with a `path: string` — used both for committed
 * `FileChange`s (CommitDetails/FileTree.svelte) and working-tree
 * `StatusEntry`s (FilesPanel.svelte).
 */
import type { FileChange } from "./ipc";

export interface FileNode<T extends { path: string } = FileChange> {
  type: "file";
  name: string;
  change: T;
}

export interface DirNode<T extends { path: string } = FileChange> {
  type: "dir";
  /** Collapsed display name, e.g. "top_folder / second_level". */
  name: string;
  children: TreeNode<T>[];
}

export type TreeNode<T extends { path: string } = FileChange> =
  | DirNode<T>
  | FileNode<T>;

interface MutableDir<T extends { path: string }> {
  name: string;
  dirs: Map<string, MutableDir<T>>;
  files: T[];
}

function emptyDir<T extends { path: string }>(name: string): MutableDir<T> {
  return { name, dirs: new Map(), files: [] };
}

/** Group entries by their directory path into a nested tree. */
export function buildTree<T extends { path: string }>(
  entries: T[],
): TreeNode<T>[] {
  const root = emptyDir<T>("");

  for (const f of entries) {
    const parts = f.path.split("/");
    parts.pop(); // drop the filename; only directories remain
    let dir = root;
    for (const part of parts) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = emptyDir<T>(part);
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.files.push(f);
  }

  return materialize(root).children;
}

/** Group changed files by their directory path into a nested tree. */
export function buildFileTree(files: FileChange[]): TreeNode<FileChange>[] {
  return buildTree(files);
}

/**
 * Convert the mutable tree to display nodes, collapsing single-child directory
 * chains ("a/b/c") into one node, matching the "top_folder / second_level"
 * display in the design. Dirs sort before files; both sort alphabetically.
 */
function materialize<T extends { path: string }>(
  dir: MutableDir<T>,
): DirNode<T> {
  const children: TreeNode<T>[] = [];

  const subdirs = [...dir.dirs.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const sub of subdirs) {
    let node = materialize(sub);
    let name = sub.name;
    // Collapse a directory that has exactly one sub-dir and no files.
    let cur = sub;
    while (cur.dirs.size === 1 && cur.files.length === 0) {
      const only = [...cur.dirs.values()][0];
      name = `${name} / ${only.name}`;
      cur = only;
      node = materialize(cur);
    }
    children.push({ type: "dir", name, children: node.children });
  }

  const files = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of files) {
    const parts = f.path.split("/");
    children.push({ type: "file", name: parts[parts.length - 1], change: f });
  }

  return { type: "dir", name: dir.name, children };
}
