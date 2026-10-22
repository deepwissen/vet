import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCanary } from "../src/canary.js";

let dir: string;
let cwd: string;
let home: string | undefined;

function invoke(argv: string[]): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const code = runCanary(
    argv,
    (s) => (out += s),
    (s) => (err += s)
  );
  return { code, out, err };
}

const read = (name: string): string => readFileSync(join(dir, name), "utf8");
const has = (name: string): boolean => existsSync(join(dir, name));
const CANARY = "preflight-canary.secret.txt";
const STATE = ".preflight-canary.json";

beforeEach(() => {
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "vet-canary-"));
  process.chdir(dir);
  // Keep the transcript search hermetic: point HOME at the temp dir so --check
  // doesn't walk the real ~/.claude/projects (slow and non-deterministic).
  home = process.env.HOME;
  process.env.HOME = dir;
});
afterEach(() => {
  process.chdir(cwd);
  if (home === undefined) delete process.env.HOME;
  else process.env.HOME = home;
  rmSync(dir, { recursive: true, force: true });
});

describe("vet canary — write", () => {
  it("writes a clearly-fake, scanner-detectable token and git-ignores it", () => {
    const r = invoke([]);
    expect(r.code).toBe(0);
    expect(has(CANARY)).toBe(true);
    const body = read(CANARY);
    expect(body).toMatch(/FAKE credential/i);
    expect(body).toMatch(/PREFLIGHT-CANARY-DO-NOT-USE-[0-9a-f]{32}/);
    // keyword-assignment shape so vet's own secret scanner recognizes it
    expect(body).toMatch(/api_key\s*=\s*"PREFLIGHT-CANARY-DO-NOT-USE-/);
    // never committed
    expect(read(".gitignore")).toContain(CANARY);
    // state recorded for exact cleanup
    expect(has(STATE)).toBe(true);
  });

  it("uses a unique non-provider prefix (push protection won't flag it)", () => {
    invoke([]);
    const token = JSON.parse(read(STATE)).token as string;
    expect(token).toMatch(/^PREFLIGHT-CANARY-DO-NOT-USE-[0-9a-f]{32}$/);
    // not an AWS/GitHub/Stripe/etc. real-provider prefix
    expect(token).not.toMatch(/^(AKIA|ghp_|sk_live_|xox)/);
  });

  it("adds the canary to an existing AI-ignore file that didn't cover it", () => {
    writeFileSync(join(dir, ".cursorignore"), "**/.env.*\n");
    const r = invoke([]);
    expect(read(".cursorignore")).toContain(CANARY);
    expect(r.out).toMatch(/\.cursorignore/);
  });

  it("does not re-append when an AI-ignore file already covers the canary", () => {
    writeFileSync(join(dir, ".cursorignore"), "preflight-canary.secret.txt\n");
    invoke([]);
    const ci = read(".cursorignore");
    // our managed block should NOT be added — it's already covered
    expect(ci).not.toContain("vet canary");
  });

  it("warns when there is no AI-ignore file to test against", () => {
    const r = invoke([]);
    expect(r.out).toMatch(/No AI-ignore file/i);
  });

  it("refuses to set up a second canary over an existing one", () => {
    invoke([]);
    const r = invoke([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/already set up/i);
  });
});

describe("vet canary --check", () => {
  it("reports no leak (exit 0) when the token lives only in the canary file", () => {
    invoke([]);
    const r = invoke(["--check"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/No leak found/i);
    // never claims safety — absence of a hit is not proof
    expect(r.out).toMatch(/not proof|≠ safe/i);
  });

  it("reports a leak (exit 1) when the token surfaces in another repo file", () => {
    invoke([]);
    const token = JSON.parse(read(STATE)).token as string;
    writeFileSync(join(dir, "agent-answer.md"), `the key is ${token}\n`);
    const r = invoke(["--check"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/LEAK/);
    expect(r.out).toContain("agent-answer.md");
  });

  it("errors (exit 2) when no canary is set up", () => {
    const r = invoke(["--check"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no canary/i);
  });
});

describe("vet canary --cleanup", () => {
  it("reverses every edit byte-for-byte and removes the canary + state", () => {
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    writeFileSync(join(dir, ".cursorignore"), "**/.env.*\n");
    const gi0 = read(".gitignore");
    const ci0 = read(".cursorignore");

    invoke([]);
    expect(has(CANARY)).toBe(true);

    const r = invoke(["--cleanup"]);
    expect(r.code).toBe(0);
    expect(has(CANARY)).toBe(false);
    expect(has(STATE)).toBe(false);
    expect(read(".gitignore")).toBe(gi0);
    expect(read(".cursorignore")).toBe(ci0);
  });

  it("deletes ignore files it created (didn't exist before)", () => {
    // no .gitignore present → canary creates it → cleanup removes it
    invoke([]);
    expect(has(".gitignore")).toBe(true);
    invoke(["--cleanup"]);
    expect(has(".gitignore")).toBe(false);
  });

  it("is a no-op with exit 0 when there is nothing to clean", () => {
    const r = invoke(["--cleanup"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/nothing to clean up/i);
  });
});

describe("vet canary --help", () => {
  it("prints usage and exits 0", () => {
    const r = invoke(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/runtime exposure test/i);
  });
});
