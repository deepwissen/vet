#!/usr/bin/env node
import { run } from "./cli.js";

// Set exitCode instead of calling process.exit(): process.exit() tears the
// process down immediately and can truncate buffered stdout when output is piped
// (e.g. `vet --json | jq` only received the first ~64 KB). Setting exitCode lets
// the event loop drain — stdout flushes fully — then exits with the right code.
process.exitCode = run(process.argv.slice(2));
