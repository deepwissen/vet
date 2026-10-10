// File-type helpers for routing a file to the right analyzer slots.

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".json": "json",
  ".jsonc": "jsonc",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".properties": "properties",
  ".env": "dotenv",
  ".sh": "shellscript",
  ".md": "markdown",
};

export function langFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  if (base === ".npmrc" || base === ".netrc") return "properties";
  if (/^\.env(\.|$)/.test(base)) return "dotenv";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  return EXT_LANG[base.slice(dot).toLowerCase()] ?? "plaintext";
}

/** Instruction files an AI tool ingests as guidance (integrity scanner targets these). */
export function isInstructionFile(path: string): boolean {
  const p = path.toLowerCase();
  return (
    /(^|\/)(claude\.md|gemini\.md|agents\.md|\.cursorrules|\.windsurfrules)$/.test(p) ||
    /(^|\/)\.cursor\/rules(\/|$)/.test(p) ||
    /(^|\/)\.github\/copilot-instructions\.md$/.test(p) ||
    /(^|\/)\.junie\/guidelines(\.md)?$/.test(p) ||
    /(^|\/)\.amazonq\/rules(\/|$)/.test(p)
  );
}

/** MCP config files (scanner also matches any JSON containing mcpServers). */
export function isMcpConfig(path: string, content: string): boolean {
  const base = (path.split("/").pop() ?? path).toLowerCase();
  if (/(^|\/)(\.mcp\.json|mcp\.json|claude_desktop_config\.json)$/.test(path.toLowerCase())) {
    return true;
  }
  if (
    base.endsWith(".json") &&
    (content.includes('"mcpServers"') || content.includes('"servers"'))
  ) {
    return true;
  }
  return false;
}

const BINARY_EXTS =
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|tgz|woff2?|ttf|eot|mp[34]|mov|wasm|so|dylib|dll|exe|class|jar|bin|parquet|h5|hdf5|pkl|pt|pth|npy|npz)$/i;

export function looksBinary(path: string): boolean {
  return BINARY_EXTS.test(path);
}
