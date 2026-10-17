# vet demo — record with:  vhs demo/demo.tape   (https://github.com/charmbracelet/vhs)
# Prereqs:  npm i -g @deepwissen/vet@0.1.4  &&  sh demo/setup-demo.sh  &&  cd vet-demo
# Produces vet-demo.gif.

Output vet-demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1140
Set Height 720
Set Padding 20
Set Theme "Dracula"
Set TypingSpeed 45ms

# ── 1. it's installed ───────────────────────────────────────────
Type "vet --version" Sleep 400ms Enter
Sleep 1.2s

# ── 2. the catch: one scan, three classes of risk ──────────────
Type "# scan the repo — secrets, trap files, and over-permissioned agent configs" Enter
Type "vet ." Sleep 400ms Enter
Sleep 4s

# ── 3. the gate: fail the build on real exposures ──────────────
Type "# gate a PR: non-zero exit on real exposures" Enter
Type 'vet . --fail-on error; echo "exit: $?"' Sleep 400ms Enter
Sleep 2.5s

# ── 4. CI-ready machine output ─────────────────────────────────
# (SARIF is written regardless of findings, so use ';' not '&&' — the gate exits non-zero)
Type "# SARIF for GitHub code-scanning annotations" Enter
Type "vet . --sarif > vet.sarif; echo '-> vet.sarif ready'" Sleep 400ms Enter
Sleep 2s

# ── 5. the all-clear ───────────────────────────────────────────
Type "# a clean file passes" Enter
Type "vet src/safe.ts" Sleep 400ms Enter
Sleep 2.5s
