# Proof and inspection execution

[AGENTS.md](../../AGENTS.md) owns acceptance. Use the supported runtime in
[REARCHITECTURE.md](REARCHITECTURE.md#runtime-and-future-work-notes). Run the
four-command repository gate after an authorized material packet is ready;
repair only within that packet and restart the entire gate before corpus
measurement. An out-of-scope repair requires a scope decision. Release checks
are a separate workflow, not an additional packet gate.

## Focused proofs

`npm test` retains the complete, ordered, sequential module list.
`npm test -- --family operations` (also `npm run test:operations`) selects the
operational proofs in that same order. Other families are `transformer`,
`analyzer`, `rules` and `standard`. Some integration proofs belong to more than
one family. Invalid selections fail before importing any suite. Imports remain
sequential because tests instrument shared compiler/analyzer state.

Fixtures (`npm run fixtures:check`), packed consumer checks
(`npm run consumer:check`) and benchmarks (`npm run benchmark`) remain separate
entry points. The benchmark's JSON and inspector's four-space JSON schemas are
unchanged. The inspector keeps ordered extension probing and live breadth-first
import traversal. It owns one sequential parser session per workspace; direct
`captureProgram` calls retain independent sessions for concurrent callers.

`npm run proof:catalogs` checks current publication routes and all recorded
emitter calls/string expressions. `-- --write` refreshes the derived decision
catalog from executable publication probes and parsed source locations.
The catalog links current owners and proofs; it is not admission evidence or
exception authority. The source exception auditor and transformer boundary
crosswalk remain part of `npm test`.

## Corpus stages and recovery

After the gate, run the existing pinned, unchanged fp-ts checkout:

```sh
node scripts/check-fp-ts-corpus.js /path/to/fp-ts
```

The positional invocation and final `summary.json` schema remain supported.
For a comparison of two transformer snapshots, pass `--transformer-module`
and `--helper-root` explicitly. Both fresh emissions must use the same verified
helper-module paths and hashes; preserve the literal imports in generated code
for strict token comparison. Node support and actual Rollup loading/esbuild
execution are checked before creating an artifact. Fix a host architecture
problem with matching native dependencies or an isolated overlay; do not erase
shared dependencies or change the corpus. Runtime, upstream, transformer,
helper, authored implementation, and original source/test identities are
recorded in `stages.json`. The journal is atomically replaced after each
transition.

| Stage | Durable evidence and ownership |
| --- | --- |
| Setup | Original-source mirror, unchanged tests, runtime configuration, and helper bindings |
| Each `emit-*` file | Lower into a private attempt, immediately lint unchanged emitted bytes with a reusable nonfixing ESLint instance, and hash the output and observation |
| Raw publication and report | Publish the complete immutable `raw-js` tree, then measure every file again in completed-module context; retain immediate observations separately |
| Each `fix-*` file | Run the separate native-fix comparison from the complete raw tree with a reusable fixing ESLint instance; keep output in a private attempt |
| Fixed publication and report | Publish complete `generated/js`, then read-only lint every fixed file in completed-module context; raw bytes remain unchanged |
| Inspection and three runtimes | Save triage/boundary reports, source runtime, fixed runtime, and a byte-verified raw runtime copy with test/coverage results |
| Summary | Combine the completed lint and runtime results |

For the 123-source fp-ts checkout, this is 123 `emit-*` and 123 `fix-*`
file stages plus 10 shared stages: **256 durable journal stages**. A stage is
a recovery checkpoint, not an ESLint process or a full-corpus pass. The two
ESLint instances are reused in process. Contract-analysis caches are cleared
after completed raw measurement, fixed publication, and fixed measurement to
release the prior phase's active tree. Runtime Vite/Vitest cache directories
belong to each fresh artifact mirror rather than the shared dependency symlink.

For a deliberate checkpoint after raw generation and completed raw lint:

```sh
node scripts/check-fp-ts-corpus.js /path/to/fp-ts --stop-after-generation
node scripts/check-fp-ts-corpus.js --resume /path/to/artifact
node scripts/check-fp-ts-corpus.js --verify /path/to/artifact
```

Resume verifies completed outputs and inputs before reuse. It rejects a
different Node/platform/architecture, implementation, helper binding, or
source/test input. It retries only unfinished stages and prints each retry.
An interrupted setup requires a new artifact; interrupted per-file emission or
fix attempts remain preserved and retry in new private directories. Completed
file stages are verified and reused. Journal history retains failed/interrupted
attempts and subprocess status/signal. Failed runtime reports are copied into
`failed-runtime-*` before propagation. A completed source runtime is not
repeated when only lowered runtime remains.

`--verify` hashes saved evidence without launching generation, lint or runtime
and without changing the journal. Valid but incomplete artifacts
are reported and return a nonzero status. Verification needs the recorded input
and output paths to remain available. It proves saved evidence integrity, not a
new runtime result. Artifacts predating Packet 6 have no stage journal: retain
their existing manifests and separately recorded comparisons rather than
fabricating completed stages. Do not run concurrent writers on one artifact.

The command's completion is not lint acceptance: the runner records findings
without asserting the packet's thresholds. `--verify` checks declared hashes
and completion, not the packet's token, diagnostic-target, or no-regression
criteria. Inspect full reports, file/test sets, and expected stages
independently. The normal lowered runtime runs fixed `generated/js`; the
separate raw runtime consumes a verified copy of immutable `raw-js`. Follow
the recovery plan's
[evidence checklist](LOWERING_RECOVERY_PLAN_2026-10-05.md#acceptance-evidence-checklist).

Old journals reference absolute input paths. If those checkouts changed, do not
overwrite newer work or edit a journal to force historical `--verify` to pass.
Validate the historical comparison bytes against their saved manifests and
frozen source bundle, and state which checks remain unavailable. Archived
measurement wrappers may hard-code live imports and overwrite their own bundle;
inspect and rebind approved copies to a fresh output root before any new run.

Only pipeline stages write generated code. Inspection, acceptance comparison
and the verifier are read-only. Fix authored implementation and proofs when an
artifact exposes a counterexample; neither suppressions nor generated edits
can repair acceptance.

## Proof coverage and maintenance

Use the smallest representative positive, guarded, rejection and semantic cases
for the changed obligation. A new case identifies its source shape, expected
finding or non-finding, known/unknown/contradictory state, failure owner, repair
path and verification command.

| Proof surface | What it establishes |
| --- | --- |
| RuleTester suites | Valid/invalid syntax, diagnostic locations, options, fixes and suggestions |
| `tests/fixtures/bad.js` and `manifest.json` | One labeled RED region for every public rule; `fixtures:check` verifies actual findings |
| Integration fixtures | Cross-file agreement, native/external boundaries, guarded behavior and unresolved/unknown inputs |
| Analyzer suites | API result/evidence identity, deterministic ordering, graph activation/invalidation, caches and ESLint parity |
| Transformer suites | Checker facts, finite decisions, placement, raw/fixed lint and source/lowered observables |
| Operational suites | Stage recovery, parser sessions, traversal, package/fixture contracts and catalog integrity |
| Adoption tasks | Diagnosis and behavior-preserving repairs using rule pages, standards and the migration guide |

Keep `bad.js` intentionally invalid. Copy an isolated labeled case for adoption
work; never repair the shared RED fixture in place. Retain a new regression
when it exposes a repeatable diagnostic, semantic or workflow failure. The
[agent evaluation protocol](agent-learning-evaluation.md) records context,
resulting diffs and measures for adoption experiments. The
[historical corpus design](https://github.com/augurone/artikulates-resilient/blob/d34d388387304d17a6e2b3f9751272e300b14b9b/docs/archive/engineering/diagnostic-corpus.md)
preserves the original classification.

## Package contents

`package.json` explicitly includes runtime code, the inspector, README/license/
changelog, and the public documentation directories. This includes
`docs/reference/research.md` and `docs/reference/research-links.md`; both are
therefore shipped in the current tarball. Engineering records, archived
evidence and drafts remain repository-only. Removing either research document
from the package is a separate distribution decision.

After changing the package allowlist, inspect `npm pack --dry-run --json` and
run `npm run consumer:check` after the full repository gate. The consumer check
installs a real tarball in isolation and exercises the exported contract API,
recommended lint configuration and shipped inspector. Package cleanup does not
by itself require regeneration of an unchanged transformer corpus.
