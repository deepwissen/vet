import { describe, it, expect } from "vitest";
import { scanFile } from "../src/scan.js";

// Integration: vet surfaces the preflight-core AI-ignore coverage audit.
describe("vet — AI-ignore coverage", () => {
  it("flags a bare-.env gap in a .cursorignore as [integrity]", () => {
    const f = scanFile(".cursorignore", "**/.env.*\n**/secret/**\n");
    const envGap = f.find((x) => x.rule === "ignore-coverage-gap" && /bare \.env/.test(x.message));
    expect(envGap).toBeDefined();
    expect(envGap?.category).toBe("integrity");
    expect(envGap?.severity).toBe("warning");
    expect(envGap?.suggestion).toContain("**/.env");
  });

  it("does not flag a .gitignore or a complete .cursorignore", () => {
    expect(scanFile(".gitignore", "**/.env.*\n")).toHaveLength(0);
    const complete = scanFile(
      ".cursorignore",
      ".env\n**/*.env\n**/id_rsa*\n**/*.pem\n**/*.key\n**/*credential*\n**/.npmrc\n"
    );
    expect(complete.filter((x) => x.rule === "ignore-coverage-gap")).toHaveLength(0);
  });

  it("does not flag an intent-less ignore file (only build/dep dirs)", () => {
    expect(scanFile(".cursorignore", "node_modules/\ndist/\n")).toHaveLength(0);
  });
});
