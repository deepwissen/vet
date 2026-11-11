// node --test bench/test
import { test } from "node:test";
import assert from "node:assert/strict";
import { score, headToHead } from "../lib/score.mjs";
import { parseCsv, loadCredData } from "../lib/labels.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const L = (file, line, truth, type = "t", endLine = line) => ({ file, line, endLine, truth, type });
const F = (file, line, rule = "r", category = "secret") => ({ file, line, rule, category });

test("TP / FP / unlabeled / FN are counted correctly", () => {
  const labels = [L("a", 1, true), L("a", 3, false), L("b", 5, true)];
  const s = score([F("a", 1), F("a", 3), F("c", 9)], labels);
  assert.equal(s.tp, 1);
  assert.equal(s.fp, 1);
  assert.equal(s.unlabeled, 1);
  assert.equal(s.missed, 1);
  assert.equal(s.precision, 0.5);
  assert.equal(s.strictPrecision, 1 / 3);
  assert.equal(s.recall, 0.5);
});

test("duplicate findings on one line count once; non-secret categories are ignored", () => {
  const s = score([F("a", 1, "x"), F("a", 1, "y"), F("a", 2, "mcp", "mcp")], [L("a", 1, true)]);
  assert.equal(s.findings, 1);
  assert.equal(s.tp, 1);
});

test("multi-line labels match anywhere in range; tolerance widens it", () => {
  const labels = [L("k", 10, true, "private-key", 20)];
  assert.equal(score([F("k", 15)], labels).recall, 1);
  assert.equal(score([F("k", 21)], labels).recall, 0);
  assert.equal(score([F("k", 21)], labels, { tolerance: 1 }).recall, 1);
});

test("head to head splits real secrets by which tool found them", () => {
  const labels = [L("a", 1, true), L("a", 2, true), L("a", 3, true), L("a", 4, true)];
  const A = score([F("a", 1), F("a", 2)], labels);
  const B = score([F("a", 2), F("a", 3)], labels);
  const h = headToHead(A, B, labels);
  assert.deepEqual([h.both, h.onlyA, h.onlyB, h.neither], [1, 1, 1, 1]);
});

test("CSV parser handles quotes, commas and CRLF", () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n');
  assert.deepEqual(rows, [{ a: "x, y", b: 'he said "hi"' }]);
});

test("CredData loader reads both line-column styles; X counts as not-a-secret", () => {
  const dir = mkdtempSync(join(tmpdir(), "cd-"));
  writeFileSync(join(dir, "r1.csv"), "Id,FilePath,LineStart:LineEnd,GroundTruth,Category\n1,data/x/a.py,3:3,T,Token\n2,data/x/a.py,7:9,X,Key\n");
  writeFileSync(join(dir, "r2.csv"), "Id,FilePath,LineStart,LineEnd,GroundTruth,Category\n3,data/y/b.go,4,4,F,Password\n");
  const labels = loadCredData(dir).sort((a, b) => a.line - b.line);
  assert.deepEqual(labels.map((l) => [l.file, l.line, l.endLine, l.truth]), [
    ["data/x/a.py", 3, 3, true],
    ["data/y/b.go", 4, 4, false],
    ["data/x/a.py", 7, 9, false],
  ]);
});
