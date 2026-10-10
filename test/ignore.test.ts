import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIgnore, loadIgnore } from "../src/ignore.js";

const ig = (...lines: string[]) => createIgnore(lines);

describe("createIgnore — parsing", () => {
  it("skips comments and blank lines", () => {
    expect(ig("# comment", "", "   ", "test/").patternCount).toBe(1);
  });
});

describe("createIgnore — bare name matches at any depth", () => {
  const i = ig("secrets.ts");
  it("matches at root and nested", () => {
    expect(i.matchPath("secrets.ts")).toBe(true);
    expect(i.matchPath("src/config/secrets.ts")).toBe(true);
  });
  it("does not match a different name", () => {
    expect(i.matchPath("src/app.ts")).toBe(false);
  });
});

describe("createIgnore — directory-only (trailing slash)", () => {
  const i = ig("test/");
  it("matches contents at any depth", () => {
    expect(i.matchPath("test/a.ts")).toBe(true);
    expect(i.matchPath("pkg/test/b.ts")).toBe(true);
  });
  it("does not match a file literally named test", () => {
    expect(i.matchPath("test")).toBe(false);
  });
  it("does not match a sibling-prefix dir", () => {
    expect(i.matchPath("testing/a.ts")).toBe(false);
  });
});

describe("createIgnore — anchored (contains a slash)", () => {
  const i = ig("src/gen");
  it("matches only from the root", () => {
    expect(i.matchPath("src/gen")).toBe(true);
    expect(i.matchPath("src/gen/x.ts")).toBe(true);
    expect(i.matchPath("pkg/src/gen/x.ts")).toBe(false);
  });
});

describe("createIgnore — leading slash anchors a bare name", () => {
  const i = ig("/README.md");
  it("matches at the root only", () => {
    expect(i.matchPath("README.md")).toBe(true);
    expect(i.matchPath("docs/README.md")).toBe(false);
  });
});

describe("createIgnore — wildcards", () => {
  it("* stays within a segment but a bare glob matches any depth", () => {
    const i = ig("*.md");
    expect(i.matchPath("README.md")).toBe(true);
    expect(i.matchPath("docs/guide.md")).toBe(true);
    expect(i.matchPath("a.md.ts")).toBe(false);
  });
  it("* does not cross a slash when anchored", () => {
    const i = ig("src/*.ts");
    expect(i.matchPath("src/a.ts")).toBe(true);
    expect(i.matchPath("src/sub/a.ts")).toBe(false);
  });
  it("** crosses segments", () => {
    const i = ig("src/**/*.test.ts");
    expect(i.matchPath("src/a.test.ts")).toBe(true);
    expect(i.matchPath("src/x/y/a.test.ts")).toBe(true);
    expect(i.matchPath("src/a.ts")).toBe(false);
  });
  it("? matches exactly one character", () => {
    const i = ig("/a?.ts");
    expect(i.matchPath("ab.ts")).toBe(true);
    expect(i.matchPath("abc.ts")).toBe(false);
  });
});

describe("createIgnore — negation (last match wins)", () => {
  const i = ig("test/", "!test/keep.ts");
  it("re-includes a negated path", () => {
    expect(i.matchPath("test/a.ts")).toBe(true);
    expect(i.matchPath("test/keep.ts")).toBe(false);
  });
});

describe("createIgnore — regex metacharacters are literal", () => {
  const i = ig("weird(1).ts");
  it("treats ( ) . as literals", () => {
    expect(i.matchPath("weird(1).ts")).toBe(true);
    expect(i.matchPath("weirdX1Xyts")).toBe(false);
  });
});

describe("createIgnore — empty allowlist is a no-op", () => {
  it("never matches", () => {
    const i = ig();
    expect(i.patternCount).toBe(0);
    expect(i.matchPath("anything.ts")).toBe(false);
  });
});

describe("loadIgnore — missing file", () => {
  it("returns an empty no-op matcher", () => {
    const dir = mkdtempSync(join(tmpdir(), "vet-ign-"));
    const i = loadIgnore(dir);
    expect(i.patternCount).toBe(0);
    expect(i.matchPath("x.ts")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
