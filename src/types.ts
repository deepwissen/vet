export type Severity = "error" | "warning" | "info";
export type Category = "secret" | "trap" | "integrity" | "mcp" | "agent";

/** A normalized finding emitted by `vet`, independent of the core's internal shapes. */
export interface VetFinding {
  file: string;
  line?: number;
  rule: string;
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
  /** Short commit SHA that introduced this (history scans only). */
  commit?: string;
}

export interface ScanSummary {
  filesScanned: number;
  findings: VetFinding[];
  /** Files skipped by .vetignore (surfaced for transparency — never silently dropped). */
  filesIgnored?: number;
  /** Findings suppressed by inline vet:allow directives (surfaced, never silent). */
  findingsSuppressed?: number;
  /** Files too large to scan (>1 MB) — surfaced so an unscanned file never reads as "clean". */
  filesSkippedLarge?: number;
  /** --history: number of commits scanned (replaces the file count in the report). */
  commitsScanned?: number;
  /** --history: true when history exceeded the commit cap and was truncated. */
  historyTruncated?: boolean;
}
