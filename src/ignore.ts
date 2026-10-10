import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * A minimal, zero-dependency `.vetignore` matcher implementing a documented
 * subset of gitignore semantics:
 *   - `#` comments and blank lines are skipped
 *   - `!pattern` negates (un-ignores); last matching rule wins
 *   - a trailing `/` makes the pattern directory-only (matches its contents)
 *   - a leading `/` anchors to the root; a pattern containing a `/` is anchored
 *   - a pattern with no `/` matches that name at any depth
 *   - `*` matches within a path segment, `**` matches across segments, `?` one char
 */
export interface Ignore {
  matchPath(relPath: string): boolean;
  readonly patternCount: number;
}

interface Rule {
  negated: boolean;
  re: RegExp;
}

/** Convert one glob body (no leading `!`, no trailing `/`) to a regex fragment. */
function globToRegex(glob: string): string {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++; // consume second '*'
        if (glob[i + 1] === "/") {
          i++; // consume the '/'
          re += "(?:.*/)?"; // '**/' -> zero or more leading dirs
        } else {
          re += ".*"; // '**' (incl. trailing '/**' after a literal '/')
        }
      } else {
        re += "[^/]*"; // '*' -> within a segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += "\\" + c; // escape regex metacharacters
    } else {
      re += c; // literal (incl. '/' and - _ etc.)
    }
  }
  return re;
}

function compile(body: string): RegExp {
  const dirOnly = /\/$/.test(body);
  let pattern = body.replace(/\/+$/, "");
  const anchored = pattern.startsWith("/") || pattern.includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);

  const core = globToRegex(pattern);
  const head = anchored ? "^" : "^(?:.*/)?"; // anchored to root vs name at any depth
  const tail = dirOnly ? "/.*$" : "(?:/.*)?$"; // dir -> its contents; file -> itself or contents
  return new RegExp(head + core + tail);
}

export function createIgnore(lines: string[]): Ignore {
  const rules: Rule[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    const body = negated ? line.slice(1) : line;
    if (!body) continue;
    rules.push({ negated, re: compile(body) });
  }

  return {
    patternCount: rules.length,
    matchPath(relPath: string): boolean {
      const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
      let ignored = false;
      for (const r of rules) {
        if (r.re.test(rel)) ignored = !r.negated; // last match wins
      }
      return ignored;
    },
  };
}

/** Load `.vetignore` (or a named file) from `root`. Missing file -> empty (no-op). */
export function loadIgnore(root: string, fileName = ".vetignore"): Ignore {
  const path = isAbsolute(fileName) ? fileName : join(root, fileName);
  try {
    return createIgnore(readFileSync(path, "utf8").split("\n"));
  } catch {
    return createIgnore([]);
  }
}
