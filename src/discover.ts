import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { looksBinary } from "./languages.js";

const MAX_BYTES = 1_000_000; // skip very large files (core also caps internally)
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next"]);

function git(args: string[]): string[] {
  try {
    return execFileSync("git", args, { encoding: "utf8" })
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
      const tracked = git(["ls-files", p]);
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

export function readFiles(paths: string[]): FileToScan[] {
  const seen = new Set<string>();
  const result: FileToScan[] = [];
  for (const p of paths) {
    if (seen.has(p) || looksBinary(p)) continue;
    seen.add(p);
    try {
      const st = statSync(p);
      if (!st.isFile() || st.size > MAX_BYTES) continue;
      const content = readFileSync(p, "utf8");
      if (content.indexOf("\0") !== -1) continue; // NUL byte → binary, skip
      result.push({ path: p, content });
    } catch {
      // unreadable / deleted — skip
    }
  }
  return result;
}
