import { describe, it, expect } from "vitest";
import { scanFile } from "../src/scan.js";

// Integration: vet surfaces the preflight-core agent-autonomy scanner under the
// new "agent" category (OWASP LLM06 — excessive agency).
describe("vet — agent-autonomy findings", () => {
  it("flags a Claude broad command allow as category 'agent'", () => {
    const f = scanFile(".claude/settings.json", `{ "permissions": { "allow": ["Bash(*)"] } }`);
    const hit = f.find((x) => x.rule === "agent-broad-command-allow");
    expect(hit).toBeDefined();
    expect(hit?.category).toBe("agent");
    expect(hit?.severity).toBe("error");
  });

  it("flags --dangerously-skip-permissions wired into package.json scripts", () => {
    const f = scanFile("package.json", `{ "scripts": { "ai": "claude --dangerously-skip-permissions" } }`);
    const rules = f.map((x) => x.rule);
    expect(rules).toContain("agent-skip-permissions");
    expect(f.find((x) => x.rule === "agent-skip-permissions")?.category).toBe("agent");
  });

  it("flags MCP alwaysAllow ['*'] under the mcp category", () => {
    const f = scanFile(".mcp.json", `{ "mcpServers": { "x": { "alwaysAllow": ["*"] } } }`);
    const hit = f.find((x) => x.rule === "mcp-always-allow");
    expect(hit?.category).toBe("mcp");
    expect(hit?.severity).toBe("error");
  });

  it("does NOT flag scoped allow entries (false-positive guard)", () => {
    const f = scanFile(
      ".claude/settings.json",
      `{ "permissions": { "allow": ["Read(*)", "Bash(git status)"] } }`
    );
    expect(f.find((x) => x.rule === "agent-broad-command-allow")).toBeUndefined();
  });
});
