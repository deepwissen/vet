// Ground-truth loaders. Every format is normalized to
//   { file, line, endLine, truth: boolean, type }
// `file` is relative to the corpus root. Values are never loaded.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// Case/underscore-insensitive column lookup, so small schema drifts don't break loading.
function col(row, ...names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const want = n.toLowerCase().replace(/[_\s]/g, "");
    const k = keys.find((k) => k.toLowerCase().replace(/[_\s]/g, "") === want);
    if (k !== undefined && row[k] !== "") return row[k];
  }
  return undefined;
}

function truthy(v) {
  return /^(t|true|1|yes)$/i.test(String(v).trim());
}

/** Our own format: one JSON object per line — {"file","line","endLine"?,"truth","type"?}. */
export function loadJsonl(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const o = JSON.parse(l);
      return {
        file: o.file,
        line: Number(o.line),
        endLine: Number(o.endLine ?? o.line),
        truth: o.truth === true,
        type: o.type ?? "unknown",
      };
    });
}

/**
 * Samsung CredData: a meta/ directory of CSVs. GroundTruth is T (real), F (false),
 * or X (template/example — scored as not-a-secret). Handles both the combined
 * "LineStart:LineEnd" column and separate LineStart / LineEnd columns.
 * FilePath is relative to the CredData root, so point --corpus at that root.
 */
export function loadCredData(metaDir) {
  const files = statSync(metaDir).isDirectory()
    ? readdirSync(metaDir).filter((f) => f.endsWith(".csv")).map((f) => join(metaDir, f))
    : [metaDir];
  const out = [];
  for (const f of files) {
    for (const r of parseCsv(readFileSync(f, "utf8"))) {
      const file = col(r, "FilePath");
      const combined = col(r, "LineStart:LineEnd");
      let start, end;
      if (combined) [start, end] = combined.split(":").map(Number);
      else { start = Number(col(r, "LineStart")); end = Number(col(r, "LineEnd") ?? start); }
      if (!file || !Number.isFinite(start)) continue;
      out.push({
        file,
        line: start,
        endLine: Number.isFinite(end) ? end : start,
        truth: String(col(r, "GroundTruth") ?? "").trim().toUpperCase() === "T",
        type: col(r, "Category") ?? "unknown",
      });
    }
  }
  return out;
}

/**
 * SecretBench (CSV exported from its BigQuery table). Files are expected at
 * <corpus>/<repo_name>/<file_path>, i.e. clone each repo into corpus/owner/repo.
 * Note: SecretBench mined every commit; a working-tree scan can only find
 * secrets that still exist at the checked-out revision (see --drop-missing).
 */
export function loadSecretBench(csvPath) {
  return parseCsv(readFileSync(csvPath, "utf8"))
    .map((r) => {
      const repo = col(r, "repo_name", "repository", "repo");
      const path = col(r, "file_path", "filepath", "path");
      const start = Number(col(r, "start_line", "line_start", "line"));
      const end = Number(col(r, "end_line", "line_end") ?? start);
      if (!path || !Number.isFinite(start)) return null;
      return {
        file: repo ? `${repo}/${path}` : path,
        line: start,
        endLine: Number.isFinite(end) ? end : start,
        truth: truthy(col(r, "label", "is_secret", "ground_truth") ?? ""),
        type: col(r, "category", "secret_type", "type") ?? "unknown",
      };
    })
    .filter(Boolean);
}

export function loadLabels(path, format) {
  switch (format) {
    case "jsonl": return loadJsonl(path);
    case "creddata": return loadCredData(path);
    case "secretbench": return loadSecretBench(path);
    default: throw new Error(`unknown --labels-format "${format}" (jsonl | creddata | secretbench)`);
  }
}

/** Drop labels whose file isn't in the corpus (e.g. secrets only in git history). */
export function keepPresent(labels, corpus) {
  const kept = labels.filter((l) => existsSync(join(corpus, l.file)));
  return { kept, dropped: labels.length - kept.length };
}
