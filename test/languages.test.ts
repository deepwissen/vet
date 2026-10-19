import { describe, it, expect } from "vitest";
import { langFromPath, isInstructionFile, isMcpConfig, looksBinary } from "../src/languages.js";

describe("langFromPath", () => {
  it("maps common extensions", () => {
    expect(langFromPath("src/a.py")).toBe("python");
    expect(langFromPath("src/a.ts")).toBe("typescript");
    expect(langFromPath("cfg.json")).toBe("json");
    expect(langFromPath("c.yaml")).toBe("yaml");
  });
  it("handles dotfiles and env files", () => {
    expect(langFromPath(".npmrc")).toBe("properties");
    expect(langFromPath(".env")).toBe("dotenv");
    expect(langFromPath(".env.local")).toBe("dotenv");
  });
  it("maps C/C++ and other compiled-lang extensions (not plaintext)", () => {
    expect(langFromPath("parser.cpp")).toBe("cpp");
    expect(langFromPath("gram.hpp")).toBe("cpp");
    expect(langFromPath("scan.l")).toBe("cpp");
    expect(langFromPath("re2.cc")).toBe("cpp");
    expect(langFromPath("main.c")).toBe("c");
    expect(langFromPath("App.cs")).toBe("csharp");
    expect(langFromPath("q.sql")).toBe("sql");
  });
  it("falls back to plaintext", () => {
    expect(langFromPath("LICENSE")).toBe("plaintext");
    expect(langFromPath("weird.xyz")).toBe("plaintext");
  });
});

describe("isInstructionFile", () => {
  it("recognizes known instruction files", () => {
    expect(isInstructionFile("CLAUDE.md")).toBe(true);
    expect(isInstructionFile("repo/.cursorrules")).toBe(true);
    expect(isInstructionFile(".github/copilot-instructions.md")).toBe(true);
    expect(isInstructionFile("AGENTS.md")).toBe(true);
  });
  it("rejects ordinary files", () => {
    expect(isInstructionFile("src/app.ts")).toBe(false);
    expect(isInstructionFile("README.md")).toBe(false);
  });
});

describe("isMcpConfig", () => {
  it("matches known MCP config names", () => {
    expect(isMcpConfig(".mcp.json", "{}")).toBe(true);
    expect(isMcpConfig(".vscode/mcp.json", "{}")).toBe(true);
    expect(isMcpConfig("claude_desktop_config.json", "{}")).toBe(true);
  });
  it("matches any JSON that declares servers", () => {
    expect(isMcpConfig("whatever.json", '{ "mcpServers": {} }')).toBe(true);
    expect(isMcpConfig("plain.json", '{ "name": "x" }')).toBe(false);
  });
  it("rejects non-JSON", () => {
    expect(isMcpConfig("app.ts", '"mcpServers"')).toBe(false);
  });
});

describe("looksBinary", () => {
  it("flags binary extensions (incl. ML artifacts)", () => {
    expect(looksBinary("model.pkl")).toBe(true);
    expect(looksBinary("weights.pt")).toBe(true);
    expect(looksBinary("data.h5")).toBe(true);
    expect(looksBinary("img.png")).toBe(true);
  });
  it("passes text files through", () => {
    expect(looksBinary("src/a.ts")).toBe(false);
    expect(looksBinary("config.yaml")).toBe(false);
  });
});
