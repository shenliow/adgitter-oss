/**
 * The paid partition, when this build has it.
 *
 * The paid UI lives in the `pro` directory next to `lib`, which only the
 * private repository has. This module looks for it with an eager glob: in a
 * build without it the glob matches nothing, `pro` is `null`, and every paid
 * surface falls back to its locked state. Nothing in the free code imports
 * from that directory directly; it all goes through here.
 *
 * The paid code may import the free code freely, never the other way round.
 */
import type { Component } from "svelte";
import type { Commit, RefList } from "./ipc";
import type { LogAnytimeSettings } from "./settings";
import type { GraphThemePack } from "./graphTheme";
import type { CatalogTheme } from "./themes/catalog";
import type { SearchIssue } from "./search";
import type { TutorialAction, TutorialEvent } from "./tutorial/types";
import type { TokenProvider } from "../components/tutorial/firstUseProviders";

/** What the app tells the issue surface. */
export interface IssueSurfaceProps {
  repoPath: string | null;
  refs: RefList | null;
  /** The commit selected in the graph: the panel opens on its branch's issue. */
  selected: Commit | null;
  /** The commits on screen, for working out which branch a commit is on. */
  commits: Commit[];
  /** The tracker is not available here (free tier, or not entitled). */
  locked: boolean;
  /** The tutorial's demo repository is open: the panel runs on demo issues. */
  tutorialDemo: boolean;
  /** The panel is showing. Bindable: the toolbar reflects it. */
  open?: boolean;
  /** Issues the top-bar search can find (empty unless a tracker is bound). */
  searchable?: SearchIssue[];
  guard: (action: TutorialAction) => boolean;
  onTutorialEvent: (event: TutorialEvent) => void;
  /** Re-read the graph after the panel changed the repository. */
  onRefresh: () => Promise<void>;
  /** Select a branch in the graph, as a click on it would. */
  onSelectBranch: (name: string) => void;
  /** Mark a branch as the selected one without moving the graph. */
  onShowBranch: (name: string) => void;
  onError: (error: unknown) => void;
  /** Show an already-translated error message. */
  onErrorText: (message: string) => void;
  /** Open Settings on the issue tracker tab. */
  onOpenSettings: () => void;
}

/** What the app can ask of the issue surface. */
export interface IssueSurfaceApi {
  /** The toolbar button. */
  toggle(): Promise<void>;
  /** An issue picked in the top-bar search. */
  selectFromSearch(id: string): Promise<void>;
  /** "Go to linked issue" on a branch or a commit. */
  goToLinked(issueNumber: number): Promise<void>;
  /** The issue a branch is linked to, if any. */
  linkedIssue(branch: string): number | null;
  /** Forget everything loaded (tutorial start and end, repo switches). */
  reset(): void;
  /** The window came back to the front: re-sync the open issue. */
  windowFocused(): void;
  /** Settings bound, re-scoped or unbound the tracker. */
  bindingChanged(binding: unknown): void;
}

export interface IssueSettingsProps {
  repoPath: string | null;
  onBindingChanged?: (binding: unknown) => void;
}

export interface ProModule {
  IssueSurface: Component<
    IssueSurfaceProps,
    IssueSurfaceApi,
    "open" | "searchable"
  >;
  IssueSettingsPanel: Component<IssueSettingsProps>;
  /** Log Anytime's paid section: background execution and compaction. */
  LogAnytimePaid: Component<
    { value: LogAnytimeSettings; repoPath?: string | null },
    Record<string, never>,
    "value"
  >;
  /** A repository loaded its config: restore its tracker binding. A plain
   *  function, not on the surface, which only mounts once the repo is open. */
  restoreIssueBinding(path: string): void;
  /** The trackers the first-use guide explains tokens for. */
  issueTokenProviders(): TokenProvider[];
  /** The store's graph themes, bundled with the app. */
  graphThemes: GraphThemePack[];
  /** The store's CSS themes, bundled with the app. */
  cssThemes: CatalogTheme[];
}

const found = import.meta.glob<{ default: ProModule }>("../pro/index.ts", {
  eager: true,
});

export const pro: ProModule | null = Object.values(found)[0]?.default ?? null;
