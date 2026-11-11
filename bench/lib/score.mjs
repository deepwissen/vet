// Scoring. Recall is counted per labeled secret; precision per reported finding.
//
//   finding → TP        if it lands on a line range labeled as a real secret
//   finding → FP        if it lands only on lines labeled "not a secret"
//   finding → unlabeled if it lands on no labeled line at all
//
// Precision ignores unlabeled findings; "strict precision" counts them as false.
// Which number is fair depends on the dataset: SecretBench and CredData only label
// candidates their own regexes found, so a tool can be right about an unlabeled
// line. On the generated sample corpus everything is labeled, so both agree.

export function dedupe(findings) {
  const seen = new Map();
  for (const f of findings) {
    const k = `${f.file}:${f.line}`;
    if (!seen.has(k)) seen.set(k, f);
  }
  return [...seen.values()];
}

function indexByFile(labels) {
  const m = new Map();
  for (const l of labels) {
    if (!m.has(l.file)) m.set(l.file, []);
    m.get(l.file).push(l);
  }
  return m;
}

function hits(finding, label, tol) {
  return (
    finding.file === label.file &&
    finding.line != null &&
    finding.line >= label.line - tol &&
    finding.line <= label.endLine + tol
  );
}

const ratio = (a, b) => (b === 0 ? null : a / b);
const f1 = (p, r) => (p == null || r == null || p + r === 0 ? null : (2 * p * r) / (p + r));

export function score(rawFindings, labels, { tolerance = 0, maxExamples = 25 } = {}) {
  const findings = dedupe(rawFindings.filter((f) => f.category === "secret"));
  const byFile = indexByFile(labels);
  const trueLabels = labels.filter((l) => l.truth);
  const hitLabels = new Set();

  const fpByRule = {};
  const tpByRule = {};
  const fpExamples = [];
  let tp = 0, fp = 0, unlabeled = 0;

  for (const f of findings) {
    const candidates = (byFile.get(f.file) ?? []).filter((l) => hits(f, l, tolerance));
    const trueHit = candidates.filter((l) => l.truth);
    trueHit.forEach((l) => hitLabels.add(l));
    if (trueHit.length) {
      tp++;
      tpByRule[f.rule] = (tpByRule[f.rule] ?? 0) + 1;
    } else if (candidates.length) {
      fp++;
      fpByRule[f.rule] = (fpByRule[f.rule] ?? 0) + 1;
      if (fpExamples.length < maxExamples) fpExamples.push(`${f.file}:${f.line} (${f.rule})`);
    } else {
      unlabeled++;
    }
  }

  // Recall per secret type.
  const byType = {};
  for (const l of trueLabels) {
    const t = (byType[l.type] ??= { total: 0, found: 0 });
    t.total++;
    if (hitLabels.has(l)) t.found++;
  }
  for (const t of Object.values(byType)) t.recall = ratio(t.found, t.total);

  const missed = trueLabels.filter((l) => !hitLabels.has(l));
  const precision = ratio(tp, tp + fp);
  const recall = ratio(hitLabels.size, trueLabels.length);

  return {
    findings: findings.length,
    tp, fp, unlabeled,
    trueSecrets: trueLabels.length,
    found: hitLabels.size,
    missed: missed.length,
    precision,
    strictPrecision: ratio(tp, findings.length),
    recall,
    f1: f1(precision, recall),
    byType,
    fpByRule,
    tpByRule,
    fpExamples,
    fnExamples: missed.slice(0, maxExamples).map((l) => `${l.file}:${l.line} (${l.type})`),
    _hitLabels: hitLabels,
  };
}

/** Which real secrets each tool found that the other didn't. */
export function headToHead(a, b, labels) {
  const out = { both: 0, onlyA: 0, onlyB: 0, neither: 0, onlyAExamples: [], onlyBExamples: [] };
  for (const l of labels.filter((x) => x.truth)) {
    const inA = a._hitLabels.has(l), inB = b._hitLabels.has(l);
    const where = `${l.file}:${l.line} (${l.type})`;
    if (inA && inB) out.both++;
    else if (inA) { out.onlyA++; if (out.onlyAExamples.length < 25) out.onlyAExamples.push(where); }
    else if (inB) { out.onlyB++; if (out.onlyBExamples.length < 25) out.onlyBExamples.push(where); }
    else out.neither++;
  }
  return out;
}
