export type Severity = "error" | "warning" | "info";
export type Category = "secret" | "trap" | "integrity" | "mcp";

/** A normalized finding emitted by `vet`, independent of the core's internal shapes. */
export interface VetFinding {
  file: string;
  line?: number;
  rule: string;
  severity: Severity;
  category: Category;
  message: string;
  suggestion?: string;
}

export interface ScanSummary {
  filesScanned: number;
  findings: VetFinding[];
  /** Files skipped by .vetignore (surfaced for transparency — never silently dropped). */
  filesIgnored?: number;
}
