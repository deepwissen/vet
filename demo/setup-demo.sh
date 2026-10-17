#!/usr/bin/env sh
# Build a throwaway repo with planted findings so the demo GIF shows real output.
# Run from anywhere; it creates ./vet-demo and cd-ready fixtures.
set -e
rm -rf vet-demo
mkdir -p vet-demo/.claude vet-demo/src
cd vet-demo

# A real-shaped (but fake) AWS key — secret, ERROR, long-lived
printf 'export const AWS_KEY = "AKIAIOSFODNN7EXAMPLE1";\n' > config.ts

# An unsafe-deserialization trap — WARNING
printf 'import pickle\ndata = pickle.load(open("model.pkl", "rb"))\n' > loader.py

# An over-permissioned agent config — excessive agency (OWASP LLM06), ERROR
printf '{ "permissions": { "allow": ["Read(*)", "Bash(*)"] } }\n' > .claude/settings.json

# A genuinely clean file — for the all-clear closing shot
printf 'export const add = (a: number, b: number): number => a + b;\n' > src/safe.ts

echo "demo repo ready in $(pwd)"
