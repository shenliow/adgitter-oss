import { describe, it, expect } from "vitest";
import { searchRepo, commitDateKey, SEARCH_SCOPES } from "./search";
import type { Commit, RefList } from "./ipc";

function commit(sha: string, subject: string, author = "Ada"): Commit {
  return {
    sha,
    short_sha: sha.slice(0, 7),
    author_name: author,
    author_email: "a@x.com",
    timestamp: 1700000000,
    subject,
    body: "",
    parents: [],
  };
}

const commits = [
  commit("a".repeat(40), "feat: add search", "Ada"),
  commit("b".repeat(40), "fix: crash on open", "Linus"),
  commit("c".repeat(40), "docs: readme", "Ada"),
];

const refs: RefList = {
  head: { branch: "main", target: "a".repeat(40), detached: false },
  branches: [
    { name: "main", kind: "branch", target: "a".repeat(40) },
    { name: "search-ui", kind: "branch", target: "b".repeat(40) },
  ],
  remotes: [],
  tags: [{ name: "v1.0", kind: "tag", target: "c".repeat(40) }],
};

describe("searchRepo", () => {
  it("returns nothing for an empty query", () => {
    expect(searchRepo("  ", commits, refs)).toEqual([]);
  });

  it("matches commit subjects (case-insensitive)", () => {
    const r = searchRepo("CRASH", commits, refs);
    expect(
      r.some((x) => x.kind === "commit" && x.label.includes("crash")),
    ).toBe(true);
  });

  it("matches by author", () => {
    const r = searchRepo("linus", commits, refs);
    expect(r.map((x) => x.sha)).toContain("b".repeat(40));
  });

  it("matches a sha prefix", () => {
    const r = searchRepo("aaaaaaa", commits, refs);
    expect(r[0].sha).toBe("a".repeat(40));
  });

  it("matches branch and tag names, resolving to their target sha", () => {
    const br = searchRepo("search-ui", commits, refs).find(
      (x) => x.kind === "branch",
    );
    expect(br?.sha).toBe("b".repeat(40));
    const tag = searchRepo("v1", commits, refs).find((x) => x.kind === "tag");
    expect(tag?.sha).toBe("c".repeat(40));
  });

  it("ranks an exact branch-name match above a commit substring", () => {
    // "main" is an exact branch name; also appears nowhere in commits here.
    const r = searchRepo("main", commits, refs);
    expect(r[0].kind).toBe("branch");
  });

  it("respects the limit", () => {
    expect(searchRepo("a", commits, refs, [], 1)).toHaveLength(1);
  });

  // The `assignee` scope — only supplied when a tracker is bound.
  const issues = [
    { id: "i1", number: 142, title: "Login form", assignee: { name: "Alice" } },
    { id: "i2", number: 7, title: "Crash on open", assignee: { name: "Bob" } },
    { id: "i3", number: 9, title: "No assignee here" },
  ];

  it("matches issues by assignee name → issue result with issueId", () => {
    const r = searchRepo("alice", commits, refs, issues);
    const hit = r.find((x) => x.kind === "issue");
    expect(hit?.issueId).toBe("i1");
    expect(hit?.sha).toBe("");
    expect(hit?.detail).toContain("Alice");
  });

  it("does not surface issues without a matching assignee", () => {
    // "open" appears in a commit + issue title, but no assignee is named "open".
    const r = searchRepo("open", commits, refs, issues);
    expect(r.some((x) => x.kind === "issue")).toBe(false);
  });

  it("surfaces no issue results when none are supplied (unbound repo)", () => {
    const r = searchRepo("alice", commits, refs);
    expect(r.some((x) => x.kind === "issue")).toBe(false);
  });
});

// --- field scopes -----------------------------------------------------------
// Each scope must match ONLY its own field(s): every case below pairs a
// positive ("finds what lives in this field") with a negative ("does not find
// a value that lives in some other field").

/** Local wall-clock → Unix seconds, so date assertions hold in any time zone. */
function localTs(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
): number {
  return Math.floor(new Date(y, m - 1, d, hh, mm, 0).getTime() / 1000);
}

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

/**
 * Fixtures with every field distinct, and deliberate cross-field decoys:
 * "Linus" is c2's *author* but appears in c3's *body*; "readme" is a subject
 * word only; "main"/"v1.0" exist only as ref names.
 */
