import {
  scanSecrets,
  detectTraps,
  scanInstructionIntegrity,
  scanMcpConfigs,
  scanAgentConfig,
  type ContextSnapshot,
  type FileInfo,
  type InstructionFileIssue,
} from "@deepwissen/preflight-core";
import { langFromPath, isInstructionFile, isMcpConfig } from "./languages.js";
import type { Severity, VetFinding } from "./types.js";

function emptySnapshot(): ContextSnapshot {
  return {
    timestamp: 0,
    activeFile: null,
    selection: null,
    openTabs: [],
    aiInstructionFiles: [],
    mcpConfigFiles: [],
    toolProfile: null,
    ignoreFiles: [],
    referencedFiles: [],
    terminalContent: null,
    clipboardSize: null,
    chatHistoryLength: 0,
  };
}

function fileInfo(path: string, content: string): FileInfo {
  return {
    path,
    languageId: langFromPath(path),
    lineCount: content.split("\n").length,
    charCount: content.length,
    isActive: true,
    isDirty: false,
    commentLineCount: 0,
    hasConflictMarkers: false,
    content,
  };
}

// Trap/MCP descriptions embed "… line N"; recover it for precise reporting.
function lineFromText(text: string): number | undefined {
  const m = text.match(/\bline (\d+)\b/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Run every content-security analyzer over a single file by placing it in the
 * ContextSnapshot slot each analyzer reads from, then normalize the outputs.
 */
export function scanFile(path: string, content: string): VetFinding[] {
  const findings: VetFinding[] = [];
  const snap = emptySnapshot();
  const lineCount = content.split("\n").length;

  snap.activeFile = fileInfo(path, content); // → secret-scanner, trap-scanner, mcp active-file check
  if (isInstructionFile(path)) {
    snap.aiInstructionFiles = [{ path, lineCount, toolId: null, content }]; // → integrity-scanner
  }
  if (isMcpConfig(path, content)) {
    snap.mcpConfigFiles = [{ path, content }]; // → mcp-scanner
  }

  // 1. Secrets
  for (const f of scanSecrets(snap, {}).secretFindings ?? []) {
    findings.push({
      file: path,
      line: f.lineNumber,
      rule: f.ruleId,
      severity: f.severity,
      category: "secret",
      message:
        f.lifetime === "long-lived" ? `${f.description} (long-lived credential)` : f.description,
      suggestion: f.suggestion,
    });
  }

  // 2. Traps (detectTraps emits only trap-* waste patterns)
  for (const w of detectTraps(snap, {}).wastePatterns ?? []) {
    findings.push({
      file: path,
      line: lineFromText(w.description),
      rule: w.ruleId,
      severity: w.severity === "warning" ? "warning" : "info",
      category: "trap",
      message: w.description,
      suggestion: w.suggestion,
    });
  }

  // 3 + 4 + 5. Integrity, MCP, and agent-autonomy (all surface via instructionFileIssues)
  const issues: InstructionFileIssue[] = [
    ...(scanInstructionIntegrity(snap, {}).instructionFileIssues ?? []),
    ...(scanMcpConfigs(snap, {}).instructionFileIssues ?? []),
    ...(scanAgentConfig(snap, {}).instructionFileIssues ?? []),
  ];
  for (const i of issues) {
    findings.push({
      file: path,
      line: i.lineNumber,
      rule: i.issue,
      severity: (i.severity ?? "warning") as Severity,
      category: i.issue.startsWith("agent-")
        ? "agent"
        : i.issue.startsWith("mcp-")
          ? "mcp"
          : "integrity",
      message: i.description,
      suggestion: i.suggestion,
    });
  }

  return findings;
}
