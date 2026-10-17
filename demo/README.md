# Recording the `vet` demo GIF

The GIF is generated from a script — no manual screen-recording — so it's clean
and reproducible.

## With VHS (recommended)

[VHS](https://github.com/charmbracelet/vhs) turns `demo.tape` into `vet-demo.gif`.

```bash
# 1. install VHS (macOS)
brew install vhs            # or: go install github.com/charmbracelet/vhs@latest

# 2. install vet + build the demo repo
npm i -g @deepwissen/vet@0.1.4
sh demo/setup-demo.sh       # creates ./vet-demo with planted findings
cd vet-demo

# 3. record (writes vet-demo.gif)
vhs ../demo/demo.tape
```

The tape runs five beats (~25s): `--version` → `vet .` (catches a secret, an
over-permissioned agent config, and a trap file) → `--fail-on error` gate →
`--sarif` for CI → a clean file passing.

## Without VHS — asciinema → GIF

```bash
npm i -g @deepwissen/vet@0.1.4
sh demo/setup-demo.sh && cd vet-demo

asciinema rec vet.cast      # then type the commands from demo.tape, Ctrl-D to stop
agg vet.cast vet-demo.gif   # https://github.com/asciinema/agg
```

## The command sequence (if you'd rather record by hand)

```bash
vet --version
vet .                                   # 3 findings — secret + agent + trap, exit 1
vet . --fail-on error; echo "exit: $?"  # gate: exit 1 on real exposures
vet . --sarif > vet.sarif; echo "-> vet.sarif ready"
vet src/safe.ts                         # ✓ clean file passes
```

Tweak theme/size/speed at the top of `demo.tape` (`Set Theme`, `Set FontSize`,
`Set TypingSpeed`). Drop the finished `vet-demo.gif` at the top of the repo
README for the 10-second "what is this" shot.