const scoped: Commit[] = [
  {
    sha: A,
    short_sha: A.slice(0, 7),
    author_name: "Ada Lovelace",
    author_email: "ada@example.com",
    timestamp: localTs(2026, 8, 18, 14, 30),
    subject: "feat: add search",
    body: "Closes #42 — groundwork for the refactor",
    parents: [],
  },
  {
    sha: B,
    short_sha: B.slice(0, 7),
    author_name: "Linus T",
    author_email: "linus@kernel.org",
    timestamp: localTs(2026, 8, 19, 9, 5),
    subject: "fix: crash on open",
    body: "",
    parents: [],
  },
  {
    sha: C,
    short_sha: C.slice(0, 7),
    author_name: "Ada Lovelace",
    author_email: "ada@example.com",
    timestamp: localTs(2025, 12, 1, 23, 59),
    subject: "docs: readme",
    body: "Thanks to Linus for the review",
    parents: [],
  },
];

const scopedRefs: RefList = {
  head: { branch: "main", target: A, detached: false },
  branches: [
    { name: "main", kind: "branch", target: A },
    { name: "search-ui", kind: "branch", target: B },
  ],
  remotes: [],
  tags: [{ name: "v1.0", kind: "tag", target: C }],
};

const scopedIssues = [
  { id: "i1", number: 1, title: "Login form", assignee: { name: "Alice" } },
];

/** Run a scoped search and return the matched shas. */
function shas(q: string, scope: Parameters<typeof searchRepo>[5]): string[] {
  return searchRepo(q, scoped, scopedRefs, scopedIssues, 20, scope).map(
    (r) => r.sha,
  );
}

