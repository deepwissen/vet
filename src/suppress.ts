import type { VetFinding } from "./types.js";

/**
 * Inline suppression directives (line-level / per-rule), language-agnostic —
 * the token is matched anywhere on the line, so it works inside any comment
 * syntax. Mirrors the familiar `gitleaks:allow` / eslint-disable conventions.
 *
 *   const k = "AKIA…";            // vet:allow
 *   const k = "AKIA…";            // vet:allow aws-access-key, trap-x
 *   const k = "AKIA…";            // vet:allow aws-access-key -- documented example
 *   // vet:allow-next-line aws-access-key
 *   const k = "AKIA…";
 *
 * A bare `vet:allow` suppresses every finding on the line. With rule ids it
 * suppresses only those. Free-text reasons go after `--`.
 */
export interface SuppressResult {
  kept: VetFinding[];
  suppressed: number;
}

interface Directive {
  all: boolean;
  rules: Set<string>;
}

function findDirective(lineText: string, kind: "line" | "next-line"): Directive | null {
  const token = kind === "next-line" ? "vet:allow-next-line" : "vet:allow";
  // `(?![\w-])` so a bare "vet:allow" search does not match "vet:allow-next-line".
  const m = new RegExp(token + "(?![\\w-])").exec(lineText);
  if (!m) return null;
  const rest = lineText.slice(m.index + token.length);
  const before = rest.split("--")[0]; // free-text reason lives after `--`
  const rules = before.split(/[\s,]+/).filter((t) => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(t));
  return rules.length ? { all: false, rules: new Set(rules) } : { all: true, rules: new Set() };
}

function matches(d: Directive, rule: string): boolean {
  return d.all || d.rules.has(rule);
}

function isSuppressed(f: VetFinding, lines: string[]): boolean {
  if (!f.line) return false; // no line → can't target inline (use .vetignore)
  const own = lines[f.line - 1];
  if (own !== undefined) {
    const d = findDirective(own, "line");
    if (d && matches(d, f.rule)) return true;
  }
  const above = lines[f.line - 2];
  if (above !== undefined) {
    const d = findDirective(above, "next-line");
    if (d && matches(d, f.rule)) return true;
  }
  return false;
}

/** Drop findings suppressed by an inline directive on (or above) their line. */
export function applyInlineSuppressions(findings: VetFinding[], content: string): SuppressResult {
  if (findings.length === 0) return { kept: findings, suppressed: 0 };
  const lines = content.split("\n");
  const kept: VetFinding[] = [];
  let suppressed = 0;
  for (const f of findings) {
    if (isSuppressed(f, lines)) suppressed++;
    else kept.push(f);
  }
  return { kept, suppressed };
}
