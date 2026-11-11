// Renders results as JSON (for diffing runs), Markdown (for PRs/READMEs) and a small HTML page.

const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function strip(r) {
  const { _hitLabels, ...rest } = r;
  return rest;
}

export function toJson(run) {
  return JSON.stringify(
    { ...run, tools: Object.fromEntries(Object.entries(run.tools).map(([k, v]) => [k, { ...v, score: strip(v.score) }])) },
    null,
    2
  );
}

function topEntries(obj, n = 10) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function toMarkdown(run) {
  const names = Object.keys(run.tools);
  const L = [];
  L.push(`# Secret detection benchmark — ${run.dataset}`, "");
  L.push(`Run ${run.date} · corpus \`${run.corpus}\` · ${run.labels.trueSecrets} real secrets, ${run.labels.decoys} labeled non-secrets` +
    (run.labels.dropped ? ` · ${run.labels.dropped} labels dropped (file not in corpus)` : "") +
    (run.scope ? ` · scoped to ${[run.scope.maxFileBytes ? `files ≤ ${run.scope.maxFileBytes.toLocaleString()} bytes` : "", run.scope.skipDirs.length ? `outside ${run.scope.skipDirs.join("/")}` : ""].filter(Boolean).join(", ")} (${run.labels.outOfScope} labels out of scope)` : "") +
    ` · line tolerance ±${run.tolerance}`, "");
  L.push(`| | ${names.join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
  const row = (label, fn) => L.push(`| ${label} | ${names.map((n) => fn(run.tools[n])).join(" | ")} |`);
  row("Version", (t) => `\`${t.version}\``);
  row("Recall", (t) => pct(t.score.recall));
  row("Precision", (t) => pct(t.score.precision));
  row("Precision (strict)", (t) => pct(t.score.strictPrecision));
  row("F1", (t) => pct(t.score.f1));
  row("Secrets found", (t) => `${t.score.found} / ${t.score.trueSecrets}`);
  row("False alarms (labeled)", (t) => t.score.fp);
  row("Unlabeled findings", (t) => t.score.unlabeled);
  row("Scan time", (t) => `${(t.ms / 1000).toFixed(2)} s`);
  L.push("");

  const types = [...new Set(names.flatMap((n) => Object.keys(run.tools[n].score.byType)))].sort();
  if (types.length) {
    L.push("## Recall by secret type", "", `| Type | Count | ${names.join(" | ")} |`, `|---|---|${names.map(() => "---").join("|")}|`);
    for (const t of types) {
      const total = run.tools[names[0]].score.byType[t]?.total ?? 0;
      L.push(`| ${t} | ${total} | ${names.map((n) => pct(run.tools[n].score.byType[t]?.recall)).join(" | ")} |`);
    }
    L.push("");
  }

  if (run.headToHead) {
    const h = run.headToHead;
    L.push("## Head to head", "",
      `Both found ${h.both} · only ${names[0]} ${h.onlyA} · only ${names[1]} ${h.onlyB} · neither ${h.neither}`, "");
  }

  for (const n of names) {
    const s = run.tools[n].score;
    L.push(`## ${n}: where to improve`, "");
    if (Object.keys(s.fpByRule).length) {
      L.push("False alarms by rule:", "");
      for (const [r, c] of topEntries(s.fpByRule)) L.push(`- \`${r}\` — ${c}`);
      L.push("");
    }
    if (s.fnExamples.length) {
      L.push(`Missed secrets (first ${s.fnExamples.length} of ${s.missed}):`, "");
      for (const e of s.fnExamples) L.push(`- ${e}`);
      L.push("");
    }
    if (s.fpExamples.length) {
      L.push(`False alarms (first ${s.fpExamples.length} of ${s.fp}):`, "");
      for (const e of s.fpExamples) L.push(`- ${e}`);
      L.push("");
    }
  }
  L.push("_Locations only — secret values are never read into or written by this report._");
  return L.join("\n");
}

export function toHtml(run) {
  const names = Object.keys(run.tools);
  const metric = (label, key) =>
    `<tr><th>${label}</th>${names.map((n) => `<td>${pct(run.tools[n].score[key])}</td>`).join("")}</tr>`;
  const bar = (label, key) => {
    const rows = names.map((n) => {
      const v = run.tools[n].score[key];
      return `<div class="b"><span class="n">${esc(n)}</span><span class="track"><span class="fill ${n === "vet" ? "a" : "c"}" style="width:${(v ?? 0) * 100}%"></span></span><span class="v">${pct(v)}</span></div>`;
    }).join("");
    return `<div class="card"><h3>${label}</h3>${rows}</div>`;
  };
  const md = toMarkdown(run);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>vet vs gitleaks — ${esc(run.dataset)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--mute:#78716c;--line:#e7e5e4;--a:#2563eb;--c:#a8a29e}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#f5f5f4;--mute:#a8a29e;--line:#44403c;--c:#78716c}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:40px 20px}
h1{font-size:26px;margin:0 0 4px}.sub{color:var(--mute);margin:0 0 28px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-bottom:28px}
.card{border:1px solid var(--line);border-radius:10px;padding:14px 16px}.card h3{margin:0 0 10px;font-size:14px;color:var(--mute);font-weight:600}
.b{display:grid;grid-template-columns:72px 1fr 56px;align-items:center;gap:8px;margin:6px 0}
.track{height:10px;background:var(--line);border-radius:5px;overflow:hidden}.fill{display:block;height:100%}
.fill.a{background:var(--a)}.fill.c{background:var(--c)}.v{text-align:right;font-variant-numeric:tabular-nums}
pre{white-space:pre-wrap;border:1px solid var(--line);border-radius:10px;padding:16px;font:13px/1.5 ui-monospace,monospace}
</style></head><body><main>
<h1>vet vs gitleaks</h1><p class="sub">${esc(run.dataset)} · ${esc(run.date)} · ${run.labels.trueSecrets} real secrets</p>
<div class="grid">${bar("Recall — real secrets found", "recall")}${bar("Precision — alerts that were real", "precision")}${bar("F1", "f1")}</div>
<pre>${esc(md)}</pre>
</main></body></html>`;
}