describe("searchRepo — scopes", () => {
  it("lists all eight scopes, with `all` first", () => {
    expect(SEARCH_SCOPES[0]).toBe("all");
    expect([...SEARCH_SCOPES]).toEqual([
      "all",
      "commits",
      "message",
      "author",
      "hash",
      "time",
      "branch",
      "tag",
    ]);
  });

  it("`all` still matches everything it used to (no regression)", () => {
    // Subject, author, sha prefix, branch and tag names all in one scope.
    expect(shas("crash", "all")).toContain(B);
    expect(shas("lovelace", "all")).toContain(A);
    expect(shas(A.slice(0, 7), "all")).toContain(A);
    const all = searchRepo("main", scoped, scopedRefs, scopedIssues, 20, "all");
    expect(all[0].kind).toBe("branch");
    // ...and the issue-assignee match stays exclusive to `all`.
    expect(
      searchRepo("alice", scoped, scopedRefs, scopedIssues, 20, "all").some(
        (r) => r.kind === "issue",
      ),
    ).toBe(true);
  });

  it("defaults to `all` when no scope is passed", () => {
    expect(searchRepo("crash", scoped, scopedRefs)).toEqual(
      searchRepo("crash", scoped, scopedRefs, [], 20, "all"),
    );
  });

  describe("message", () => {
    it("matches the subject", () => {
      expect(shas("add search", "message")).toEqual([A]);
    });

    it("matches the body — which `all` never looked at", () => {
      expect(shas("groundwork", "message")).toEqual([A]);
      expect(shas("groundwork", "all")).toEqual([]);
    });

    it("finds the body mention but not the same name in author", () => {
      // "Linus" authors c2 and is *mentioned* in c3's body.
      expect(shas("linus", "message")).toEqual([C]);
    });

    it("does not match an author, email, sha or date", () => {
      expect(shas("lovelace", "message")).toEqual([]);
      expect(shas("kernel.org", "message")).toEqual([]);
      expect(shas(A.slice(0, 7), "message")).toEqual([]);
      expect(shas("2026-08", "message")).toEqual([]);
    });
  });

  describe("author", () => {
    it("matches the author name", () => {
      expect(shas("lovelace", "author")).toEqual([A, C]);
    });

    it("matches the author email", () => {
      expect(shas("kernel.org", "author")).toEqual([B]);
    });

    it("finds the author but not the body that merely mentions them", () => {
      expect(shas("linus", "author")).toEqual([B]);
    });

    it("does not match subjects, bodies, shas or dates", () => {
      expect(shas("readme", "author")).toEqual([]);
      expect(shas("groundwork", "author")).toEqual([]);
      expect(shas(A.slice(0, 7), "author")).toEqual([]);
      expect(shas("2026-08", "author")).toEqual([]);
    });

    it("ranks an exact author match above a partial one", () => {
      const commitsMixed: Commit[] = [
        { ...scoped[0], sha: A, author_name: "Adalyn Prefix" },
        { ...scoped[1], sha: B, author_name: "Ada" },
      ];
      const r = searchRepo("ada", commitsMixed, null, [], 20, "author");
      expect(r[0].sha).toBe(B); // exact (6) beats prefix (5)
    });
  });

  describe("hash", () => {
    it("matches a full sha and a short-sha prefix", () => {
      expect(shas(B, "hash")).toEqual([B]);
      expect(shas(B.slice(0, 7), "hash")).toEqual([B]);
    });

    it("does not match an author name (negative case)", () => {
      expect(shas("ada", "hash")).toEqual([]);
      expect(shas("lovelace", "hash")).toEqual([]);
    });

    it("does not match subjects, bodies or dates", () => {
      expect(shas("readme", "hash")).toEqual([]);
      expect(shas("groundwork", "hash")).toEqual([]);
      expect(shas("2026-08", "hash")).toEqual([]);
    });
  });

  describe("time", () => {
    it("normalizes a commit to local `YYYY-MM-DD HH:MM`", () => {
      expect(commitDateKey(localTs(2026, 8, 18, 14, 30))).toBe(
        "2026-08-18 14:30",
      );
      expect(commitDateKey(localTs(2025, 12, 1, 23, 59))).toBe(
        "2025-12-01 23:59",
      );
    });

    it("filters a whole year, a whole month and a single day by prefix", () => {
      expect(shas("2026", "time")).toEqual([A, B]);
      expect(shas("2026-08", "time")).toEqual([A, B]);
      expect(shas("2026-08-19", "time")).toEqual([B]);
      expect(shas("2025", "time")).toEqual([C]);
    });

    it("accepts `/` and `.` as date separators", () => {
      expect(shas("2026/08/19", "time")).toEqual([B]);
      expect(shas("2026.08.19", "time")).toEqual([B]);
    });

    it("matches a clock time as a substring", () => {
      expect(shas("23:59", "time")).toEqual([C]);
      expect(shas("14:30", "time")).toEqual([A]);
    });

    it("does not match text fields that happen to contain digits", () => {
      expect(shas("#42", "time")).toEqual([]);
      expect(shas("readme", "time")).toEqual([]);
      expect(shas("lovelace", "time")).toEqual([]);
    });
  });

  describe("commits", () => {
    it("spans every commit field: subject, body, author, email, sha, date", () => {
      expect(shas("add search", "commits")).toEqual([A]);
      expect(shas("groundwork", "commits")).toEqual([A]);
      expect(shas("lovelace", "commits")).toEqual([A, C]);
      expect(shas("kernel.org", "commits")).toEqual([B]);
      expect(shas(B.slice(0, 7), "commits")).toEqual([B]);
      expect(shas("2025-12", "commits")).toEqual([C]);
    });

    it("never returns branch, tag or issue results", () => {
      const r = searchRepo(
        "main",
        scoped,
        scopedRefs,
        scopedIssues,
        20,
        "commits",
      );
      expect(r).toEqual([]);
      expect(shas("v1.0", "commits")).toEqual([]);
      expect(shas("alice", "commits")).toEqual([]);
    });
  });

  describe("branch", () => {
    it("matches branch names, resolving to the target sha", () => {
      const r = searchRepo("search-ui", scoped, scopedRefs, [], 20, "branch");
      expect(r).toHaveLength(1);
      expect(r[0].kind).toBe("branch");
      expect(r[0].sha).toBe(B);
    });

    it("does not match tags, commits or issues", () => {
      expect(shas("v1.0", "branch")).toEqual([]);
      expect(shas("crash", "branch")).toEqual([]);
      expect(shas("lovelace", "branch")).toEqual([]);
      expect(shas("alice", "branch")).toEqual([]);
    });

    it("ranks exact > prefix > substring", () => {
      const refsMany: RefList = {
        ...scopedRefs,
        branches: [
          { name: "feature/ui", kind: "branch", target: A },
          { name: "ui-work", kind: "branch", target: B },
          { name: "ui", kind: "branch", target: C },
        ],
      };
      const r = searchRepo("ui", scoped, refsMany, [], 20, "branch");
      expect(r.map((x) => x.label)).toEqual(["ui", "ui-work", "feature/ui"]);
    });

    it("returns nothing when the repo has no refs loaded", () => {
      expect(searchRepo("main", scoped, null, [], 20, "branch")).toEqual([]);
    });
  });

  describe("tag", () => {
    it("matches tag names, resolving to the target sha", () => {
      const r = searchRepo("v1", scoped, scopedRefs, [], 20, "tag");
      expect(r).toHaveLength(1);
      expect(r[0].kind).toBe("tag");
      expect(r[0].sha).toBe(C);
    });

    it("does not match branches, commits or issues", () => {
      expect(shas("main", "tag")).toEqual([]);
      expect(shas("search-ui", "tag")).toEqual([]);
      expect(shas("crash", "tag")).toEqual([]);
      expect(shas("alice", "tag")).toEqual([]);
    });
  });

  it("honours the limit in a narrowed scope", () => {
    expect(
      searchRepo("lovelace", scoped, scopedRefs, [], 1, "author"),
    ).toHaveLength(1);
  });

  it("returns nothing for a blank query in every scope", () => {
    for (const s of SEARCH_SCOPES) {
      expect(
        searchRepo("   ", scoped, scopedRefs, scopedIssues, 20, s),
      ).toEqual([]);
    }
  });
});
