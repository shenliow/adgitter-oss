/**
 * Message catalogs. `en` is the source/fallback; every key any UI uses must
 * exist here. Other locales are `Partial` and filled incrementally — a missing
 * key falls back to `en` at runtime. Params are `{name}`-style placeholders.
 *
 * (A lightweight, type-safe runtime stands in for the Paraglide compiler; the catalog shape keeps a later migration
 * mechanical.)
 *
 * The non-launch locales live in their own files under ./locales so
 * each can be translated and reviewed independently; `Catalog` keeps them in
 * lockstep with the `en` source's keys.
 */
import { zhHans } from "./locales/zhHans";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { hi } from "./locales/hi";
import { de } from "./locales/de";
import { fr } from "./locales/fr";

export type Locale =
  | "en"
  | "zh-Hant"
  | "zh-Hans"
  | "ja"
  | "ko"
  | "hi"
  | "de"
  | "fr";

/** Launch locales with their endonym (shown in the switcher). */
export const LOCALES: { code: Locale; name: string }[] = [
  { code: "en", name: "English" },
  { code: "zh-Hant", name: "繁體中文" },
  { code: "zh-Hans", name: "简体中文" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "hi", name: "हिन्दी" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
];

export const en = {
  // common
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.ok": "OK",
  "common.create": "Create",
  "common.open": "Open",
  "common.reset": "Reset",
  "common.dismiss": "Dismiss",
  // top bar
  "topbar.repoFallback": "Repository_name",
  "topbar.searchScope": "this project",
  "topbar.settings": "Settings",
  "topbar.account": "Account",
  "topbar.back": "Back to repositories",
  // search
  "search.placeholder": "Search commits, branches, tags…",
  "search.noResults": "No matches",
  // scope picker: which field the query is compared against. The `all` option
  // reuses `topbar.searchScope` ("this project") — same words, one string.
  "search.scope.commits": "Commits",
  "search.scope.message": "Message",
  "search.scope.author": "Author",
  "search.scope.hash": "Hash",
  "search.scope.time": "Time",
  "search.scope.branch": "Branch",
  "search.scope.tag": "Tag",
  "search.placeholder.commits": "Search commits…",
  "search.placeholder.message": "Search commit messages…",
  "search.placeholder.author": "Search by author name or email…",
  "search.placeholder.hash": "Search by commit hash…",
  "search.placeholder.time": "Search by date, e.g. 2026-08 or 2026-08-19…",
  "search.placeholder.branch": "Search branches…",
  "search.placeholder.tag": "Search tags…",
  // log anytime
  "logAnytime.enable": "Enable Log Anytime",
  "logAnytime.desc":
    "While the app is open, snapshot your working tree to a dedicated branch on a timer — a safety net you can roll back to.",
  "logAnytime.branch": "Log branch",
  "logAnytime.interval": "Snapshot every",
  "logAnytime.minutes": "minutes",
  // log anytime — paid (Advance+)
  "logAnytime.paidSection": "Background & compaction (Advance+)",
  "logAnytime.background": "Run in the background",
  "logAnytime.periodicSquash": "Periodic compaction",
  "logAnytime.autoPush": "Auto-push",
  "logAnytime.locked": "Requires the Advance plan",
  "logAnytime.compactNow": "Compact now",
  "logAnytime.compacting": "Compacting…",
  "logAnytime.compactDone": "Log history compacted.",
  "logAnytime.compactNoop": "Already compact.",
  "logAnytime.compactFailed": "Compaction is unavailable.",
  "logAnytime.noRepo": "Open a repository to configure Log Anytime.",
  // crash window
  "crash.title": "Something went wrong",
  "crash.body":
    "ADGitter hit an unexpected error. Your repository is safe on disk.",
  "crash.reported": "A diagnostic report was sent.",
  "crash.reload": "Reload",
  "crash.dismiss": "Dismiss",
  // user menu
  "user.language": "Language",
  "user.upgrade": "Upgrade",
  "user.logout": "Log out",
  "user.replayTutorial": "Watch the guided tour again",
  "user.signIn": "Sign in",
  "user.signingIn": "Continue in browser…",
  "user.signedOut": "Not signed in",
  "user.signInUnavailable": "Sign-in not configured",
  "user.planCurrent": "Current plan: {plan}",
  // Top tier: nothing left to buy, so the account menu's button manages the
  // existing subscription instead of selling another one. The tooltip has to
  // say what it opens — an enabled button labelled only "Manage subscription"
  // gives no hint that it leaves the app for Polar's portal.
  "user.manageSubscription": "Manage subscription",
  "user.manageSubscriptionTitle":
    "Top plan — cancel, change payment method, or view invoices",
  // Shown when the portal has nothing to open: the account has no subscription
  // on record. Phrased as a finding, not a failure.
  "portal.noSubscription": "No subscription found for this account.",
  // welcome
  "welcome.greeting": "Welcome",
  "welcome.greetingName": "Welcome {name}",
  "welcome.newOpen": "New / Open",
  "welcome.removeRecent": "Remove from recents",
  // guided tutorial — overlay & coach card
  "tutorialUi.dialogLabel": "Interactive tutorial",
  "tutorialUi.progressLabel": "Step {index} of {total}",
  "tutorialUi.back": "Back",
  "tutorialUi.next": "Next",
  "tutorialUi.continue": "Continue",
  "tutorialUi.retry": "Retry",
  "tutorialUi.working": "Working…",
  "tutorialUi.blockedHint":
    "Only the highlighted area is active right now. Follow the instructions in this card.",
  "tutorialUi.exit": "Exit tutorial",
  "tutorialUi.exitConfirmTitle": "Exit the tutorial?",
  "tutorialUi.exitConfirmBody":
    "The demo repository will be removed. You can replay the tutorial any time from the account menu.",
  "tutorialUi.exitKeep": "Keep going",
  "tutorialUi.exitConfirm": "Exit",
  // guided tutorial — welcome tour
  "welcomeTour.title": "Welcome to ADGitter",
  "welcomeTour.intro":
    "A Git client you drive with gestures. Here is what you can do:",
  "welcomeTour.graph.title": "A graph you can touch",
  "welcomeTour.graph.body":
    "Your whole history as a clear, lane-by-lane map. Click, box-select and drag right on it.",
  "welcomeTour.drag.title": "Drag to merge, rebase, cherry-pick",
  "welcomeTour.drag.body":
    "Drop one branch or commit onto another and ADGitter asks the one question that matters.",
  "welcomeTour.undo.title": "One-click undo",
  "welcomeTour.undo.body":
    "Changed your mind about a merge, a rebase or a reset? Undo it and carry on.",
  "welcomeTour.surgery.title": "History surgery",
  "welcomeTour.surgery.body":
    "Purge a file that should never have been committed, add a forgotten one, or fix an old commit message.",
  "welcomeTour.logAnytime.title": "Log Anytime time machine",
  "welcomeTour.logAnytime.body":
    "Snapshots your work in the background, so you can rewind to any moment.",
  "welcomeTour.themes.title": "Themes",
  "welcomeTour.themes.body":
    "Make the graph yours with colours and styles from the theme store.",
  "welcomeTour.issues.title": "Issue tracker built in",
  "welcomeTour.issues.body":
    "Connect Jira, Asana, GitLab or GitHub, then branch from an issue and update it as you work.",
  "welcomeTour.next": "Next",
  "welcomeTour.back": "Back",
  "welcomeTour.pageLabel": "Page {page} of {total}",
  "welcomeTour.choiceTitle": "How would you like to start?",
  "welcomeTour.startTitle": "Start the interactive tutorial",
  "welcomeTour.startBody":
    "Practise every gesture on a disposable demo repository. Nothing touches your own projects.",
  "welcomeTour.directTitle": "Use ADGitter directly",
  "welcomeTour.directBody":
    "Skip the tutorial. You can replay it any time from the account menu.",
  // first-use guide
  "firstUse.title": "Getting started",
  "firstUse.pageLabel": "Page {page} of {total}",
  "firstUse.next": "Next",
  "firstUse.back": "Back",
  "firstUse.close": "Close",
  "firstUse.repo.title": "Start with a repository",
  "firstUse.repo.intro":
    "ADGitter works on a Git repository in a folder on your computer. Both ways start on the Welcome screen.",
  "firstUse.repo.createTitle": "Create an empty repository",
  "firstUse.repo.createBody":
    "Click New / Open, choose a folder that is not a Git project yet and confirm Create. ADGitter runs git init for you.",
  "firstUse.repo.openTitle": "Open an existing repository",
  "firstUse.repo.openBody":
    "Click New / Open and choose a folder that already holds a Git project, or click a recent project's avatar to jump back in.",
  "firstUse.remote.title": "Connect a remote",
  "firstUse.remote.intro":
    "A remote repository on GitHub, GitLab, Bitbucket or Azure DevOps is where you back up and share your commits.",
  "firstUse.remote.cloneTitle": "Start from a remote",
  "firstUse.remote.cloneBody":
    "In New / Open choose “Clone a remote repository”, paste its Git URL, pick a location and add an access token if the repository is private.",
  "firstUse.remote.settingsTitle": "Add a remote to a local repository",
  "firstUse.remote.settingsBody":
    "Create an empty repository on your provider first. Then open Settings → General → Remote & authentication and enter its HTTPS URL and your access token.",
  "firstUse.remote.sshHint":
    "Prefer SSH? Leave the Remote URL empty and ADGitter connects with your SSH key.",
  "firstUse.tokens.title": "Personal access tokens",
  "firstUse.tokens.intro":
    "A personal access token (PAT) is a password-like key that lets ADGitter push, pull or read issues for you without your real password. Create it on the provider's website, copy it right away and paste it into ADGitter.",
  "firstUse.tokens.where":
    "Git tokens go in Settings → General → Access token. Issue tracker tokens go in Settings → Issue Panel.",
  "firstUse.tokens.safety":
    "Treat a token like a password: give it only the access it needs, set an expiry date and never share or commit it.",
  "firstUse.tokens.tabGit": "Git providers",
  "firstUse.tokens.tabIssues": "Issue trackers",
  "firstUse.tokens.openPage": "Open token page",
  "firstUse.tokens.scopes": "Required access",
  "firstUse.tokens.steps": "How to create one",
  "firstUse.git.github.scopes":
    "Classic token: the repo scope. Fine-grained token: Repository permissions → Contents: Read and write.",
  "firstUse.git.github.steps":
    "Open Settings → Developer settings → Personal access tokens.\nChoose Generate new token.\nSet the access above, generate it and copy the token. GitHub shows it only once.",
  "firstUse.git.gitlab.scopes":
    "The read_repository and write_repository scopes (or api).",
  "firstUse.git.gitlab.steps":
    "Open User settings → Access tokens and choose Add new token.\nName it, set an expiry date and tick the scopes above.\nCreate the token and copy it.",
  "firstUse.git.bitbucket.scopes":
    "A Repository Access Token with Repositories: Write (Read is included). App passwords no longer work.",
  "firstUse.git.bitbucket.steps":
    "Open your repository, then Repository settings → Security → Access tokens.\nChoose Create Repository Access Token and give it a name.\nTick Repositories: Write (Read is included), create it, then copy the token and use it as the access token in ADGitter.",
  "firstUse.git.azure.scopes": "Code: Read & write.",
  "firstUse.git.azure.steps":
    "Open User settings → Personal access tokens and choose New Token.\nPick your organization and an expiry date, then Custom defined scopes.\nTick Code: Read & write, create the token and copy it.",
  "firstUse.issue.jira.scopes":
    "An Atlassian API token (nothing to tick). Your account needs permission to edit issues in the project. Use it together with your Atlassian email.",
  "firstUse.issue.jira.steps":
    "Open the Atlassian API tokens page and choose Create API token.\nGive it a label and an expiry date.\nCreate it and copy the token.",
  "firstUse.issue.asana.scopes":
    "A personal access token, which has the same access as your Asana account (nothing to tick).",
  "firstUse.issue.asana.steps":
    "Open My apps in the Asana developer console.\nChoose Create new token and name it.\nCopy the token.",
  "firstUse.issue.gitlab.scopes": "The api scope.",
  "firstUse.issue.gitlab.steps":
    "Open User settings → Access tokens and choose Add new token.\nName it, set an expiry date and tick api.\nCreate the token and copy it.",
  "firstUse.issue.github.scopes":
    "Fine-grained token: Repository permissions → Issues: Read and write. A classic token needs the repo scope instead.",
  "firstUse.issue.github.steps":
    "Open Settings → Developer settings → Fine-grained tokens and choose Generate new token.\nSelect the repositories and set Issues: Read and write.\nGenerate it and copy the token.",
  "firstUse.done.title": "You are all set",
  "firstUse.done.body":
    "Open or create a repository to begin. You can replay the tutorial any time from the account menu.",
  "window.lockedUpsell": "Multi-window is a paid feature.",
  // toolbar
  "toolbar.branches": "Branches & tags",
  "toolbar.files": "Changed files",
  "toolbar.push": "Push",
  "toolbar.pushOptions": "More push options",
  "toolbar.forcePush": "Force push",
  "toolbar.pull": "Pull",
  "toolbar.undo": "Undo",
  "toolbar.undoBlockedExternal":
    "Undo is unavailable: this repository was changed outside ADGitter. Make a change here to use Undo again.",
  "toolbar.logAnytime": "Log Anytime",
  // status bar
  "status.ahead": "Ahead",
  "status.behind": "Behind",
  "status.signedOut": "Not signed in",
  "status.configUnreadable": "Repo settings unreadable",
  "status.configUnreadableHint":
    "adgitter.config.json could not be read, so this repo is using default settings. The original file was copied to {file} — nothing was overwritten.",
  "status.configUnsavableHint":
    "adgitter.config.json could not be read, and could not be copied aside either. Settings changes are NOT being saved for this repo until you fix or move that file — nothing will be overwritten.",
  // time axis
  "time.today": "Today",
  "time.yesterday": "Yesterday",
  // empty states
  "empty.openRepo": "Open a repository",
  "empty.openHint": "Choose a local Git project to visualize.",
  "empty.firstBranch": "Create your first Branch",
  // open-or-create dialog
  "openCreate.prompt":
    "Please choose a location to open an existing git project or create a new one",
  "openCreate.targetLocation": "Target Location",
  "openCreate.cloneLink": "Clone a remote repository →",
  // clone dialog
  "clone.projectLabel": "Project Label",
  "clone.gitUrl": "Git URL",
  "clone.location": "Location",
  "clone.pat": "Personal access token (PAT)",
  "clone.patHint":
    "Optional: private https repos need a token (GitHub PAT / GitLab access token / Bitbucket access token). Leave empty for public repos or ssh:// URLs (system SSH keys are used).",
  "clone.cloning": "Cloning…",
  // onboarding confirms
  "confirm.openRepo":
    "The directory you chose contains an existing repository. Open it?",
  "confirm.createRepo":
    "The directory you chose doesn't contain a git project. Create one here?",
  // common (extra)
  "common.close": "Close",
  // files panel
  "files.title": "Changes",
  "files.conflicted": "Conflicted",
  "files.staged": "Staged",
  "files.changed": "Changed",
  "files.untracked": "Untracked",
  "files.ignored": "Ignored",
  "files.loading": "Loading…",
  "files.clean": "Working tree clean.",
  "files.stage": "Stage",
  "files.unstage": "Unstage",
  "files.discard": "Discard changes",
  "files.openFile": "Open in default editor",
  "commit.message": "Commit message",
  "commit.usingAccountEmail":
    "No git user.email is set here — this commit will be authored as {email}.",
  "commit.usingAccountEmailHow":
    "Set git config user.email to commit under a different address.",
  "commit.title": "New commit",
  "commit.create": "Commit {n}",
  "commit.creating": "Committing…",
  // commit bar (Files panel footer) — the inline variant of the dialog above
  "commit.commitStaged": "Commit {count} staged",
  "commit.nothingStaged": "Nothing staged",
  // commit details
  "commitDetails.filter": "filter",
  "commitDetails.loading": "Loading changes…",
  "commitDetails.noChanges": "No file changes.",
  "commitDetails.history": "File history",
  "commitDetails.historyEmpty": "No history for this file.",
  "commitDetails.editMessage": "Edit commit message",
  "commitDetails.save": "Save",
  "commitDetails.copyBranch": "Copy branch name ({branch})",
  "commitDetails.copyHash": "Copy full commit hash ({sha})",
  "commitDetails.copied": "Copied",
  "commitDetails.viewDiff": "View diff",
  "commitDetails.purgeFile": "Remove file from history",
  "commitDetails.linkedIssue": "Open linked issue",
  "commitDetails.addFile": "Add file",
  "commitDetails.addFilePickerTitle": "Add a working-tree file",
  "commitDetails.addFileEmpty": "No changed files in the working tree.",
  // diff viewer
  "diff.loading": "Loading diff…",
  "diff.none": "No diff.",
  "diff.noChanges": "No changes.",
  "diff.binary": "Binary file — no text diff.",
  // branch edit
  "branchEdit.name": "Branch Name",
  "branchEdit.color": "Color",
  "branchEdit.upstream": "Upstream",
  "branchEdit.upstreamNone": "(none)",
  // branches panel row actions
  "branchesPanel.addTag": "Add tag here",
  "branchesPanel.addTagPlaceholder": "Tag name",
  "branchesPanel.edit": "Edit",
  "branchesPanel.fork": "Fork here",
  "branchesPanel.forkPlaceholder": "New branch name",
  "branchesPanel.goToIssue": "Go to linked issue",
  "branchesPanel.noUpstream": "No upstream configured",
  // confirm-rewrite
  "confirmRewrite.note": "This can be undone afterwards.",
  "confirmRewrite.messagePlaceholder": "New commit message",
  "confirmRewrite.chooseBranch": "Which branch is the target?",
  "confirmRewrite.chooseSourceBranch": "Which branch is the source?",
  "confirmRewrite.chooseResetTarget": "Reset to which branch or commit?",
  // general settings panel
  "general.autoPull": "Auto Pull",
  "general.off": "Off",
  "general.warning": "Warning",
  "general.beforeCreateBranch": "Before Create Branch",
  "general.beforePush": "Before Push",
  "general.beforeCommit": "Before Commit",
  "general.notify": "Notify",
  "general.always": "Always",
  "general.autoPullSeconds": "Response time",
  "general.seconds": "seconds",
  "autoPull.title": "{before}: pull from the remote?",
  "autoPull.body":
    "Pull brings this branch up to date before the operation runs. “Not now” runs it without pulling; “Cancel” abandons it.",
  "autoPull.skipped":
    "“Not now” pressed — the operation continues without pulling.",
  "autoPull.cancelled": "“Cancel” pressed — the operation was interrupted.",
  "autoPull.failed": "{before}: the pull failed, so nothing was run. {reason}",
  "autoPull.conflicted":
    "{before}: the pull stopped on conflicts — resolve them first; nothing was run.",
  "autoPull.pending": "An auto-pull prompt is still waiting for an answer.",
  "general.unstaged": "UnStaged Files",
  "general.undoRedo": "Undo / Redo",
  "general.times": "Times",
  "general.git": "Git",
  "general.dryRun": "Dry Run",
  "general.gitIdentity": "Git identity",
  "general.gitName": "Git name",
  "general.gitEmail": "Git email",
  "general.useProjectEmail": "Use project identity",
  "general.gitEmailHintGlobal":
    "Git identity applies to all repositories (~/.gitconfig)",
  "general.gitEmailHintProject":
    "Only this repository (.git/config); overrides the global Git identity",
  "general.useAccountIdentity": "Use signed-in account identity",
  "general.accountIdentityHint":
    "Only this repository (.git/config); overwrites it with the account identity",
  "general.accountIdentityNoAccount": "Sign in to use your account identity",
  "general.identityFallbackHint":
    "Since no name / email is specified, the default will be substituted",
  "general.hideGhosts": "Hide unreferenced commits",
  "general.hideGhostsHint":
    "Commits kept only by undo backups after a history rewrite",
  "general.remoteHeading": "Remote & authentication",
  "general.remoteUrl": "Remote URL",
  "general.accessToken": "Access token",
  "general.authHint":
    "Uses an HTTPS access token (PAT) for fetch / pull / push. Password authentication is not supported.",
  "general.openTokenPage": "Where do I get a token?",
  "general.remoteNoRepo":
    "Open a repository to configure its remote URL and access token.",
  "general.remoteOverrideHint":
    "This repository's .git remote is {url}. Enter a URL here to use it instead (with your token); leave it empty to keep the .git remote and connect with an SSH key.",
  // resizable dock panels
  "panel.resize": "Drag to resize panel",
  // remote-auth gating
  "remote.notHttps":
    "An access token is set, but this remote isn't an HTTPS URL — a token only works over HTTPS (and would leak over plain http). Push, pull, and creating merge requests or issues are disabled. Clear the token to connect over SSH, or switch the remote to an HTTPS URL.",
  // personalize panel
  "personalize.graphTheme": "Graph theme",
  "personalize.textSize": "Text size",
  "personalize.small": "Small",
  "personalize.medium": "Medium",
  "personalize.large": "Large",
  "personalize.preview": "Preview",
  "personalize.apply": "Apply",
  "personalize.inUse": "In use",
  "personalize.font": "Font",
  "personalize.fontSystem": "System",
  "personalize.fontSans": "Sans-serif",
  "personalize.fontMono": "Monospace",
  "personalize.buy": "Buy",
  "personalize.owned": "Owned",
  "personalize.author": "Author",
  "personalize.refreshPurchase": "Refresh purchase",
  // built-in graph-theme descriptions (lib/graphTheme.ts `descriptionKey`).
  // Remote packs carry a raw `description` string instead — see PersonalizePanel.
  "graphTheme.default.description":
    "The built-in metro graph — clean rails and solid nodes.",
  "graphTheme.midnight.description":
    "A dark navy canvas with soft, bright lanes — easy on the eyes at night.",
  "graphTheme.synthwave.description":
    "Retro-futuristic neon-sunset skin: glowing branch-tinted nodes, lane-coloured glow rails, a striped sun and CRT scanlines.",
  "graphTheme.blueprint.description":
    "Technical-drawing look: blueprint-blue background, cross-hatch rails and drafting-compass nodes.",
  "graphTheme.hero.description":
    "Pixel-art RPG world: a sword-and-shield hero, a village, and stone-road rails winding across the map.",
  // shortcut panel
  "shortcut.pressKeys": "Press keys…",
  "shortcut.conflict": "Some shortcuts conflict — resolve them before saving.",
  "shortcut.restoreDefaults": "Restore defaults",
  // shortcut action names (lib/keymap.ts `labelKey`; the ids are persisted
  // settings keys and must never change, only these labels are localized)
  "shortcut.action.switchHandTool": "Switch Hand Tool",
  "shortcut.action.pull": "Pull",
  "shortcut.action.push": "Push",
  "shortcut.action.newBranch": "New Branch",
  "shortcut.action.newTag": "New Tag",
  "shortcut.action.showBranchPanel": "Show Branch Panel",
  "shortcut.action.showTagPanel": "Show Tag Panel",
  "shortcut.action.showSettingPanel": "Show Setting Panel",
  // commit context menu
  "menu.cherryPickOnto": "Cherry-pick onto {branch}",
  "menu.revert": "Revert this commit",
  "menu.reword": "Reword message…",
  "menu.squash": "Squash into one commit…",
  "menu.resetMixed": "Reset branch here (mixed)",
  "menu.resetHard": "Reset branch here (hard)",
  "menu.drop": "Drop this commit",
  // branch context menu
  "menu.checkout": "Checkout",
  "menu.mergeIntoParent": "Merge {branch} into…",
  "menu.rebaseOntoParent": "Rebase onto {branch}…",
  "menu.branchCurrent": "{branch} (current)",
  "menu.checkoutTag": "Tag {tag}",
  "menu.checkoutDetached": "This commit ({short}, detached)",
  "menu.createBranchHere": "Create branch here…",
  "menu.createBranchFrom": "Create branch from {branch}…",
  "menu.branchProps": "Properties…",
  "menu.checkoutRemote": "Checkout…",
  // create-branch dialog
  "createBranch.title": "Create branch",
  "createBranch.from": "From",
  "createBranch.name": "Branch name",
  "createBranch.placeholder": "feature/my-branch",
  // checkout-remote-branch dialog
  "remoteAdopt.title": "Track this remote branch?",
  "remoteAdopt.body":
    "{branch} already exists locally but tracks nothing. Set its upstream to {remote} and check it out?",
  "remoteAdopt.confirm": "Set upstream & check out",
  "remotePull.title": "Pull to sync?",
  "remotePull.body":
    "{branch} is {behind} commit(s) behind {remote}. Pull now to fast-forward it?",
  "remotePull.confirm": "Pull",
  "remotePull.skip": "Not now",
  "notice.remoteInSync":
    "Checked out {branch} — already in sync with {remote}.",
  "notice.remoteLocalAhead":
    "Checked out {branch} — {ahead} commit(s) ahead of {remote}; nothing to pull.",
  "notice.remoteDiverged":
    "Checked out {branch} — it and {remote} have diverged ({ahead} ahead, {behind} behind); pulling would merge, so that is left to you.",
  "notice.remoteUpstreamSet":
    "{branch} now tracks {remote}, and is checked out.",
  "notice.remotePullSkipped":
    "Not pulled — {branch} is still {behind} commit(s) behind {remote}.",
  "remoteCheckout.title": "Checkout remote branch",
  "remoteCheckout.body":
    "{name} is a remote branch. Create a local branch to work on it?",
  "remoteCheckout.localName": "Local branch name",
  "remoteCheckout.create": "Create & checkout",
  "remoteCheckout.detached": "Checkout detached",
  // drag-HEAD checkout branch-chooser dialog
  "checkoutChoice.title": "Choose a branch to check out",
  "checkoutChoice.body":
    "This commit has more than one local branch. Which one do you want to check out?",
  // history-op confirm dialogs
  "op.revert.title": "Revert commit",
  "op.revert.body": "Create a new commit that undoes “{subject}”.",
  "op.revert.confirm": "Revert",
  "op.cherryPick.titleOne": "Cherry-pick commit",
  "op.cherryPick.titleMany": "Cherry-pick commits",
  "op.cherryPick.body": "Apply {what} onto {branch}.",
  "op.cherryPick.whatOne": "“{subject}”",
  "op.cherryPick.whatMany": "{n} commits",
  "op.cherryPick.confirm": "Cherry-pick",
  "op.reset.title": "Reset ({mode})",
  "op.reset.body": "Move {branch} to {short}. {effect}",
  "op.reset.effectHard": "Working-tree changes will be discarded.",
  "op.reset.effectSoft": "Changes are kept and stay staged.",
  "op.reset.effectKeep": "Changes are kept in the working tree.",
  "op.reset.confirm": "Reset",
  // graph drag tooltip (HEAD-crown reset gesture)
  "graph.resetTip.mixed": "Reset --mixed · keep changes, unstaged",
  "graph.resetTip.hard": "Reset --hard · discard all changes",
  "graph.resetTip.soft": "Reset --soft · keep changes staged",
  // graph drag tooltip (Shift-drag a commit selection onto a commit)
  "graph.rebaseTip": "Rebase {branch} onto {short}",
  "graph.cherryPickTip": "Cherry-pick {n} commits onto a new branch at {short}",
  "graph.backToTop": "Back to top",
  "op.drop.title": "Drop commit",
  "op.drop.body": "Remove “{subject}” and replay its descendants without it.",
  "op.drop.confirm": "Drop",
  "op.reword.title": "Reword commit",
  "op.reword.body":
    "Edit this commit’s message. Descendant commits are rewritten on top.",
  "op.reword.confirm": "Save message",
  "op.squash.title": "Squash commits",
  "op.squash.body":
    "Combine these {n} commits into one, with the message below. Descendant commits are rewritten on top.",
  "op.squash.confirm": "Squash",
  "op.purgeFile.title": "Remove file from history",
  "op.purgeFile.body":
    "Remove “{path}” from “{subject}” — and from every commit after it, up to the branch tip. This is a large edit: it rewrites this commit and all of its descendants.",
  "op.purgeFile.confirm": "Remove file",
  "op.addFile.title": "Add file to commit",
  "op.addFile.body":
    "Write “{path}” into “{subject}” — and every commit after it, up to the branch tip. This is a large edit: it rewrites this commit and all of its descendants.",
  "op.addFile.confirm": "Add file",
  "op.merge.title": "Merge branch",
  "op.merge.body": "Merge {source} into {branch} (fast-forward when possible).",
  "op.merge.confirm": "Merge",
  "op.mergeBranches.body":
    "Merge {source} into {target} (fast-forward when possible).",
  "op.mergeBranches.bodyCheckout":
    "Check out {target}, then merge {source} into it (fast-forward when possible).",
  "op.rebase.title": "Rebase branch",
  "op.rebase.body":
    "Replay {branch}’s commits onto {onto}. This rewrites those commits.",
  "op.rebase.confirm": "Rebase",
  "op.rebaseBranch.body":
    "Replay {branch}’s commits onto {onto}. This rewrites those commits.",
  "op.rebaseBranch.bodyCheckout":
    "Replay {branch}’s commits onto {onto}, then switch back to your current branch and restore your working tree exactly as it is now. This rewrites those commits.",
  "op.cherryPickNewBranch.title": "Cherry-pick onto new branch",
  "op.cherryPickNewBranch.bodyOne":
    "Create a new branch at {short} and cherry-pick 1 commit onto it.",
  "op.cherryPickNewBranch.bodyMany":
    "Create a new branch at {short} and cherry-pick {n} commits onto it.",
  "op.cherryPickNewBranch.confirm": "Cherry-pick",
  "op.removeBranch.title": "Remove branch",
  "op.removeBranch.body":
    "Delete the branch label “{name}”. Commits reachable only from it become unreachable (kept until garbage-collected).",
  "op.removeBranch.confirm": "Remove branch",
  "op.forcePush.title": "Force push",
  "op.forcePush.body":
    "This overwrites the remote branch with your local history. Commits other people pushed — and aren’t in your local history — can be permanently lost.",
  "op.forcePush.confirm": "Force push",
  // conflict resolution (resolve mode)
  "resolve.banner":
    "Conflict while applying {short} ({op} on {branch}) — resolve each conflicted file, stage it, then continue.",
  "resolve.continue": "Continue",
  "resolve.abort": "Abort",
  "resolve.stageAllFirst": "Stage every conflicted file to continue.",
  "resolve.abortConfirm.title": "Abort the paused operation?",
  "resolve.abortConfirm.body":
    "Everything is restored to the state before the operation started. Any conflict resolutions you made are discarded.",
  "resolve.abortConfirm.confirm": "Abort",
  "branch.head": "HEAD",
  "notice.undid": "Undid {op}",
  "notice.nothingToUndo": "Nothing to undo",
  "notice.pulled": "Pulled from upstream",
  "notice.pushed": "Pushed to upstream",
  "notice.forcePushed": "Force-pushed to upstream",
  "notice.dryRunPush": "Dry run — push skipped",
  "notice.dryRunPull": "Dry run — pull skipped",
  "notice.commitInFiles": "Stage and commit your changes in the Files panel.",
  "notice.reset": "Reset ({mode}) to {short}.",
  "notice.purged": "Removed {path} from history.",
  "notice.addedFile": "Added {path} to history.",
  "notice.squashed": "Squashed {n} commits into one.",
  "notice.resolved": "Conflicts resolved — {op} completed.",
  "notice.opAborted": "Operation aborted — previous state restored.",
  "notice.remapSkipped":
    "History rewritten, but these branches could not be re-based automatically (their changes conflict): {branches}",
  "notice.branchCreated": "Created branch {name}.",
  "notice.detachedAt": "Checked out {short} (detached HEAD).",
  "notice.openFailed": "Couldn't open {name}. Remove it from recents?",
  "notice.remoteCheckedOut":
    "Created and checked out {branch}, tracking the remote.",
  "notice.detachedCheckedOut": "Checked out {name} (detached HEAD).",
  // settings nav
  "settings.general": "General",
  "settings.shortcut": "Shortcut",
  "settings.issuePanel": "Issue Panel",
  "settings.account": "Account",
  "settings.personalize": "Personalize",
  "settings.themes": "Themes",
  "settings.plan": "Plan",
  "settings.logAnytime": "Log Anytime",
  "settings.devices": "Devices",
  "settings.scopeRepo": "Stored in this repository",
  "settings.scopeGlobalFallback": "No repository open — editing app defaults",
  // theme store
  "themeStore.lede": "Buy a theme once — it's yours to keep, on any plan.",
  "themeStore.refresh": "Refresh purchases",
  "themeStore.apply": "Apply",
  "themeStore.applied": "Applied",
  "themeStore.buy": "Buy ${price}",
  // A theme the store can show but this deployment can't sell (no Polar
  // product mapped for it). Said up front, on a disabled button, rather than
  // as an error after the user has decided to buy.
  "themeStore.notForSale": "Not on sale yet",
  "themeStore.notForSale.hint":
    "This theme isn't available for purchase yet. Check back later.",
  // Remote theme delivery. Applying an owned theme can need a download,
  // and each way that can fail needs its own sentence — "you're offline" and
  // "you don't own this" call for different actions from the user. In every
  // case the theme in use is left untouched.
  "themeStore.downloading": "Downloading…",
  "themeStore.error.offline":
    "Couldn't download this theme — check your connection. Your current theme is unchanged.",
  "themeStore.error.signIn":
    "Sign in to download this theme. Your current theme is unchanged.",
  "themeStore.error.notOwned":
    "This theme isn't part of your purchases yet. Your current theme is unchanged.",
  "themeStore.error.notFound":
    "This theme is no longer available. Your current theme is unchanged.",
  "themeStore.error.rejected":
    "This theme failed its safety check and wasn't installed. Your current theme is unchanged.",
  // lazy sign-in checkout — shared by the plan panel
  // and the theme store, so both explain the same outcome the same way.
  "checkout.signingIn": "Waiting for sign-in…",
  "checkout.signInCancelled": "Sign-in was cancelled — nothing was purchased.",
  "checkout.signInTimedOut": "Sign-in timed out — nothing was purchased.",
  // Distinct from `signInCancelled`: the user came back, the sign-in itself was
  // refused (offline, rejected session, invalid license).
  "checkout.signInFailed":
    "Sign-in couldn't be completed — nothing was purchased.",
  "checkout.signInUnavailable": "Sign-in isn't available right now.",
  "checkout.unavailable": "Checkout isn't available right now.",
  // post-payment return trip (`adgitter://checkout-complete`). The payment
  // confirmation webhook can land after the browser sends the user back, so
  // "pending" has to be honest: still processing, nothing lost.
  "checkoutReturn.processing": "Finishing your purchase…",
  "checkoutReturn.unlockedTheme":
    "Purchase complete — your new theme is unlocked and ready to apply.",
  "checkoutReturn.unlocked":
    "Purchase complete — your account has been updated.",
  "checkoutReturn.pending":
    "Payment confirmation hasn't arrived yet. Nothing is lost — your purchase unlocks as soon as it does. Check again in a few minutes, or reopen ADGitter.",
  "checkoutReturn.signInNeeded": "Sign in to finish unlocking your purchase.",
  "checkoutReturn.checkAgain": "Check again",
  // account panel
  "account.signedOut":
    "Sign in to manage your account and unlock paid features.",
  "account.signIn": "Sign in",
  "account.signingIn": "Signing in…",
  "account.cancelSignIn": "Cancel",
  "account.signingInHint":
    "Finish signing in in your browser. It should return here on its own.",
  "account.signOut": "Sign out",
  // Sign-out consequence warning (2026-08-18 decision, copy shortened
  // 2026-09-21). Signing out destroys this device's licence, so the user is
  // told what goes and how it comes back *before* they confirm. Plain and
  // factual on purpose: no apology (nothing went wrong) and no scare wording
  // (this is a normal, reversible action) — just what happens, and what it
  // takes to undo.
  "account.signOutConfirm.title": "Sign out on this device?",
  "account.signOutConfirm.body":
    "Signing out removes the licence stored on this device: paid features and purchased themes become unavailable. Signing in again restores everything.",
  // The offline variant leads with the part that is actually different: the way
  // back is unavailable *right now*. Same facts, sharper ordering.
  "account.signOutConfirm.bodyOffline":
    "You appear to be offline. Signing in is verified online, so until you have a connection again you will not be able to get back into this account. Signing out still removes the licence stored on this device: paid features and purchased themes become unavailable. Everything returns when you sign in again.",
  "account.signOutIncomplete":
    "You are signed out, but the licence stored on this device could not be removed. Paid features may stay unlocked until you restart ADGitter.",
  "account.name": "Name",
  "account.email": "Email",
  // Shown only when the signed-in profile actually has a username (Clerk
  // profile from the sign-in bridge) — never as a permanent dash row.
  "account.username": "Username",
  "account.manageHint": "These open the account portal in your browser.",
  "account.emailCommitDefault":
    "Used as the commit author only when git has no user.email of its own; a configured user.email always wins.",
  "account.manageAccount": "Manage account",
  "account.password": "Password & security",
  "account.mfa": "Two-factor auth",
  // Tooltip on the always-visible "Two-factor auth" button, shown only once
  // the capability probe has returned and confirmed this instance has no
  // second factor set up yet (see AccountPanel's `manageItems`).
  "account.mfaNotConfigured":
    "Two-factor authentication isn't enabled for ADGitter yet, so Clerk's security page won't offer it until an administrator turns it on.",
  "account.organization": "Organization",
  "account.payment": "Payment methods",
  // plan panel
  "plan.currentBadge": "Current",
  "plan.upgrade": "Upgrade",
  "plan.refresh": "Refresh entitlement",
  "adGate.title": "The free version is ad-supported",
  "adGate.body":
    "ADGitter's free version shows one ad at the bottom of the window. The ad revenue is what lets us keep maintaining and developing it. If you'd rather not see ads, you can switch to a paid plan.",
  "adGate.data":
    "Ads are provided by Carbon Ads, which receives your IP address and browser details when an ad is shown.",
  "adGate.privacy": "Privacy Policy",
  "adGate.accept": "Accept ads and keep using it free",
  "adGate.buy": "Switch to a paid plan",
  "adGate.signIn": "Already paid? Sign in",
  "adGate.decline": "Don't accept ads",
  "ad.label": "Advertisement",
  "ad.fallback":
    "This ad space keeps ADGitter's free version going. Switch to a paid plan to remove it.",
  "ad.remove": "Remove ads",
  "crashConsent.label": "Error reports",
  "crashConsent.message":
    "Send crash and error reports to help us fix problems? Reports go through Sentry with emails and file paths removed, and never include your code. You can change this later in Settings → Privacy.",
  "crashConsent.allow": "Allow",
  "crashConsent.deny": "No thanks",
  "settings.privacy": "Privacy",
  "privacy.crashReports": "Send crash and error reports (Sentry)",
  "privacy.crashReportsHint":
    "Emails and file paths are removed first; no code or diffs are included.",
  "privacy.ads": "Free-version ads (Carbon Ads)",
  "privacy.adsPaid": "Paid plans show no ads and load no ad code.",
  "privacy.adsWithdrawPay":
    "You've accepted ads. If you withdraw, you'll need to accept them again or switch to a paid plan to keep using the free version.",
  "privacy.adsWithdrawFree":
    "You've accepted ads. If you withdraw, ads stop showing.",
  "privacy.adsNotGiven": "You haven't accepted ads, so none are loaded.",
  "privacy.adsWithdraw": "Withdraw consent",
  "trial.offer": "Try {plan} free for {days} days",
  "trial.note":
    "No card needed and nothing is charged. When it ends you're back on Free — buy any time to keep it. One trial per computer and per account.",
  "trial.start": "Start free trial",
  "trial.starting": "Starting…",
  "trial.active": "{plan} trial — ends on {date}.",
  "trial.ended": "Your {plan} trial ended on {date}.",
  "trial.used": "This computer or account has already used its free trial.",
  "trial.failed": "Couldn't start the trial right now. Please try again later.",
  "trial.badge": "Trial",
  "trial.buy": "Buy {plan}",
  "plan.feature": "Feature",
  "plan.free": "Free",
  "plan.basic": "Basic",
  "plan.advance": "Advance",
  "plan.enterprise": "Enterprise",
  "plan.feat.noAd": "Remove ads",
  "plan.feat.applyTheme": "Apply custom theme",
  "plan.feat.logBackground": "Log Anytime background + periodic squash",
  "plan.feat.tickets": "Priority support tickets",
  "plan.feat.seats": "Team seats",
  "plan.feat.devices": "Concurrent devices",
  "plan.seatsAddOn": "{seats} (add-ons available)",
  "deviceSeat.limitTitle": "Signed-in device limit exceeded",
  "deviceSeat.limitBody":
    "Press OK to sign the oldest device out and sign in with this one.",
  // devices panel
  "devices.usage": "{used} of {max} devices",
  "devices.thisDevice": "This device",
  "devices.remove": "Remove",
  "devices.lastSeen": "Last seen {when}",
  "devices.neverSeen": "Never seen",
  "devices.empty": "No devices yet. Sign in to sync this device.",
  // webhooks & integrations
  "webhook.provider.slack": "Slack",
  "webhook.provider.jira": "Jira",
  "webhook.provider.github": "GitHub",
  "webhook.provider.gitlab": "GitLab",
  "webhook.scope.send_notification": "Send notification",
  "webhook.scope.commit": "Commit",
  "webhook.scope.leave_comment": "Leave comment",
  "webhook.scope.create_branch": "Create branch",
  "webhook.scope.rename_branch": "Rename branch",
  "webhook.scope.delete_branch": "Delete branch",
  // external issue-provider binding
  "issueProvider.description":
    "Bind one external tracker to this repository. Its issues open in the Issue panel and edits sync back.",
  "issueProvider.noRepo": "Open a repository to bind an issue provider.",
  "issueProvider.providerLabel": "Provider",
  "issueProvider.deploymentLabel": "Deployment",
  "issueProvider.deployment.cloud": "Cloud",
  "issueProvider.deployment.selfHosted": "Self-hosted",
  "issueProvider.hostUrlLabel": "Host URL",
  "issueProvider.hostUrlPlaceholder": "https://…",
  "issueProvider.usernameLabel": "Email",
  "issueProvider.usernamePlaceholder": "you@example.com",
  "issueProvider.tokenLabel": "Access token",
  "issueProvider.tokenPlaceholder": "Paste a personal access token",
  "issueProvider.scopeHint.github":
    'Use a fine-grained token with the "Issues: Read and write" permission.',
  "issueProvider.scopeHint.gitlab":
    'Use a token with the "api" scope (or "read_api" for read-only).',
  "issueProvider.scopeHint.jira":
    'The token\'s account needs "Edit issues" permission on the target project.',
  "issueProvider.scopeHint.asana":
    "A personal access token inherits your Asana account's permissions.",
  "issueProvider.openTokenPage": "Where do I get a token?",
  "issueProvider.scopeLabel": "Scope",
  "issueProvider.scopePlaceholder": "Select a repository / project…",
  "issueProvider.loadingContainers": "Loading available projects…",
  "issueProvider.connect": "Connect",
  "issueProvider.connecting": "Connecting…",
  "issueProvider.disconnect": "Disconnect",
  "issueProvider.invalidToken": "That access token failed validation.",
  // ConnectionError detail lines (lib/issues/connection.ts `messageKey`)
  "issueProvider.errHostRequired": "Host URL is required for this provider.",
  "issueProvider.errEmailRequired": "Email is required for Jira Cloud.",
  "issueProvider.errVerifyFailed": "Could not verify the credential.",
  "issueProvider.switchHint":
    "Binding a provider replaces the one currently bound to this repository.",
  "issueProvider.boundTo": "Bound to {provider}",
  "issueProvider.state.disconnected": "Disconnected",
  "issueProvider.state.connected": "Connected",
  "issueProvider.state.error": "Error",
  "issueProvider.provider.jira": "Jira",
  "issueProvider.provider.asana": "Asana",
  "issueProvider.provider.gitlab": "GitLab",
  "issueProvider.provider.github": "GitHub",
  // Saved-credential state. The token itself is NEVER rendered — only this
  // masked tail — so the user can tell they have set one without the secret
  // going back into the DOM.
  "issueProvider.credentialSaved": "Access token saved {masked}",
  "issueProvider.credentialSavedHint":
    "Stored in your system keychain and reused automatically on the next launch.",
  "issueProvider.replaceToken": "Replace",
  "issueProvider.cancelReplace": "Keep the saved token",
  "issueProvider.reconnecting": "Reconnecting with the saved token…",
  "issueProvider.errCredentialRejected":
    "The saved access token was rejected by the provider — it was probably revoked or has expired. Choose Replace and paste a new one.",
  "issueProvider.errReconnectOffline":
    "Could not reach the provider, so the saved token was not re-checked. It is still stored; try again when you are back online.",
  "issueProvider.errTokenNotSaved":
    "Connected, but the token could not be written to your system keychain, so it will not be there next launch.",
  "issueProvider.scopeFilterPlaceholder": "Type to filter…",
  "issueProvider.scopeNoMatches": "No matching project",
  // new token dialog
  "error.REPO_NOT_FOUND": "Repository not found",
  "error.INVALID_PATH": "Invalid path",
  "error.GIT_ERROR": "Git error",
  "error.IO_ERROR": "File-system error",
  "error.INTERNAL_ERROR": "Something went wrong",
  "error.FEATURE_LOCKED": "This feature needs a paid plan",
  // Distinct from FEATURE_LOCKED on purpose: whoever sees these has most
  // likely paid, so neither may read as "buy something". Each names the one
  // action that fixes it.
  "error.LICENSE_DEVICE_MISMATCH":
    "This licence is registered to another device — sign in again to use it on this one",
  "error.LICENSE_EXPIRED":
    "Your licence has expired — renew it to keep using paid features",
  "error.NOT_SIGNED_IN": "Sign in to continue",
  "error.NO_SUBSCRIPTION": "No subscription found",
  "error.CONFLICT": "Conflict",
  "error.REMOTE_UPSTREAM_MISMATCH":
    "That local branch tracks a different remote branch",
  "error.MERGE_COMMIT_IN_RANGE": "Can't rewrite across a merge commit",
  "error.conflict":
    "{short} conflicts with the target — resolve it manually or undo the operation.",
  // issue panel & lifecycle
  "toolbar.issues": "Issues",
  "issue.search": "Search issues…",
  "issue.backToList": "Back to issue list",
  "issue.overflow": "More actions",
  "issue.refresh": "Refresh from provider",
  "issue.lockedUpsell": "Issue tracking is an Advance feature.",
  "issue.boundBranch": "Bound branch",
  "issue.linkedBranches": "Linked branches",
  // Panel opened with nothing to show — step 4 of the default-content chain.
  "issue.empty.title": "Issues",
  "issue.empty.pick": "Choose an issue to open.",
  "issue.empty.none": "The bound project has no issues yet.",
  "issue.empty.projectsFailed": "Could not load projects.",
  "issue.empty.retryProjects": "Retry",
  "issue.empty.pickProject": "Choose a project to view its issues.",
  "issue.empty.noMatch": "No issues match your search.",
  // Why the panel is empty, each naming its own fix (lib/issues/emptyReason.ts).
  // The `[[…]]` markers wrap the Settings → Issue Panel phrase so a future
  // renderer can split the string on them and turn that span into a link
  // that opens Settings on the Issue Panel tab. This is NOT HTML — the
  // renderer escapes both the wrapped and unwrapped halves as plain text —
  // so these strings must never be passed to `{@html}`. A string without
  // the marker (e.g. if a locale drops it) simply renders as plain text.
  "issue.empty.unbound":
    "No issue tracker is connected to this repository. Connect one in [[Settings → Issue Panel]].",
  "issue.empty.credentialMissing":
    "The access token for this repository's issue tracker is missing. Enter it again in [[Settings → Issue Panel]].",
  "issue.empty.loadFailed":
    "Could not load issues from the tracker. Check your connection, then the token in [[Settings → Issue Panel]].",
  "issue.hoursUnit": "h",
  "issue.status.created": "Created",
  "issue.status.in_progress": "In Progress",
  "issue.status.done": "Done",
  "issue.status.rejected": "Rejected",
  "issue.field.project": "Project",
  "issue.field.status": "Status",
  "issue.field.labels": "Labels",
  "issue.field.assignee": "Assignee",
  "issue.field.due": "Due",
  "issue.field.milestone": "Milestone",
  "issue.field.spend": "Spend",
  "issue.field.cost": "Cost",
  "issue.dueStart": "Start",
  "issue.dueEnd": "End",
  "issue.dueInvalid": "Start date must be on or before the end date.",
  "issue.noAssignee": "Unassigned",
  "issue.noMilestone": "No milestone",
  // Issue multi-select epic: the Project field's chip picker (Asana) reuses
  // this both as its placeholder (no project picked yet) and its
  // empty-filter text — same dual role `issue.noAssignee`/`issue.noMilestone`
  // already play for the single-select pickers.
  "issue.noProject": "No project",
  "issue.addLabel": "Add label",
  "issue.spendLockedHint": "Editable while in progress",
  // Shown next to a disabled field
  // whose provider can't write it back honestly — `{reason}` is the
  // adapter-supplied explanation (see each adapter's `unsupportedFields`).
  "issue.field.unsupportedHint": "Not supported by this tracker: {reason}",
  // The panel's failed-write
  // banner. `{reason}` is the provider's OWN message (a `ProviderError`'s),
  // never a generic apology — the recovery step differs per failure.
  // The two field-caveat
  // notices — a field that WRITES, but whose write has a consequence. The
  // `destructive` wording is deliberately louder than the `side_effect` one
  // (see `CaveatSeverity` in adapters/adapter.ts for why they must differ).
  "issue.field.caveatHint": "Heads up: {reason}",
  "issue.field.caveatDestructive": "Warning — this destroys data: {reason}",
  "issue.error.saveFailed":
    "Couldn't save that change — it has been undone: {reason}",
  "issue.error.refreshFailed": "Couldn't refresh this issue: {reason}",
  "issue.error.actionFailed": "That action didn't complete: {reason}",
  "issue.action.new": "New…",
  "issue.action.reject": "Reject",
  "issue.action.start": "Start",
  "issue.action.startNewBranch": "New Branch & Go",
  "issue.action.startJustGo": "Just Go",
  "issue.action.withdraw": "Withdraw",
  "issue.action.done": "Done",
  "issue.action.doneUpdateSpent": "Update spent & close",
  "issue.action.doneJustClose": "Just Close",
  "issue.action.reopen": "Reopen",
  "issue.rejectedReason": "Rejected: {reason}",
  "issue.comments.title": "Comments",
  "issue.comments.empty": "No comments yet.",
  "issue.comments.placeholder": "Write a comment…",
  "issue.comments.send": "Send",
  "issue.composer.title": "New branch & go",
  "issue.composer.type": "Type",
  "issue.composer.desc": "Short description",
  "issue.composer.preview": "Branch name",
  "issue.composer.confirm": "Create & checkout",
  "issue.composer.invalid": "Enter a description to build a valid branch name.",
  "issue.reject.title": "Reject issue",
  "issue.reject.prompt":
    "Give a reason for rejecting this issue. It is stored on the issue.",
  "issue.reject.placeholder": "Reason…",
  "issue.reject.confirm": "Reject",
  "issue.reject.required": "A reason is required.",
  "issue.new.title": "New issue",
  "issue.new.titleField": "Title",
  "issue.new.project": "Project",
  "issue.new.labels": "Labels (comma-separated)",
  "issue.new.confirm": "Create",
  // create MR / issue from a commit
  "integration.createMr": "Create Merge Request",
  "integration.createIssue": "Create Issue",
  "integration.noToken":
    "Add a GitHub or GitLab token in Webhooks settings to open merge requests or issues.",
  "integration.composeMr": "New merge request",
  "integration.composeIssue": "New issue",
  "integration.titleField": "Title",
  "integration.target": "Provider",
  "integration.targetBranch": "Target branch",
  "integration.creating": "Creating…",
  "integration.created": "Created:",
  "integration.authError":
    "Authentication failed — check the token in Webhooks settings.",
  "integration.failed": "Could not complete the request. Please try again.",
  // --- i18n audit: previously-hardcoded UI strings ---
  "common.browse": "Browse…",
  "branchEdit.title": "Edit branch",
  "search.scopeLabel": "Search scope",
  "graph.commitLabel": "Select or drag commit {sha}",
  "graph.commitHint":
    "Click to select · drag onto a branch/commit to cherry-pick or reorder",
  "graph.mergeHint": "Drag onto another branch head to merge",
  "graph.crownHint":
    "Click to select HEAD · drag onto a commit to reset (Shift = hard reset, Cmd/Ctrl = soft reset)",
  "graph.crownLabel": "Select or move HEAD",
  "graph.newCommit": "New commit",
  "menu.dismiss": "Dismiss menu",
  "openCreate.title": "Open or create",
  "openCreate.pathPlaceholder": "/path/to/project",
  "colorPicker.sv": "Saturation and value",
  "colorPicker.hue": "Hue",
  "colorPicker.hex": "Hex",
  "clone.title": "Clone repository",
  "clone.projectPlaceholder": "my-project",
  "clone.locationPlaceholder": "/path/to/clone/into",
  "diff.close": "Close diff",
  "diff.title": "File diff",
  "branchesPanel.filter": "filter",
  "branchesPanel.localHint": "Click to select, double-click to checkout {name}",
  "branchesPanel.cannotDeleteCurrent": "Cannot delete the current branch",
  "branchesPanel.delete": "Delete",
  "branchesPanel.remoteHint": "Double-click or right-click to checkout {name}",
  "branchesPanel.remoteTag": "remote",
  "branchesPanel.deleteTag": "Delete tag",
  "branchesPanel.newTagPlaceholder": "New Tag (at HEAD)",
  "branchesPanel.branchesHeading": "Branches",
  "branchesPanel.tagsHeading": "Tags",
  "themeStore.previewSubject": "commit subject",
  // guided tutorial — step copy
  "tutorial.hint.info": "Press Next to continue.",
  "tutorial.hint.busy": "Hang on, ADGitter is setting things up…",
  "tutorial.welcome.title": "Welcome to ADGitter",
  "tutorial.welcome.body":
    "ADGitter turns Git into something you can see and touch: a live commit graph where you merge, rebase, cherry-pick and reset by dragging. This short tour uses a throwaway practice repository, so your real projects stay untouched.",
  "tutorial.choose.title": "Take the tour?",
  "tutorial.choose.body":
    "The guided tutorial teaches each gesture on a practice repository and takes about ten minutes. You can also skip it and use ADGitter directly. Replay it any time from the account menu.",
  "tutorial.createDemo.title": "Create a practice repository",
  "tutorial.createDemo.body":
    "ADGitter will create a small demo repository, with its own local remote, inside the app's data folder. It never touches your repositories, your network or your account. Press Create demo to begin.",
  "tutorial.createDemo.hint": "Press Create demo to continue.",
  "tutorial.createDemo.primary": "Create demo",
  "tutorial.tourGraph.title": "Reading the graph",
  "tutorial.tourGraph.body":
    "Every row is a commit, newest at the top. Coloured lanes show how branches split and join, so history reads like a metro map. This practice repository already has a little history: a side branch that was merged back into main, and a tagged release.",
  "tutorial.tourCommit.title": "A commit",
  "tutorial.tourCommit.body":
    'Each circle is one commit; this one is "Write getting-started guide". Where two lanes join into a single commit, that commit is a merge: look just above it for "Merge branch \'docs/intro\'". Click a commit to select it and open its details; later you will drag from it to merge, rebase or cherry-pick.',
  "tutorial.tourBranch.title": "Branch chips",
  "tutorial.tourBranch.body":
    "The coloured chip next to a commit is a branch that points at it. Click a chip to select the branch, double-click it to check it out, or drag it onto the branch you are on to merge it. Here main and docs/intro are two branches; the small tag v0.0.1 marks a release on the merge commit.",
  "tutorial.tourHead.title": "The HEAD crown",
  "tutorial.tourHead.body":
    "The crown marks HEAD, the commit you are working on. Dragging it onto an older commit resets your branch to that commit — you will try it soon.",
  "tutorial.tourHandle.title": "The merge handle",
  "tutorial.tourHandle.body":
    "Hover the tip of a branch and a small round handle appears above it. Drag that handle onto another branch's tip to merge the two.",
  "tutorial.firstCommit.title": "Make your first commit",
  "tutorial.firstCommit.body":
    "ADGitter just created a few new files in the demo. Open the Files panel, stage them, type a commit message and commit. Your commit appears in the graph right away.",
  "tutorial.firstCommit.hint":
    "Open the Files panel, stage the files, then commit.",
  "tutorial.seedHistory.title": "A busier history",
  "tutorial.seedHistory.body":
    "To practise on something realistic, ADGitter has added more commits, three branches (feature/login, feature/theme and experiment) and two tags. Look around the graph, then press Next.",
  "tutorial.selectCommit.title": "Select a commit",
  "tutorial.selectCommit.body":
    "Click any commit to select it. Selecting a commit also opens its details, and it is how most gestures begin.",
  "tutorial.selectCommit.hint": "Click one commit in the graph.",
  "tutorial.selectMany.title": "Select several commits",
  "tutorial.selectMany.body":
    "Drag a box around two or more commits in an empty part of the graph, or hold Ctrl (⌘ on Mac) and click more commits. A multi-selection can be moved or copied as a group.",
  "tutorial.selectMany.hint": "Box-select at least two commits.",
  "tutorial.mergeDrag.title": "Merge by dragging",
  "tutorial.mergeDrag.body":
    "Hover the tip of feature/login until its round handle appears, then drag that handle onto main. Confirm the prompt and ADGitter merges the branch into main.",
  "tutorial.mergeDrag.hint":
    "Drag the round handle on feature/login onto main.",
  "tutorial.branchSelect.title": "Select a branch",
  "tutorial.branchSelect.body":
    "Click the feature/theme chip to select the whole branch. A selected branch moves as one unit, which is what you need to rebase it next.",
  "tutorial.branchSelect.hint": "Click the feature/theme chip.",
  "tutorial.rebase.title": "Rebase a branch",
  "tutorial.rebase.body":
    "Drag the selected feature/theme branch onto main to replay its commits on top of main's latest work. History is rewritten, so ADGitter asks you to confirm first.",
  "tutorial.rebase.hint": "Drag feature/theme onto the main chip.",
  "tutorial.cherryPick.title": "Cherry-pick a commit",
  "tutorial.cherryPick.body":
    "Click the “Try faster render” commit on the experiment branch, then hold Alt (⌥ on Mac) and drag it onto the main chip. A copy of just that commit lands on main.",
  "tutorial.cherryPick.hint":
    "Alt-drag “Try faster render” onto the main chip.",
  "tutorial.undo.title": "Undo the last operation",
  "tutorial.undo.body":
    "Changed your mind? Press Undo in the toolbar to roll back the last operation, here the cherry-pick. There is no redo, so undo with care.",
  "tutorial.undo.hint": "Press the Undo button in the toolbar.",
  "tutorial.reset.title": "Reset with the HEAD crown",
  "tutorial.reset.body":
    "Drag the HEAD crown onto an older commit on main to move main back to it. A plain drag is a mixed reset; hold Shift for a hard reset (discards changes) or Ctrl/⌘ for a soft one. Confirm to go ahead.",
  "tutorial.reset.hint": "Drag the crown onto an older commit on main.",
  "tutorial.undoReset.title": "Undo the reset",
  "tutorial.undoReset.body":
    "Resets are easy to take back. Press Undo to put main exactly where it was.",
  "tutorial.undoReset.hint": "Press the Undo button in the toolbar.",
  "tutorial.checkout.title": "Check out a branch",
  "tutorial.checkout.body":
    "Double-click the feature/theme chip to switch to it. The crown moves to show the branch you are on now.",
  "tutorial.checkout.hint": "Double-click the feature/theme chip.",
  "tutorial.openDetail.title": "Open commit details",
  "tutorial.openDetail.body":
    "Click the “Add config” commit. Its details panel lists every file that commit changed — including a secrets file that should never have been committed.",
  "tutorial.openDetail.hint": "Click the “Add config” commit.",
  "tutorial.purge.title": "Purge a file from history",
  "tutorial.purge.body":
    "secrets.env must not stay in history. In the details panel, use “Remove file from history” on secrets.env. ADGitter rewrites this commit and every later one, and asks you to confirm.",
  "tutorial.purge.hint": "Remove secrets.env from history.",
  "tutorial.addFile.title": "Add a file to a past commit",
  "tutorial.addFile.body":
    "We saved a safe template, secrets.example.env, in your working folder. In the details panel choose “Add file” and add it to the “Add config” commit, so history keeps a harmless example.",
  "tutorial.addFile.hint":
    "Add secrets.example.env to the “Add config” commit.",
  "tutorial.reword.title": "Fix a commit message",
  "tutorial.reword.body":
    "The commit “Add drak theme” has a typo. Select it, choose “Edit commit message” in its details panel and change it to “Add dark theme”.",
  "tutorial.reword.hint": "Edit the message of “Add drak theme”.",
  "tutorial.pushRejected.title": "Push your work",
  "tutorial.pushRejected.body":
    "Press Push. Git will refuse: you rewrote history that already exists on the remote, so your branch no longer builds on it and a normal push is rejected as non-fast-forward.",
  "tutorial.pushRejected.hint": "Press Push in the toolbar.",
  "tutorial.forcePush.title": "Force push",
  "tutorial.forcePush.body":
    "When rewriting history is intentional, a force push replaces the remote branch with yours. Open the push options menu, choose Force push and confirm. Use it with care on shared branches.",
  "tutorial.forcePush.hint": "Open the push options and choose Force push.",
  "tutorial.logIntro.title": "Log Anytime",
  "tutorial.logIntro.body":
    "Log Anytime quietly snapshots your working folder onto a dedicated branch while ADGitter is open — a safety net for work you never got to commit. Next you will switch it on.",
  "tutorial.logOn.title": "Turn Log Anytime on",
  "tutorial.logOn.body":
    "Press the Log Anytime button in the toolbar. A blinking red dot shows that it is recording.",
  "tutorial.logOn.hint": "Press the Log Anytime button.",
  "tutorial.logSim.title": "Snapshots appear",
  "tutorial.logSim.body":
    "To save you the wait, ADGitter simulated a few snapshots. Find them on the adgitter-log branch in the graph; real snapshots land there at the interval you choose.",
  "tutorial.logOff.title": "Turn it off again",
  "tutorial.logOff.body":
    "Press the Log Anytime button once more to stop recording. The red dot disappears.",
  "tutorial.logOff.hint": "Press the Log Anytime button again.",
  "tutorial.theme.title": "Pick a theme",
  "tutorial.theme.body":
    "Open Settings (the gear), go to Personalize, apply a graph theme you like and press OK. Free themes work offline.",
  "tutorial.theme.hint":
    "Open Settings, apply a different theme, then press OK.",
  "tutorial.issueBranch.title": "Branch from an issue",
  "tutorial.issueBranch.body":
    "Open the Issues panel and create a branch for an issue; ADGitter names the branch for you and links the two. In this tutorial the issues are samples — nothing is sent anywhere.",
  "tutorial.issueBranch.hint": "Open Issues and create a branch for an issue.",
  "tutorial.issueStatus.title": "Keep the issue up to date",
  "tutorial.issueStatus.body":
    "While you work, change the issue's status, for example to In Progress, without leaving ADGitter.",
  "tutorial.issueStatus.hint": "Change the issue's status in the panel.",
  "tutorial.finish.title": "You're all set",
  "tutorial.finish.body":
    "That's the tour. The demo repository will now be removed. Next, a short guide covers opening your own repository, setting up a remote and creating access tokens. You can replay this tutorial any time from the account menu.",
  "tutorial.finish.primary": "Start using ADGitter",
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Partial<Record<MessageKey, string>>;

const zhHant: Catalog = {
  "common.cancel": "取消",
  "common.confirm": "確認",
  "common.ok": "確定",
  "common.create": "建立",
  "common.open": "開啟",
  "common.reset": "重設",
  "common.dismiss": "關閉",
  "topbar.repoFallback": "儲存庫名稱",
  "topbar.searchScope": "此專案",
  "topbar.settings": "設定",
  "topbar.account": "帳號",
  "topbar.back": "返回選擇儲存庫",
  "search.placeholder": "搜尋提交、分支、標籤…",
  "search.noResults": "沒有符合項目",
  "search.scope.commits": "提交",
  "search.scope.message": "訊息",
  "search.scope.author": "作者",
  "search.scope.hash": "Hash",
  "search.scope.time": "時間",
  "search.scope.branch": "分支",
  "search.scope.tag": "標籤",
  "search.placeholder.commits": "搜尋提交…",
  "search.placeholder.message": "搜尋提交訊息…",
  "search.placeholder.author": "搜尋作者姓名或電子郵件…",
  "search.placeholder.hash": "搜尋提交 hash…",
  "search.placeholder.time": "搜尋日期，例如 2026-08 或 2026-08-19…",
  "search.placeholder.branch": "搜尋分支…",
  "search.placeholder.tag": "搜尋標籤…",
  "logAnytime.enable": "啟用 Log Anytime",
  "logAnytime.desc":
    "App 開啟期間，定時將工作目錄快照到專用分支 — 可隨時回溯的安全網。",
  "logAnytime.branch": "記錄分支",
  "logAnytime.interval": "每隔",
  "logAnytime.minutes": "分鐘",
  "logAnytime.paidSection": "背景執行與壓縮（Advance+）",
  "logAnytime.background": "在背景執行",
  "logAnytime.periodicSquash": "定期壓縮",
  "logAnytime.autoPush": "自動推送",
  "logAnytime.locked": "需要 Advance 方案",
  "logAnytime.compactNow": "立即壓縮",
  "logAnytime.compacting": "壓縮中…",
  "logAnytime.compactDone": "已壓縮記錄歷史。",
  "logAnytime.compactNoop": "已是壓縮狀態。",
  "logAnytime.compactFailed": "無法壓縮。",
  "logAnytime.noRepo": "開啟儲存庫後才能設定 Log Anytime。",
  "crash.title": "發生錯誤",
  "crash.body": "ADGitter 遇到非預期的錯誤。你的儲存庫在磁碟上是安全的。",
  "crash.reported": "已送出診斷報告。",
  "crash.reload": "重新載入",
  "crash.dismiss": "關閉",
  "user.language": "語言",
  "user.upgrade": "升級",
  "user.logout": "登出",
  "user.replayTutorial": "再次觀看教學導覽",
  "user.signIn": "登入",
  "user.signingIn": "請於瀏覽器中繼續…",
  "user.signedOut": "尚未登入",
  "user.signInUnavailable": "尚未設定登入",
  "user.planCurrent": "目前方案：{plan}",
  "user.manageSubscription": "管理訂閱",
  "user.manageSubscriptionTitle":
    "最高方案 — 可取消訂閱、更換付款方式或查看帳單",
  "portal.noSubscription": "找不到此帳號的訂閱。",
  "welcome.greeting": "歡迎",
  "welcome.greetingName": "歡迎 {name}",
  "welcome.newOpen": "新增 / 開啟",
  "welcome.removeRecent": "從最近項目移除",
  // 導覽教學 — 覆蓋層與提示卡
  "tutorialUi.dialogLabel": "互動式教學",
  "tutorialUi.progressLabel": "第 {index} 步，共 {total} 步",
  "tutorialUi.back": "上一步",
  "tutorialUi.next": "下一步",
  "tutorialUi.continue": "繼續",
  "tutorialUi.retry": "重試",
  "tutorialUi.working": "處理中…",
  "tutorialUi.blockedHint":
    "目前只有醒目標示的區域可以操作，請依照這張卡片的說明進行。",
  "tutorialUi.exit": "結束教學",
  "tutorialUi.exitConfirmTitle": "要結束教學嗎？",
  "tutorialUi.exitConfirmBody":
    "示範儲存庫會被移除。之後隨時可以從帳號選單重新播放教學。",
  "tutorialUi.exitKeep": "繼續教學",
  "tutorialUi.exitConfirm": "結束",
  // 導覽教學 — 歡迎導覽
  "welcomeTour.title": "歡迎使用 ADGitter",
  "welcomeTour.intro": "用手勢操作的 Git 用戶端。你可以這樣使用：",
  "welcomeTour.graph.title": "可以直接操作的圖形",
  "welcomeTour.graph.body":
    "整段歷史以清楚的分線地圖呈現，直接在上面點選、框選與拖曳。",
  "welcomeTour.drag.title":
    "拖曳即可合併(Merge)、變基(Rebase)、揀選(Cherry-pick)提交(Commit)",
  "welcomeTour.drag.body":
    "把分支(Branch)或提交(Commit)拖放到另一個上面，ADGitter 只會問你最關鍵的那一個問題。",
  "welcomeTour.undo.title": "一鍵復原(Undo)",
  "welcomeTour.undo.body":
    "合併(Merge)、變基(Rebase)或重設(Reset)後後悔了？復原(Undo)即可繼續工作。",
  "welcomeTour.surgery.title": "歷史修整",
  "welcomeTour.surgery.body":
    "清除不該提交(Commit)的檔案、補上漏掉的檔案，或修正舊提交的訊息。",
  "welcomeTour.logAnytime.title": "「隨時記錄」時光機",
  "welcomeTour.logAnytime.body":
    "在背景為你的工作建立快照，隨時可以回到任一時刻。",
  "welcomeTour.themes.title": "主題",
  "welcomeTour.themes.body": "從主題商店挑選配色與樣式，打造專屬的圖形外觀。",
  "welcomeTour.issues.title": "內建議題追蹤",
  "welcomeTour.issues.body":
    "連接 Jira、Asana、GitLab 或 GitHub，從議題建立分支(Branch)，並在工作時同步更新議題。",
  "welcomeTour.next": "下一步",
  "welcomeTour.back": "上一步",
  "welcomeTour.pageLabel": "第 {page} 頁，共 {total} 頁",
  "welcomeTour.choiceTitle": "你想怎麼開始？",
  "welcomeTour.startTitle": "開始互動式教學",
  "welcomeTour.startBody":
    "在一個用完即棄的示範儲存庫上練習每一種手勢，完全不會動到你自己的專案。",
  "welcomeTour.directTitle": "直接使用 ADGitter",
  "welcomeTour.directBody": "略過教學。之後隨時可以從帳號選單重新播放。",
  // 首次使用指南
  "firstUse.title": "開始使用",
  "firstUse.pageLabel": "第 {page} 頁，共 {total} 頁",
  "firstUse.next": "下一步",
  "firstUse.back": "上一步",
  "firstUse.close": "關閉",
  "firstUse.repo.title": "從一個儲存庫開始",
  "firstUse.repo.intro":
    "ADGitter 操作的是你電腦資料夾中的 Git 儲存庫。兩種方式都從歡迎畫面開始。",
  "firstUse.repo.createTitle": "建立空的儲存庫",
  "firstUse.repo.createBody":
    "按「新增 / 開啟」，選擇一個尚未成為 Git 專案的資料夾並確認建立，ADGitter 會替你執行 git init。",
  "firstUse.repo.openTitle": "開啟現有的儲存庫",
  "firstUse.repo.openBody":
    "按「新增 / 開啟」並選擇已有 Git 專案的資料夾，或點選最近專案的頭像直接回到該專案。",
  "firstUse.remote.title": "連接遠端(Remote)",
  "firstUse.remote.intro":
    "GitHub、GitLab、Bitbucket 或 Azure DevOps 上的遠端(Remote)儲存庫，是你備份與分享提交(Commit)的地方。",
  "firstUse.remote.cloneTitle": "從遠端(Remote)開始",
  "firstUse.remote.cloneBody":
    "在「新增 / 開啟」中選擇「複製遠端(Remote)儲存庫」，貼上 Git 網址、選擇位置；若是私人儲存庫，再加上存取權杖。",
  "firstUse.remote.settingsTitle": "為本機儲存庫加上遠端(Remote)",
  "firstUse.remote.settingsBody":
    "先在你的服務商建立一個空的儲存庫，再開啟「設定 → 一般 → 遠端(Remote)與驗證」，輸入它的 HTTPS 網址與存取權杖。",
  "firstUse.remote.sshHint":
    "想用 SSH？把遠端(Remote)網址留空，ADGitter 就會以你的 SSH 金鑰連線。",
  "firstUse.tokens.title": "個人存取權杖",
  "firstUse.tokens.intro":
    "個人存取權杖（PAT）是類似密碼的金鑰，讓 ADGitter 可以代你推送(Push)、拉取或讀取議題，而不需要你的真正密碼。請在服務商的網站建立，立刻複製，再貼到 ADGitter。",
  "firstUse.tokens.where":
    "Git 權杖請填在「設定 → 一般 → 存取權杖」；議題追蹤的權杖請填在「設定 → 議題面板」。",
  "firstUse.tokens.safety":
    "請把權杖當成密碼：只給必要的權限、設定到期日，且絕不分享或提交(Commit)到儲存庫。",
  "firstUse.tokens.tabGit": "Git 服務商",
  "firstUse.tokens.tabIssues": "議題追蹤",
  "firstUse.tokens.openPage": "開啟權杖頁面",
  "firstUse.tokens.scopes": "所需權限",
  "firstUse.tokens.steps": "建立方式",
  "firstUse.git.github.scopes":
    "經典權杖：repo 範圍。細粒度權杖：Repository permissions → Contents：Read and write。",
  "firstUse.git.github.steps":
    "開啟 Settings → Developer settings → Personal access tokens。\n選擇 Generate new token。\n設定上述權限後產生並複製權杖。GitHub 只會顯示一次。",
  "firstUse.git.gitlab.scopes":
    "read_repository 與 write_repository 範圍（或 api）。",
  "firstUse.git.gitlab.steps":
    "開啟 User settings → Access tokens，選擇 Add new token。\n命名、設定到期日，並勾選上述範圍。\n建立後複製權杖。",
  "firstUse.git.bitbucket.scopes":
    "具備 Repositories：Write（已包含 Read）權限的 Repository Access Token。應用程式密碼已不再有效。",
  "firstUse.git.bitbucket.steps":
    "開啟你的儲存庫，前往 Repository settings → Security → Access tokens。\n選擇 Create Repository Access Token 並命名。\n勾選 Repositories：Write（已包含 Read），建立後複製權杖，並在 ADGitter 中作為存取權杖使用。",
  "firstUse.git.azure.scopes": "Code：Read & write。",
  "firstUse.git.azure.steps":
    "開啟 User settings → Personal access tokens，選擇 New Token。\n選擇你的組織與到期日，再選 Custom defined 範圍。\n勾選 Code：Read & write，建立後複製權杖。",
  "firstUse.issue.jira.scopes":
    "Atlassian API 權杖（不需勾選範圍）。你的帳號需要有該專案編輯議題的權限，並搭配你的 Atlassian 電子郵件使用。",
  "firstUse.issue.jira.steps":
    "開啟 Atlassian API tokens 頁面，選擇 Create API token。\n輸入標籤並設定到期日。\n建立後複製權杖。",
  "firstUse.issue.asana.scopes":
    "個人存取權杖，權限與你的 Asana 帳號相同（不需勾選範圍）。",
  "firstUse.issue.asana.steps":
    "在 Asana 開發者主控台開啟 My apps。\n選擇 Create new token 並命名。\n複製權杖。",
  "firstUse.issue.gitlab.scopes": "api 範圍。",
  "firstUse.issue.gitlab.steps":
    "開啟 User settings → Access tokens，選擇 Add new token。\n命名、設定到期日並勾選 api。\n建立後複製權杖。",
  "firstUse.issue.github.scopes":
    "細粒度權杖：Repository permissions → Issues：Read and write。經典權杖則需要 repo 範圍。",
  "firstUse.issue.github.steps":
    "開啟 Settings → Developer settings → Fine-grained tokens，選擇 Generate new token。\n選擇儲存庫並設定 Issues：Read and write。\n產生後複製權杖。",
  "firstUse.done.title": "一切就緒",
  "firstUse.done.body":
    "開啟或建立一個儲存庫即可開始。之後隨時可以從帳號選單重新播放教學。",
  "window.lockedUpsell": "多視窗為付費功能。",
  "toolbar.branches": "分支與標籤",
  "toolbar.files": "變更的檔案",
  "toolbar.push": "推送",
  "toolbar.pushOptions": "更多推送選項",
  "toolbar.forcePush": "強制推送",
  "toolbar.pull": "拉取",
  "toolbar.undo": "復原",
  "toolbar.undoBlockedExternal":
    "無法復原：這個儲存庫已被 ADGitter 以外的工具變更。在這裡做出變更後，就能再次復原。",
  "toolbar.logAnytime": "隨時記錄",
  "status.ahead": "領先",
  "status.behind": "落後",
  "status.signedOut": "未登入",
  "status.configUnreadable": "無法讀取專案設定",
  "status.configUnreadableHint":
    "無法讀取 adgitter.config.json，此儲存庫暫時使用預設設定。原始檔案已複製到 {file}，內容未被覆寫。",
  "status.configUnsavableHint":
    "無法讀取 adgitter.config.json，也無法複製備份。在你修正或移走該檔案之前，此儲存庫的設定變更不會被儲存，原始內容也不會被覆寫。",
  "time.today": "今天",
  "time.yesterday": "昨天",
  "empty.openRepo": "開啟儲存庫",
  "empty.openHint": "選擇一個本機 Git 專案來檢視。",
  "empty.firstBranch": "建立你的第一個分支",
  "openCreate.prompt": "請選擇位置以開啟現有的 git 專案，或建立一個新的",
  "openCreate.targetLocation": "目標位置",
  "openCreate.cloneLink": "改為複製遠端儲存庫 →",
  "clone.projectLabel": "專案標籤",
  "clone.gitUrl": "Git 網址",
  "clone.location": "位置",
  "clone.pat": "個人存取權杖（PAT）",
  "clone.patHint":
    "選填：私有 https 儲存庫需要權杖（GitHub PAT / GitLab 存取權杖 / Bitbucket 存取權杖）。公開儲存庫或 ssh:// 網址可留空（會使用系統 SSH 金鑰）。",
  "clone.cloning": "複製中…",
  "confirm.openRepo": "你選擇的目錄包含現有的儲存庫，要開啟它嗎？",
  "confirm.createRepo": "你選擇的目錄沒有 git 專案，要在此建立一個嗎？",
  "common.close": "關閉",
  "files.title": "變更",
  "files.conflicted": "衝突",
  "files.staged": "已暫存",
  "files.changed": "已變更",
  "files.untracked": "未追蹤",
  "files.ignored": "已忽略",
  "files.loading": "載入中…",
  "files.clean": "工作目錄乾淨。",
  "files.stage": "暫存",
  "files.unstage": "取消暫存",
  "files.discard": "捨棄變更",
  "files.openFile": "以預設編輯器開啟",
  "commit.message": "提交訊息",
  "commit.usingAccountEmail":
    "此處未設定 git user.email，這次提交將以 {email} 作為作者。",
  "commit.usingAccountEmailHow":
    "設定 git config user.email 可改用其他地址提交。",
  "commit.title": "新增提交",
  "commit.create": "提交 {n}",
  "commit.creating": "提交中…",
  "commit.commitStaged": "提交 {count} 個暫存變更",
  "commit.nothingStaged": "沒有暫存的變更",
  "commitDetails.filter": "篩選",
  "commitDetails.loading": "載入變更中…",
  "commitDetails.noChanges": "沒有檔案變更。",
  "commitDetails.history": "檔案歷史",
  "commitDetails.historyEmpty": "此檔案沒有歷史紀錄。",
  "commitDetails.editMessage": "編輯提交訊息",
  "commitDetails.save": "儲存",
  "commitDetails.copyBranch": "複製分支名稱（{branch}）",
  "commitDetails.copyHash": "複製完整提交雜湊（{sha}）",
  "commitDetails.copied": "已複製",
  "commitDetails.viewDiff": "查看差異",
  "commitDetails.purgeFile": "從歷史紀錄移除此檔案",
  "commitDetails.linkedIssue": "開啟連結的議題",
  "commitDetails.addFile": "新增檔案",
  "commitDetails.addFilePickerTitle": "新增工作目錄中的檔案",
  "commitDetails.addFileEmpty": "工作目錄中沒有變更的檔案。",
  "diff.loading": "載入差異中…",
  "diff.none": "沒有差異。",
  "diff.noChanges": "沒有變更。",
  "diff.binary": "二進位檔案 — 無文字差異。",
  "branchEdit.name": "分支名稱",
  "branchEdit.color": "顏色",
  "branchEdit.upstream": "上游",
  "branchEdit.upstreamNone": "（無）",
  "branchesPanel.addTag": "在此新增標籤",
  "branchesPanel.addTagPlaceholder": "標籤名稱",
  "branchesPanel.edit": "編輯",
  "branchesPanel.fork": "從此分叉",
  "branchesPanel.forkPlaceholder": "新分支名稱",
  "branchesPanel.goToIssue": "前往關聯的議題",
  "branchesPanel.noUpstream": "尚未設定上游",
  "confirmRewrite.note": "之後可以復原。",
  "confirmRewrite.messagePlaceholder": "新的提交訊息",
  "confirmRewrite.chooseBranch": "目標是哪一條分支？",
  "confirmRewrite.chooseSourceBranch": "來源是哪一條分支？",
  "confirmRewrite.chooseResetTarget": "要重設到哪一條分支或提交？",
  "general.autoPull": "自動拉取",
  "general.off": "關閉",
  "general.warning": "警告",
  "general.beforeCreateBranch": "建立分支前",
  "general.beforePush": "推送前",
  "general.beforeCommit": "提交前",
  "general.notify": "通知",
  "general.always": "總是",
  "general.autoPullSeconds": "等待時間",
  "general.seconds": "秒",
  "autoPull.title": "{before}：要從遠端拉取嗎？",
  "autoPull.body":
    "拉取會先讓這個分支更新到最新，然後才執行操作。「暫時不要」會不拉取就執行；「取消」會捨棄這個操作。",
  "autoPull.skipped": "使用者按下略過拉取，將繼續執行。",
  "autoPull.cancelled": "使用者按下取消，已經中斷執行。",
  "autoPull.failed": "{before}：拉取失敗——沒有執行任何操作。{reason}",
  "autoPull.conflicted":
    "{before}：拉取遇到衝突——請先解決衝突；沒有執行任何操作。",
  "autoPull.pending": "已有一個自動拉取提示正在等待。",
  "general.unstaged": "未暫存的檔案",
  "general.undoRedo": "復原 / 重做",
  "general.times": "次",
  "general.git": "Git",
  "general.dryRun": "試跑",
  "general.gitIdentity": "Git 身分",
  "general.gitName": "Git 名稱",
  "general.gitEmail": "Git 電子郵件",
  "general.useProjectEmail": "使用專案 Git 身分",
  "general.gitEmailHintGlobal": "Git 身分套用於所有儲存庫 (~/.gitconfig)",
  "general.gitEmailHintProject":
    "僅此儲存庫 (.git/config)；會覆寫全域 Git 身分",
  "general.useAccountIdentity": "使用已登入帳號身分",
  "general.accountIdentityHint": "僅此儲存庫 (.git/config)；會覆寫為帳號身分",
  "general.accountIdentityNoAccount": "請先登入才能使用帳號身分",
  "general.identityFallbackHint": "由於未指定名稱／電子郵件，將使用預設值",
  "general.hideGhosts": "隱藏未被指向的 commit",
  "general.hideGhostsHint": "僅由復原備份保留、未被任何分支或標籤指向的 commit",
  "general.remoteHeading": "遠端與認證",
  "general.remoteUrl": "遠端 URL",
  "general.accessToken": "存取權杖",
  "general.authHint":
    "fetch / pull / push 使用 HTTPS 存取權杖 (PAT)。不支援密碼登入。",
  "general.openTokenPage": "如何取得權杖？",
  "general.remoteNoRepo": "開啟儲存庫後才能設定其遠端 URL 與存取權杖。",
  "general.remoteOverrideHint":
    "此儲存庫的 .git 遠端為 {url}。在此輸入 URL 會改用該 URL（搭配你的權杖）；留空則沿用 .git 遠端，並以 SSH 金鑰連線。",
  "panel.resize": "拖曳以調整面板寬度",
  "remote.notHttps":
    "已設定存取權杖，但此遠端不是 HTTPS URL —— 權杖僅能透過 HTTPS 使用（在純 http 下會外洩）。推送、拉取以及建立合併請求或議題已停用。清除權杖以改用 SSH 連線，或將遠端改為 HTTPS URL。",
  "personalize.graphTheme": "圖表主題",
  "personalize.textSize": "文字大小",
  "personalize.small": "小",
  "personalize.medium": "中",
  "personalize.large": "大",
  "personalize.preview": "預覽",
  "personalize.apply": "套用",
  "personalize.inUse": "使用中",
  "personalize.font": "字型",
  "personalize.fontSystem": "系統預設",
  "personalize.fontSans": "無襯線",
  "personalize.fontMono": "等寬",
  "personalize.buy": "購買",
  "personalize.owned": "已擁有",
  "personalize.author": "作者",
  "personalize.refreshPurchase": "重新整理購買",
  "graphTheme.default.description": "內建的地鐵圖樣式——俐落的軌道與實心節點。",
  "graphTheme.midnight.description":
    "深藍色的夜間畫布，搭配柔和明亮的軌道，夜裡看也不刺眼。",
  "graphTheme.synthwave.description":
    "復古未來的霓虹夕陽風格：發光的分支色節點、依軌道著色的光暈線條、條紋太陽與 CRT 掃描線。",
  "graphTheme.blueprint.description":
    "工程製圖風格：藍圖底色、交叉影線軌道與製圖圓規節點。",
  "graphTheme.hero.description":
    "像素風 RPG 世界：持劍配盾的英雄、村莊，以及蜿蜒於地圖上的石板道路軌道。",
  "shortcut.pressKeys": "請按下按鍵…",
  "shortcut.conflict": "部分快捷鍵衝突 — 請先解決再儲存。",
  "shortcut.restoreDefaults": "還原預設",
  "shortcut.action.switchHandTool": "切換手形工具",
  "shortcut.action.pull": "拉取",
  "shortcut.action.push": "推送",
  "shortcut.action.newBranch": "新增分支",
  "shortcut.action.newTag": "新增標籤",
  "shortcut.action.showBranchPanel": "顯示分支面板",
  "shortcut.action.showTagPanel": "顯示標籤面板",
  "shortcut.action.showSettingPanel": "顯示設定面板",
  "menu.cherryPickOnto": "揀選到 {branch}",
  "menu.revert": "還原此提交",
  "menu.reword": "修改訊息…",
  "menu.squash": "壓縮為一個提交…",
  "menu.resetMixed": "重設分支到此（mixed）",
  "menu.resetHard": "重設分支到此（hard）",
  "menu.drop": "捨棄此提交",
  "menu.checkout": "簽出",
  "menu.mergeIntoParent": "將 {branch} 合併進…",
  "menu.rebaseOntoParent": "變基到 {branch}…",
  "menu.branchCurrent": "{branch}（目前）",
  "menu.checkoutTag": "標籤 {tag}",
  "menu.checkoutDetached": "此提交（{short}，分離 HEAD）",
  "menu.createBranchHere": "在此建立分支…",
  "menu.createBranchFrom": "從 {branch} 建立分支…",
  "menu.branchProps": "屬性…",
  "menu.checkoutRemote": "簽出…",
  "createBranch.title": "建立分支",
  "createBranch.from": "起點",
  "createBranch.name": "分支名稱",
  "createBranch.placeholder": "feature/my-branch",
  "remoteAdopt.title": "要追蹤這個遠端分支嗎？",
  "remoteAdopt.body":
    "{branch} 已經存在，但沒有追蹤任何分支。要將其上游設為 {remote} 並簽出嗎？",
  "remoteAdopt.confirm": "設定上游並簽出",
  "remotePull.title": "要拉取以同步嗎？",
  "remotePull.body":
    "{branch} 落後 {remote} {behind} 個提交。要現在拉取以快進嗎？",
  "remotePull.confirm": "拉取",
  "remotePull.skip": "暫時不要",
  "notice.remoteInSync": "已簽出 {branch}——與 {remote} 已經同步。",
  "notice.remoteLocalAhead":
    "已簽出 {branch}——領先 {remote} {ahead} 個提交，沒有東西可拉取。",
  "notice.remoteDiverged":
    "已簽出 {branch}——與 {remote} 已分歧（領先 {ahead}、落後 {behind}）；拉取會產生合併，因此交由你決定。",
  "notice.remoteUpstreamSet": "{branch} 現已追蹤 {remote}，並已簽出。",
  "notice.remotePullSkipped":
    "未拉取——{branch} 仍落後 {remote} {behind} 個提交。",
  "remoteCheckout.title": "簽出遠端分支",
  "remoteCheckout.body": "{name} 是遠端分支。要建立本地分支來作業嗎？",
  "remoteCheckout.localName": "本地分支名稱",
  "remoteCheckout.create": "建立並簽出",
  "remoteCheckout.detached": "直接簽出（detached）",
  "checkoutChoice.title": "選擇要簽出的分支",
  "checkoutChoice.body": "這個提交有多個本地分支。你要簽出哪一個？",
  "op.revert.title": "還原提交",
  "op.revert.body": "建立一個新提交以還原「{subject}」。",
  "op.revert.confirm": "還原",
  "op.cherryPick.titleOne": "揀選提交",
  "op.cherryPick.titleMany": "揀選多個提交",
  "op.cherryPick.body": "將 {what} 套用到 {branch}。",
  "op.cherryPick.whatOne": "「{subject}」",
  "op.cherryPick.whatMany": "{n} 個提交",
  "op.cherryPick.confirm": "揀選",
  "op.reset.title": "重設（{mode}）",
  "op.reset.body": "將 {branch} 移到 {short}。{effect}",
  "op.reset.effectHard": "工作目錄的變更將被捨棄。",
  "op.reset.effectSoft": "變更會保留並維持已暫存狀態。",
  "op.reset.effectKeep": "變更會保留在工作目錄。",
  "op.reset.confirm": "重設",
  // graph drag tooltip (HEAD-crown reset gesture)
  "graph.resetTip.mixed": "reset --mixed · 保留變更（取消暫存）",
  "graph.resetTip.hard": "reset --hard · 捨棄所有變更",
  "graph.resetTip.soft": "reset --soft · 保留變更（維持暫存）",
  // graph drag tooltip (Shift-drag a commit selection onto a commit)
  "graph.rebaseTip": "將 {branch} 變基到 {short}",
  "graph.cherryPickTip": "將 {n} 個提交揀選到 {short} 的新分支",
  "graph.backToTop": "回到頂端",
  "op.drop.title": "捨棄提交",
  "op.drop.body": "移除「{subject}」並在不含它的情況下重放其後代。",
  "op.drop.confirm": "捨棄",
  "op.reword.title": "修改提交訊息",
  "op.reword.body": "編輯此提交的訊息。其後代提交會被重寫於其上。",
  "op.reword.confirm": "儲存訊息",
  "op.squash.title": "壓縮提交",
  "op.squash.body":
    "將這 {n} 個提交壓縮成一個，訊息如下方所示。其後代提交會被重寫於其上。",
  "op.squash.confirm": "壓縮",
  "op.purgeFile.title": "從歷史紀錄移除檔案",
  "op.purgeFile.body":
    "將「{path}」從「{subject}」以及其後直到分支頂端的每一個提交中移除。這是一個大範圍的變更：會重寫此提交與其所有後代提交。",
  "op.purgeFile.confirm": "移除檔案",
  "op.addFile.title": "將檔案新增到提交",
  "op.addFile.body":
    "將「{path}」寫入「{subject}」以及其後直到分支頂端的每一個提交。這是一個大範圍的變更：會重寫此提交與其所有後代提交。",
  "op.addFile.confirm": "新增檔案",
  "op.merge.title": "合併分支",
  "op.merge.body": "將 {source} 合併進 {branch}（可快轉時快轉）。",
  "op.merge.confirm": "合併",
  "op.mergeBranches.body": "將 {source} 合併進 {target}（可快轉時快轉）。",
  "op.mergeBranches.bodyCheckout":
    "先簽出 {target}，再將 {source} 合併進去（可快轉時快轉）。",
  "op.rebase.title": "變基分支",
  "op.rebase.body": "將 {branch} 的提交重放到 {onto}。這會重寫那些提交。",
  "op.rebase.confirm": "變基",
  "op.rebaseBranch.body": "將 {branch} 的提交重放到 {onto}。這會重寫那些提交。",
  "op.rebaseBranch.bodyCheckout":
    "將 {branch} 的提交重放到 {onto}，完成後會切回目前的分支，並還原你目前的工作目錄狀態。這會重寫那些提交。",
  "op.cherryPickNewBranch.title": "揀選到新分支",
  "op.cherryPickNewBranch.bodyOne":
    "在 {short} 建立新分支，並將 1 個提交揀選到其上。",
  "op.cherryPickNewBranch.bodyMany":
    "在 {short} 建立新分支，並將 {n} 個提交揀選到其上。",
  "op.cherryPickNewBranch.confirm": "揀選",
  "op.removeBranch.title": "移除分支",
  "op.removeBranch.body":
    "刪除分支標籤「{name}」。只能由它到達的提交將變得無法到達（在垃圾回收前仍保留）。",
  "op.removeBranch.confirm": "移除分支",
  "op.forcePush.title": "強制推送",
  "op.forcePush.body":
    "這會用你的本機歷史覆寫遠端分支。其他人推送過、但不在你本機歷史中的提交，可能會永久遺失。",
  "op.forcePush.confirm": "強制推送",
  "resolve.banner":
    "套用 {short} 時發生衝突（{branch} 上的 {op}）— 請解決並暫存每個衝突檔案後繼續。",
  "resolve.continue": "繼續",
  "resolve.abort": "中止",
  "resolve.stageAllFirst": "請先暫存所有衝突檔案，才能繼續。",
  "resolve.abortConfirm.title": "要中止這個暫停的操作嗎？",
  "resolve.abortConfirm.body":
    "所有內容將還原到操作開始前的狀態，你所做的衝突解決會被捨棄。",
  "resolve.abortConfirm.confirm": "中止",
  "branch.head": "HEAD",
  "notice.undid": "已復原 {op}",
  "notice.nothingToUndo": "沒有可復原的項目",
  "notice.pulled": "已從上游拉取",
  "notice.pushed": "已推送到上游",
  "notice.forcePushed": "已強制推送到上游",
  "notice.dryRunPush": "試跑 — 略過推送",
  "notice.dryRunPull": "試跑 — 略過拉取",
  "notice.commitInFiles": "請在「檔案」面板暫存並提交你的變更。",
  "notice.reset": "已重設（{mode}）至 {short}。",
  "notice.purged": "已從歷史紀錄移除 {path}。",
  "notice.addedFile": "已將 {path} 新增到歷史紀錄。",
  "notice.squashed": "已將 {n} 個提交壓縮成一個。",
  "notice.resolved": "衝突已解決 — {op} 已完成。",
  "notice.opAborted": "已中止操作 — 已還原先前狀態。",
  "notice.remapSkipped":
    "歷史已改寫，但下列分支因變更衝突無法自動重新定位：{branches}",
  "notice.branchCreated": "已建立分支 {name}。",
  "notice.detachedAt": "已簽出 {short}（分離 HEAD）。",
  "notice.openFailed": "無法開啟 {name}。要從最近項目移除嗎？",
  "notice.remoteCheckedOut": "已建立並簽出 {branch}，並追蹤該遠端分支。",
  "notice.detachedCheckedOut": "已簽出 {name}（分離 HEAD）。",
  "settings.general": "一般",
  "settings.shortcut": "快捷鍵",
  "settings.issuePanel": "議題面板",
  "settings.account": "帳號",
  "settings.personalize": "個人化",
  "settings.themes": "主題",
  "settings.plan": "方案",
  "settings.logAnytime": "Log Anytime",
  "settings.devices": "裝置",
  "settings.scopeRepo": "儲存於此 repo，隨 repo 切換",
  "settings.scopeGlobalFallback": "未開啟 repo — 編輯應用程式預設值",
  "themeStore.lede": "主題一次購買，永久擁有，適用任何方案。",
  "themeStore.refresh": "重新整理已購項目",
  "themeStore.apply": "套用",
  "themeStore.applied": "已套用",
  "themeStore.buy": "購買 ${price}",
  "themeStore.notForSale": "尚未開放購買",
  "themeStore.notForSale.hint": "此主題目前尚未開放購買，請稍後再試。",
  "themeStore.downloading": "下載中…",
  "themeStore.error.offline":
    "無法下載此主題 — 請檢查網路連線。目前的主題維持不變。",
  "themeStore.error.signIn": "請先登入才能下載此主題。目前的主題維持不變。",
  "themeStore.error.notOwned":
    "此主題尚未在你的已購項目中。目前的主題維持不變。",
  "themeStore.error.notFound": "此主題已不再提供。目前的主題維持不變。",
  "themeStore.error.rejected":
    "此主題未通過安全檢查，因此沒有安裝。目前的主題維持不變。",
  "checkout.signingIn": "等待登入完成…",
  "checkout.signInCancelled": "已取消登入 — 未購買任何項目。",
  "checkout.signInTimedOut": "登入逾時 — 未購買任何項目。",
  "checkout.signInFailed": "無法完成登入 — 未購買任何項目。",
  "checkout.signInUnavailable": "目前無法登入。",
  "checkout.unavailable": "目前無法結帳。",
  "checkoutReturn.processing": "正在完成購買…",
  "checkoutReturn.unlockedTheme": "購買完成 — 新主題已解鎖，可以套用了。",
  "checkoutReturn.unlocked": "購買完成 — 帳號權益已更新。",
  "checkoutReturn.pending":
    "尚未收到付款確認。你的購買沒有遺失 — 確認一到就會解鎖。過幾分鐘再檢查一次，或重新開啟 ADGitter。",
  "checkoutReturn.signInNeeded": "請先登入以完成解鎖購買的項目。",
  "checkoutReturn.checkAgain": "再檢查一次",
  "account.signedOut": "登入以管理帳號並解鎖付費功能。",
  "account.signIn": "登入",
  "account.signingIn": "登入中…",
  "account.cancelSignIn": "取消",
  "account.signingInHint": "請在瀏覽器完成登入,完成後會自動回到這裡。",
  "account.signOut": "登出",
  "account.signOutConfirm.title": "要在這台裝置登出嗎？",
  "account.signOutConfirm.body":
    "登出會移除這台裝置上的授權：將無法使用付費功能與已購買的主題。重新登入就會全部恢復。",
  "account.signOutConfirm.bodyOffline":
    "目前偵測不到網路。登入需要在線上驗證，所以在重新連上網路之前，你無法回到這個帳號。登出仍然會移除這台裝置上的授權：將無法使用付費功能與已購買的主題。重新登入後就會全部恢復。",
  "account.signOutIncomplete":
    "已經登出，但這台裝置上的授權無法移除。在你重新啟動 ADGitter 之前，付費功能可能仍是解鎖的。",
  "account.name": "名稱",
  "account.email": "電子郵件",
  "account.username": "使用者名稱",
  "account.manageHint": "以下項目會在瀏覽器開啟帳號入口。",
  "account.emailCommitDefault":
    "僅在 git 未設定 user.email 時作為提交作者；已設定的 user.email 一律優先。",
  "account.manageAccount": "管理帳號",
  "account.password": "密碼與安全性",
  "account.mfa": "兩步驟驗證",
  "account.mfaNotConfigured":
    "ADGitter 尚未啟用兩步驟驗證，因此在管理員開啟之前，Clerk 的安全性頁面不會提供這個選項。",
  "account.organization": "組織",
  "account.payment": "付款方式",
  "plan.currentBadge": "目前",
  "plan.upgrade": "升級",
  "plan.refresh": "重新整理授權",
  "adGate.title": "免費版由廣告支持",
  "adGate.body":
    "使用 ADGitter 免費版時，視窗底部會顯示一則廣告。廣告收益讓我們能持續維護和開發這個軟體。不想看到廣告的話，可以改用付費方案。",
  "adGate.data":
    "廣告由 Carbon Ads 提供；顯示廣告時，Carbon Ads 會收到你的 IP 位址和瀏覽器資訊。",
  "adGate.privacy": "隱私權政策",
  "adGate.accept": "接受廣告，繼續免費使用",
  "adGate.buy": "改用付費方案",
  "adGate.signIn": "已購買？登入",
  "adGate.decline": "不接受廣告",
  "ad.label": "廣告",
  "ad.fallback":
    "這個廣告版位讓 ADGitter 免費版得以持續。改用付費方案即可移除。",
  "ad.remove": "移除廣告",
  "crashConsent.label": "錯誤報告",
  "crashConsent.message":
    "要傳送當機與錯誤報告，協助我們修正問題嗎？報告透過 Sentry 傳送，會先移除 email 和檔案路徑，不含你的程式碼。之後可以在「設定 → 隱私」更改。",
  "crashConsent.allow": "允許",
  "crashConsent.deny": "不要",
  "settings.privacy": "隱私",
  "privacy.crashReports": "傳送當機與錯誤報告（Sentry）",
  "privacy.crashReportsHint":
    "會先移除 email 和檔案路徑，不含程式碼或差異內容。",
  "privacy.ads": "免費版廣告（Carbon Ads）",
  "privacy.adsPaid": "付費方案不顯示廣告，也不載入任何廣告程式。",
  "privacy.adsWithdrawPay":
    "你已同意顯示廣告。撤回後，要繼續使用免費版需重新同意，或改用付費方案。",
  "privacy.adsWithdrawFree": "你已同意顯示廣告。撤回後廣告會停止顯示。",
  "privacy.adsNotGiven": "目前未同意顯示廣告，不會載入廣告。",
  "privacy.adsWithdraw": "撤回同意",
  "trial.offer": "免費試用 {plan} {days} 天",
  "trial.note":
    "不需信用卡，也不會扣款。到期後自動回到免費方案，想繼續使用隨時購買即可。每台電腦、每個帳號各限一次。",
  "trial.start": "開始免費試用",
  "trial.starting": "正在開始…",
  "trial.active": "{plan} 試用中，到 {date} 結束。",
  "trial.ended": "你的 {plan} 試用已於 {date} 結束。",
  "trial.used": "這台電腦或這個帳號已經使用過免費試用。",
  "trial.failed": "目前無法開始試用，請稍後再試。",
  "trial.badge": "試用中",
  "trial.buy": "購買 {plan}",
  "plan.feature": "功能",
  "plan.free": "免費",
  "plan.basic": "Basic",
  "plan.advance": "Advance",
  "plan.enterprise": "Enterprise",
  "plan.feat.noAd": "移除廣告",
  "plan.feat.applyTheme": "套用自訂主題",
  "plan.feat.logBackground": "Log Anytime 背景執行 + 定期壓縮",
  "plan.feat.tickets": "優先支援工單",
  "plan.feat.seats": "團隊席次",
  "plan.feat.devices": "同時登入裝置",
  "plan.seatsAddOn": "{seats}（可加購）",
  "deviceSeat.limitTitle": "已超過登入裝置上限",
  "deviceSeat.limitBody": "按「確定」將登出最舊的裝置，並以此裝置登入。",
  "devices.usage": "{used} / {max} 台裝置",
  "devices.thisDevice": "此裝置",
  "devices.remove": "移除",
  "devices.lastSeen": "上次使用 {when}",
  "devices.neverSeen": "從未使用",
  "devices.empty": "尚無裝置。登入以同步此裝置。",
  // webhooks & integrations
  "webhook.provider.slack": "Slack",
  "webhook.provider.jira": "Jira",
  "webhook.provider.github": "GitHub",
  "webhook.provider.gitlab": "GitLab",
  "webhook.scope.send_notification": "傳送通知",
  "webhook.scope.commit": "提交",
  "webhook.scope.leave_comment": "留言",
  "webhook.scope.create_branch": "建立分支",
  "webhook.scope.rename_branch": "重新命名分支",
  "webhook.scope.delete_branch": "刪除分支",
  // external issue-provider binding
  "issueProvider.description":
    "為此儲存庫綁定一個外部議題系統。其議題會在議題面板中開啟，編輯也會同步回寫。",
  "issueProvider.noRepo": "開啟一個儲存庫以綁定議題供應商。",
  "issueProvider.providerLabel": "供應商",
  "issueProvider.deploymentLabel": "部署方式",
  "issueProvider.deployment.cloud": "雲端",
  "issueProvider.deployment.selfHosted": "自架",
  "issueProvider.hostUrlLabel": "主機網址",
  "issueProvider.hostUrlPlaceholder": "https://…",
  "issueProvider.usernameLabel": "電子郵件",
  "issueProvider.usernamePlaceholder": "you@example.com",
  "issueProvider.tokenLabel": "存取權杖",
  "issueProvider.tokenPlaceholder": "貼上個人存取權杖",
  "issueProvider.scopeHint.github":
    "請使用具備「Issues: Read and write」權限的細粒度權杖。",
  "issueProvider.scopeHint.gitlab":
    "請使用具備「api」範圍的權杖（唯讀可用「read_api」）。",
  "issueProvider.scopeHint.jira":
    "該權杖帳號需在目標專案擁有「Edit issues」權限。",
  "issueProvider.scopeHint.asana": "個人存取權杖會繼承你 Asana 帳號的權限。",
  "issueProvider.openTokenPage": "在哪裡可以取得權杖？",
  "issueProvider.scopeLabel": "範圍",
  "issueProvider.scopePlaceholder": "選擇儲存庫／專案…",
  "issueProvider.loadingContainers": "正在載入可用專案…",
  "issueProvider.connect": "連線",
  "issueProvider.connecting": "連線中…",
  "issueProvider.disconnect": "中斷連線",
  "issueProvider.invalidToken": "該存取權杖驗證失敗。",
  "issueProvider.errHostRequired": "此供應商需要填寫主機網址。",
  "issueProvider.errEmailRequired": "Jira Cloud 需要填寫電子郵件。",
  "issueProvider.errVerifyFailed": "無法驗證此憑證。",
  "issueProvider.switchHint": "綁定供應商會取代目前綁定至此儲存庫的供應商。",
  "issueProvider.boundTo": "已綁定至 {provider}",
  "issueProvider.state.disconnected": "未連線",
  "issueProvider.state.connected": "已連線",
  "issueProvider.state.error": "錯誤",
  "issueProvider.provider.jira": "Jira",
  "issueProvider.provider.asana": "Asana",
  "issueProvider.provider.gitlab": "GitLab",
  "issueProvider.provider.github": "GitHub",
  "issueProvider.credentialSaved": "已儲存存取權杖 {masked}",
  "issueProvider.credentialSavedHint":
    "已存入系統鑰匙圈，下次啟動會自動重新連線。",
  "issueProvider.replaceToken": "更換",
  "issueProvider.cancelReplace": "保留已儲存的權杖",
  "issueProvider.reconnecting": "正在使用已儲存的權杖重新連線…",
  "issueProvider.errCredentialRejected":
    "已儲存的存取權杖遭供應商拒絕，可能已被撤銷或過期。請點「更換」並貼上新的權杖。",
  "issueProvider.errReconnectOffline":
    "無法連上供應商，因此未重新驗證已儲存的權杖。權杖仍保留著，恢復連線後再試一次。",
  "issueProvider.errTokenNotSaved":
    "已連線，但權杖無法寫入系統鑰匙圈，下次啟動時將不會存在。",
  "issueProvider.scopeFilterPlaceholder": "輸入以篩選…",
  "issueProvider.scopeNoMatches": "沒有符合的專案",
  // new token dialog
  "error.REPO_NOT_FOUND": "找不到儲存庫",
  "error.INVALID_PATH": "無效的路徑",
  "error.GIT_ERROR": "Git 錯誤",
  "error.IO_ERROR": "檔案系統錯誤",
  "error.INTERNAL_ERROR": "發生錯誤",
  "error.FEATURE_LOCKED": "此功能需要付費方案",
  "error.LICENSE_DEVICE_MISMATCH":
    "這張授權屬於另一台裝置——重新登入即可綁定這一台",
  "error.LICENSE_EXPIRED": "授權已過期——續訂後即可繼續使用付費功能",
  "error.NOT_SIGNED_IN": "登入後才能繼續",
  "error.NO_SUBSCRIPTION": "找不到訂閱",
  "error.CONFLICT": "衝突",
  "error.REMOTE_UPSTREAM_MISMATCH": "該本地分支追蹤的是另一個遠端分支",
  "error.MERGE_COMMIT_IN_RANGE": "無法跨越合併提交改寫歷史",
  "error.conflict": "{short} 與目標衝突，請手動解決或復原此操作。",
  "toolbar.issues": "議題",
  "issue.search": "搜尋議題…",
  "issue.backToList": "回到議題列表",
  "issue.overflow": "更多動作",
  "issue.refresh": "從供應商重新整理",
  "issue.lockedUpsell": "議題追蹤是 Advance 功能。",
  "issue.boundBranch": "綁定分支",
  "issue.linkedBranches": "已連結的分支",
  "issue.empty.title": "議題",
  "issue.empty.pick": "請選擇要開啟的議題。",
  "issue.empty.none": "已綁定的專案目前沒有議題。",
  "issue.empty.projectsFailed": "無法載入專案。",
  "issue.empty.retryProjects": "重試",
  "issue.empty.pickProject": "選擇專案以查看議題。",
  "issue.empty.noMatch": "沒有符合搜尋條件的議題。",
  "issue.empty.unbound":
    "這個儲存庫尚未連接議題追蹤系統。請到 [[設定 → 議題面板]] 連接一個。",
  "issue.empty.credentialMissing":
    "找不到這個儲存庫議題追蹤系統的存取權杖。請到 [[設定 → 議題面板]] 重新輸入。",
  "issue.empty.loadFailed":
    "無法從追蹤系統載入議題。請先檢查網路連線，再到 [[設定 → 議題面板]] 檢查權杖。",
  "issue.hoursUnit": "小時",
  "issue.status.created": "已建立",
  "issue.status.in_progress": "進行中",
  "issue.status.done": "已完成",
  "issue.status.rejected": "已拒絕",
  "issue.field.project": "專案",
  "issue.field.status": "狀態",
  "issue.field.labels": "標籤",
  "issue.field.assignee": "指派",
  "issue.field.due": "到期",
  "issue.field.milestone": "里程碑",
  "issue.field.spend": "已花費",
  "issue.field.cost": "預估",
  "issue.dueStart": "開始",
  "issue.dueEnd": "結束",
  "issue.dueInvalid": "開始日期必須早於或等於結束日期。",
  "issue.noAssignee": "未指派",
  "issue.noMilestone": "無里程碑",
  "issue.noProject": "無專案",
  "issue.addLabel": "新增標籤",
  "issue.spendLockedHint": "進行中時可編輯",
  "issue.field.unsupportedHint": "此追蹤系統不支援：{reason}",
  "issue.field.caveatHint": "請注意：{reason}",
  "issue.field.caveatDestructive": "警告 — 這會刪除資料：{reason}",
  "issue.error.saveFailed": "無法儲存這項變更，已還原：{reason}",
  "issue.error.refreshFailed": "無法重新整理此議題：{reason}",
  "issue.error.actionFailed": "這個動作沒有完成：{reason}",
  "issue.action.new": "新增…",
  "issue.action.reject": "拒絕",
  "issue.action.start": "開始",
  "issue.action.startNewBranch": "建立分支並開始",
  "issue.action.startJustGo": "直接開始",
  "issue.action.withdraw": "撤回",
  "issue.action.done": "完成",
  "issue.action.doneUpdateSpent": "更新花費並結束",
  "issue.action.doneJustClose": "直接結束",
  "issue.action.reopen": "重新開啟",
  "issue.rejectedReason": "已拒絕：{reason}",
  "issue.comments.title": "留言",
  "issue.comments.empty": "尚無留言。",
  "issue.comments.placeholder": "撰寫留言…",
  "issue.comments.send": "送出",
  "issue.composer.title": "建立分支並開始",
  "issue.composer.type": "類型",
  "issue.composer.desc": "簡短描述",
  "issue.composer.preview": "分支名稱",
  "issue.composer.confirm": "建立並簽出",
  "issue.composer.invalid": "請輸入描述以產生有效的分支名稱。",
  "issue.reject.title": "拒絕議題",
  "issue.reject.prompt": "請填寫拒絕此議題的原因，將儲存於議題上。",
  "issue.reject.placeholder": "原因…",
  "issue.reject.confirm": "拒絕",
  "issue.reject.required": "必須填寫原因。",
  "issue.new.title": "新增議題",
  "issue.new.titleField": "標題",
  "issue.new.project": "專案",
  "issue.new.labels": "標籤（以逗號分隔）",
  "issue.new.confirm": "建立",
  // create MR / issue from a commit
  "integration.createMr": "建立合併請求",
  "integration.createIssue": "建立議題",
  "integration.noToken":
    "請先在 Webhooks 設定中新增 GitHub 或 GitLab 權杖，才能建立合併請求或議題。",
  "integration.composeMr": "新增合併請求",
  "integration.composeIssue": "新增議題",
  "integration.titleField": "標題",
  "integration.target": "供應商",
  "integration.targetBranch": "目標分支",
  "integration.creating": "建立中…",
  "integration.created": "已建立：",
  "integration.authError": "驗證失敗，請檢查 Webhooks 設定中的權杖。",
  "integration.failed": "無法完成請求，請再試一次。",
  // --- i18n audit: previously-hardcoded UI strings ---
  "common.browse": "瀏覽…",
  "branchEdit.title": "編輯分支",
  "search.scopeLabel": "搜尋範圍",
  "graph.commitLabel": "選取或拖曳提交 {sha}",
  "graph.commitHint": "點擊選取 · 拖曳到分支/提交以揀選或重新排序",
  "graph.mergeHint": "拖曳到另一個分支頂端以合併",
  "graph.crownHint":
    "點擊選取 HEAD · 拖曳到提交以重設（Shift = 硬重設，Cmd/Ctrl = 軟重設）",
  "graph.crownLabel": "選取或移動 HEAD",
  "graph.newCommit": "新增提交",
  "menu.dismiss": "關閉選單",
  "openCreate.title": "開啟或建立",
  "openCreate.pathPlaceholder": "/path/to/project",
  "colorPicker.sv": "飽和度與明度",
  "colorPicker.hue": "色相",
  "colorPicker.hex": "十六進位",
  "clone.title": "複製儲存庫",
  "clone.projectPlaceholder": "my-project",
  "clone.locationPlaceholder": "/path/to/clone/into",
  "diff.close": "關閉差異",
  "diff.title": "檔案差異",
  "branchesPanel.filter": "篩選",
  "branchesPanel.localHint": "點擊選取，雙擊以簽出 {name}",
  "branchesPanel.cannotDeleteCurrent": "無法刪除目前的分支",
  "branchesPanel.delete": "刪除",
  "branchesPanel.remoteHint": "雙擊或右鍵以簽出 {name}",
  "branchesPanel.remoteTag": "遠端",
  "branchesPanel.deleteTag": "刪除標籤",
  "branchesPanel.newTagPlaceholder": "新增標籤（於 HEAD）",
  "branchesPanel.branchesHeading": "分支",
  "branchesPanel.tagsHeading": "標籤",
  "themeStore.previewSubject": "提交主旨",
  // 導覽教學 — 步驟文案
  "tutorial.hint.info": "按「下一步」繼續。",
  "tutorial.hint.busy": "請稍候，ADGitter 正在準備中…",
  "tutorial.welcome.title": "歡迎使用 ADGitter",
  "tutorial.welcome.body":
    "ADGitter 讓 Git 看得見、摸得著：在即時的提交(Commit)圖上，用拖曳完成合併(Merge)、變基(Rebase)、揀選(Cherry-pick)與重設(Reset)。這段簡短導覽使用一個用完即丟的練習儲存庫，你的真實專案不會受到影響。",
  "tutorial.choose.title": "要參加導覽嗎？",
  "tutorial.choose.body":
    "互動教學會在練習儲存庫上帶你認識每個手勢，約需十分鐘。你也可以略過，直接開始使用 ADGitter。之後隨時可從帳號選單重新播放教學。",
  "tutorial.createDemo.title": "建立練習儲存庫",
  "tutorial.createDemo.body":
    "ADGitter 會在應用程式資料夾內建立一個小型示範儲存庫（附帶本機遠端(Remote)）。它不會碰觸你的儲存庫、網路或帳號。按「建立示範」開始。",
  "tutorial.createDemo.hint": "按「建立示範」繼續。",
  "tutorial.createDemo.primary": "建立示範",
  "tutorial.tourGraph.title": "讀懂提交(Commit)圖",
  "tutorial.tourGraph.body":
    "每一列是一個提交(Commit)，最新的在最上方。彩色泳道顯示分支(Branch)如何分岔與匯合，歷史就像一張捷運路線圖。這個練習儲存庫已經有一小段歷史：一條合併(Merge)回 main 的側枝，以及一個標了版本的發行。",
  "tutorial.tourCommit.title": "提交(Commit)",
  "tutorial.tourCommit.body":
    "每個圓點代表一個提交(Commit)，這個是「Write getting-started guide」。兩條泳道匯入同一個提交時，它就是合併(Merge)提交，可以看它上方的「Merge branch 'docs/intro'」。點擊提交即可選取並開啟詳細資料；稍後你會從它開始拖曳，進行合併、變基(Rebase)或揀選(Cherry-pick)。",
  "tutorial.tourBranch.title": "分支(Branch)標籤",
  "tutorial.tourBranch.body":
    "提交(Commit)旁邊的彩色標籤是指向它的分支(Branch)。點擊標籤可選取分支，雙擊可簽出(Checkout)，也可以把它拖到你目前所在的分支上進行合併(Merge)。這裡的 main 與 docs/intro 是兩條分支；小小的 v0.0.1 標籤(Tag)標示合併提交上的一個發行版本。",
  "tutorial.tourHead.title": "HEAD 皇冠",
  "tutorial.tourHead.body":
    "皇冠標示 HEAD，也就是你目前所在的提交(Commit)。把它拖到較舊的提交上，就能把分支(Branch)重設(Reset)到那個提交——馬上就會練習。",
  "tutorial.tourHandle.title": "合併(Merge)把手",
  "tutorial.tourHandle.body":
    "將滑鼠移到分支(Branch)的最新提交(Commit)上，上方會出現一個圓形小把手。把它拖到另一個分支的最新提交上，就能合併(Merge)這兩個分支。",
  "tutorial.firstCommit.title": "完成第一次提交(Commit)",
  "tutorial.firstCommit.body":
    "ADGitter 剛在示範儲存庫中建立了幾個新檔案。開啟「變更的檔案」面板，暫存(Stage)它們，輸入提交(Commit)訊息後提交。你的提交會立刻出現在圖上。",
  "tutorial.firstCommit.hint":
    "開啟「變更的檔案」面板，暫存(Stage)檔案，然後提交(Commit)。",
  "tutorial.seedHistory.title": "更豐富的歷史",
  "tutorial.seedHistory.body":
    "為了讓你在貼近實際的情境下練習，ADGitter 已加入更多提交(Commit)、三個分支(Branch)（feature/login、feature/theme、experiment）和兩個標籤(Tag)。先瀏覽一下提交圖，再按「下一步」。",
  "tutorial.selectCommit.title": "選取提交(Commit)",
  "tutorial.selectCommit.body":
    "點擊任一提交(Commit)即可選取。選取提交同時會開啟它的詳細資料，大多數手勢都從這裡開始。",
  "tutorial.selectCommit.hint": "在圖上點擊一個提交(Commit)。",
  "tutorial.selectMany.title": "選取多個提交(Commit)",
  "tutorial.selectMany.body":
    "在圖上的空白處拖曳出方框，框住兩個以上的提交(Commit)；或按住 Ctrl（Mac 為 ⌘）再點擊更多提交。多選的提交可以一起移動或複製。",
  "tutorial.selectMany.hint": "框選至少兩個提交(Commit)。",
  "tutorial.mergeDrag.title": "拖曳合併(Merge)",
  "tutorial.mergeDrag.body":
    "將滑鼠移到 feature/login 的最新提交(Commit)上，等圓形把手出現後，把它拖到 main 上。確認提示後，ADGitter 會把該分支(Branch)合併(Merge)進 main。",
  "tutorial.mergeDrag.hint": "把 feature/login 上的圓形把手拖到 main。",
  "tutorial.branchSelect.title": "選取分支(Branch)",
  "tutorial.branchSelect.body":
    "點擊 feature/theme 標籤即可選取整個分支(Branch)。選取的分支會被視為一個整體移動，下一步變基(Rebase)就需要這樣。",
  "tutorial.branchSelect.hint": "點擊 feature/theme 標籤。",
  "tutorial.rebase.title": "變基(Rebase)分支(Branch)",
  "tutorial.rebase.body":
    "把選取的 feature/theme 分支(Branch)拖到 main 上，將它的提交(Commit)重新套用在 main 的最新進度之上。這會重寫歷史，所以 ADGitter 會先請你確認。",
  "tutorial.rebase.hint": "把 feature/theme 拖到 main 標籤上。",
  "tutorial.cherryPick.title": "揀選(Cherry-pick)提交(Commit)",
  "tutorial.cherryPick.body":
    "點擊 experiment 分支(Branch)上的「Try faster render」提交(Commit)，然後按住 Alt（Mac 為 ⌥），把它拖到 main 標籤上。只有那一個提交的副本會落到 main 上。",
  "tutorial.cherryPick.hint":
    "按住 Alt，把「Try faster render」拖到 main 標籤上。",
  "tutorial.undo.title": "復原(Undo)上一個操作",
  "tutorial.undo.body":
    "改變主意了嗎？按工具列上的「復原(Undo)」即可撤銷上一個操作（這裡是剛才的揀選(Cherry-pick)）。沒有重做功能，請謹慎使用。",
  "tutorial.undo.hint": "按工具列上的「復原(Undo)」按鈕。",
  "tutorial.reset.title": "用 HEAD 皇冠重設(Reset)",
  "tutorial.reset.body":
    "把 HEAD 皇冠拖到 main 上較舊的提交(Commit)，讓 main 退回到那裡。直接拖曳為 mixed 重設(Reset)；按住 Shift 為 hard 重設（捨棄變更），按住 Ctrl/⌘ 為 soft 重設。確認後即可執行。",
  "tutorial.reset.hint": "把皇冠拖到 main 上較舊的提交(Commit)。",
  "tutorial.undoReset.title": "復原(Undo)重設(Reset)",
  "tutorial.undoReset.body":
    "重設(Reset)很容易挽回。按「復原(Undo)」就能讓 main 回到原來的位置。",
  "tutorial.undoReset.hint": "按工具列上的「復原(Undo)」按鈕。",
  "tutorial.checkout.title": "簽出(Checkout)分支(Branch)",
  "tutorial.checkout.body":
    "雙擊 feature/theme 標籤即可切換(Checkout)到該分支(Branch)。皇冠會移動，顯示你現在所在的分支。",
  "tutorial.checkout.hint": "雙擊 feature/theme 標籤。",
  "tutorial.openDetail.title": "開啟提交(Commit)詳細資料",
  "tutorial.openDetail.body":
    "點擊「Add config」提交(Commit)。它的詳細資料面板會列出該提交變更的每個檔案，其中有個不該被提交的機密檔案。",
  "tutorial.openDetail.hint": "點擊「Add config」提交(Commit)。",
  "tutorial.purge.title": "從歷史紀錄移除檔案",
  "tutorial.purge.body":
    "secrets.env 不該留在歷史紀錄中。在詳細資料面板裡，對 secrets.env 使用「從歷史紀錄移除此檔案」。ADGitter 會重寫這個提交(Commit)及其後的所有提交，並請你確認。",
  "tutorial.purge.hint": "把 secrets.env 從歷史紀錄移除。",
  "tutorial.addFile.title": "把檔案加入過去的提交(Commit)",
  "tutorial.addFile.body":
    "我們在你的工作資料夾裡放了一個安全的範本 secrets.example.env。在詳細資料面板選擇「新增檔案」，把它加入「Add config」提交(Commit)，讓歷史紀錄留下無害的範例。",
  "tutorial.addFile.hint":
    "把 secrets.example.env 加入「Add config」提交(Commit)。",
  "tutorial.reword.title": "修正提交(Commit)訊息",
  "tutorial.reword.body":
    "提交(Commit)「Add drak theme」有個錯字。選取它，在詳細資料面板中選擇「編輯提交訊息」，改成「Add dark theme」。",
  "tutorial.reword.hint": "編輯「Add drak theme」的訊息。",
  "tutorial.pushRejected.title": "推送(Push)你的成果",
  "tutorial.pushRejected.body":
    "按「推送(Push)」。Git 會拒絕：你重寫了遠端(Remote)已有的歷史，分支(Branch)不再接續遠端的版本，因此一般推送會因非快轉（non-fast-forward）而被拒絕。",
  "tutorial.pushRejected.hint": "按工具列上的「推送(Push)」。",
  "tutorial.forcePush.title": "強制推送(Force push)",
  "tutorial.forcePush.body":
    "當你是刻意重寫歷史時，強制推送(Force push)會用你的分支(Branch)取代遠端(Remote)分支。開啟「更多推送(Push)選項」選單，選擇「強制推送」並確認。在共用分支上請審慎使用。",
  "tutorial.forcePush.hint":
    "開啟推送(Push)選項，選擇「強制推送(Force push)」。",
  "tutorial.logIntro.title": "Log Anytime",
  "tutorial.logIntro.body":
    "Log Anytime 會在 ADGitter 開啟期間，默默把工作資料夾的快照存到專用分支(Branch)，為你還沒來得及提交(Commit)的工作多一層保障。接下來你會把它打開。",
  "tutorial.logOn.title": "開啟 Log Anytime",
  "tutorial.logOn.body":
    "按工具列上的 Log Anytime 按鈕。閃爍的紅點表示它正在記錄。",
  "tutorial.logOn.hint": "按 Log Anytime 按鈕。",
  "tutorial.logSim.title": "快照出現了",
  "tutorial.logSim.body":
    "為了省去等待，ADGitter 模擬了幾個快照。你可以在圖上的 adgitter-log 分支(Branch)看到它們；實際的快照會依你設定的間隔落在那裡。",
  "tutorial.logOff.title": "再把它關掉",
  "tutorial.logOff.body": "再按一次 Log Anytime 按鈕即可停止記錄，紅點會消失。",
  "tutorial.logOff.hint": "再按一次 Log Anytime 按鈕。",
  "tutorial.theme.title": "挑選主題",
  "tutorial.theme.body":
    "開啟設定（齒輪圖示），前往「個人化」，套用你喜歡的圖表主題，然後按「確定」。免費主題可離線使用。",
  "tutorial.theme.hint": "開啟設定，套用不同的主題，然後按「確定」。",
  "tutorial.issueBranch.title": "從議題建立分支(Branch)",
  "tutorial.issueBranch.body":
    "開啟「議題」面板，為某個議題建立分支(Branch)；ADGitter 會替你命名分支，並把兩者連結起來。本教學中的議題僅為範例，不會傳送到任何地方。",
  "tutorial.issueBranch.hint": "開啟「議題」，為某個議題建立分支(Branch)。",
  "tutorial.issueStatus.title": "讓議題保持最新",
  "tutorial.issueStatus.body":
    "工作時，無需離開 ADGitter 就能變更議題狀態，例如改為「進行中」。",
  "tutorial.issueStatus.hint": "在面板中變更議題的狀態。",
  "tutorial.finish.title": "全部完成",
  "tutorial.finish.body":
    "導覽結束了。示範儲存庫即將被移除。接下來有一份簡短指南，說明如何開啟你自己的儲存庫、設定遠端(Remote)與建立存取權杖。你隨時可以從帳號選單重新播放這個教學。",
  "tutorial.finish.primary": "開始使用 ADGitter",
};

// Other launch locales — filled incrementally; fall back to `en` for now.
export const catalogs: Record<Locale, Catalog> = {
  en,
  "zh-Hant": zhHant,
  "zh-Hans": zhHans,
  ja,
  ko,
  hi,
  de,
  fr,
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && v in catalogs;
}
