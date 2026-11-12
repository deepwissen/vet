import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { looksBinary } from "./languages.js";

const MAX_BYTES = 1_000_000; // skip very large files (core also caps internally)
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next"]);

function git(args: string[], cwd?: string): string[] {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      cwd,
      // Suppress git's stderr (e.g. "fatal: … is outside repository") — a
      // directory in another repo is expected and handled by the walk fallback.
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function stagedFiles(): string[] {
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACM"]);
}

export function changedSince(ref: string): string[] {
  return git(["diff", ref, "--name-only", "--diff-filter=ACM"]);
}

export function isGitRepo(cwd?: string): boolean {
  return git(["rev-parse", "--is-inside-work-tree"], cwd)[0] === "true";
}

/** Raw git stdout (not line-split) — for diff output where lines matter. */
function gitRaw(args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

/** One (commit, file) block of lines ADDED by that commit, with real line numbers. */
export interface HistoryEntry {
  path: string;
  content: string; // added lines, joined by \n
  lineMap: number[]; // lineMap[i] = new-file line number of content line i+1
  commit: string; // short sha
}

const HISTORY_MAX_COMMITS = 5000;
const COMMIT_MARK = "\x1fC "; // unit-separator so it can't collide with diff content

/**
 * Walk git history and return the lines each commit *added*, per file — so a
 * secret that was committed and later deleted is still caught at its introducing
 * commit (what gitleaks does by scanning commit patches). Uses `-U0` so only
 * changed lines are returned, and reconstructs new-file line numbers from hunk
 * headers. `since` bounds to `since..HEAD`; otherwise all of HEAD's history.
 */
export function historyEntries(opts: { since?: string } = {}): {
  entries: HistoryEntry[];
  commitsScanned: number;
  truncated: boolean;
} {
  const range = opts.since ? `${opts.since}..HEAD` : "HEAD";
  const total = Number(git(["rev-list", "--count", range])[0] ?? "0");
  const truncated = total > HISTORY_MAX_COMMITS;
  const raw = gitRaw([
    "log",
    range,
    "-n",
    String(HISTORY_MAX_COMMITS),
    "-p",
    "-U0",
    "--no-color",
    "--no-merges",
    `--format=${COMMIT_MARK}%h`,
  ]);
  if (!raw) return { entries: [], commitsScanned: Math.min(total, HISTORY_MAX_COMMITS), truncated };

  const groups = new Map<string, HistoryEntry>();
  let commit = "";
  let path = "";
  let cursor = 0; // next added line's new-file number
  for (const line of raw.split("\n")) {
    if (line.startsWith(COMMIT_MARK)) {
      commit = line.slice(COMMIT_MARK.length).trim();
      path = "";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const p = line.slice(4);
      path = p === "/dev/null" || p === "b/dev/null" ? "" : p.replace(/^[ab]\//, "");
      continue;
    }
    if (line.startsWith("@@")) {
      const m = /\+(\d+)/.exec(line); // +c,d → start at c
      cursor = m ? Number(m[1]) : 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (!path || !commit) continue;
      const key = `${commit}\x00${path}`;
      let g = groups.get(key);
      if (!g) {
        g = { path, content: "", lineMap: [], commit };
        groups.set(key, g);
      }
      if (g.content.length < 100_000) {
        g.content += (g.content ? "\n" : "") + line.slice(1);
        g.lineMap.push(cursor);
      }
      cursor++;
    } else if (line.startsWith(" ")) {
      cursor++; // context (rare with -U0)
    }
  }
  return {
    entries: [...groups.values()],
    commitsScanned: Math.min(total, HISTORY_MAX_COMMITS),
    truncated,
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** A file stays as-is; a directory expands to tracked files (git, .gitignore-aware) or a filtered walk. */
export function expandPaths(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      // Run git inside the target dir so it queries the repo that contains p
      // (not the cwd's repo); ls-files paths are relative to p, so rejoin them.
      const tracked = git(["ls-files"], p).map((f) => join(p, f));
      out.push(...(tracked.length ? tracked : walk(p)));
    } else {
      out.push(p);
    }
  }
  return out;
}

export interface FileToScan {
  path: string;
  content: string;
}

export interface ReadResult {
  files: FileToScan[];
  /** Text files skipped only because they exceed MAX_BYTES. Surfaced to the user —
   *  a silently unscanned file must never read as "clean". */
  skippedLarge: string[];
}

export function readFiles(paths: string[]): ReadResult {
  const seen = new Set<string>();
  const files: FileToScan[] = [];
  const skippedLarge: string[] = [];
  for (const p of paths) {
    if (seen.has(p) || looksBinary(p)) continue;
    seen.add(p);
    try {
      const st = statSync(p);
      if (!st.isFile()) continue;
      if (st.size > MAX_BYTES) {
        skippedLarge.push(p); // too large to scan — disclose it, don't drop it silently
        continue;
      }
      const content = readFileSync(p, "utf8");
      if (content.indexOf("\0") !== -1) continue; // NUL byte → binary, skip
      files.push({ path: p, content });
    } catch {
      // unreadable / deleted — skip
    }
  }
  return { files, skippedLarge };
}
