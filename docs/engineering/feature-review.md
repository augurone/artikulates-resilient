# Predecessor feature review

This review compares the predecessor package (version 0.7.5, preserved in Git
history before the rearchitecture cutover) with the current consolidated package.
A preserved filename or utility is not sufficient evidence that its consumer
behavior remains connected.
The findings below describe implementation status on November 10, 2026; they do
not authorize restoring the retired analyzer or proof framework.

## Restored consumer paths

| Priority | Capability | Current boundary and next functional requirement |
| --- | --- | --- |
| Required | Configured extra analysis roots | The [ESLint module host](../../analysis/eslint/support/modules.js) activates explicit arrays/callbacks and [adapter-selected](../../integrations/project.js) ancestor/inferred roots through the current analyzer. Selected roots and their static closure share filename identities; findings remain owned by the linted Program. [Functional tests](../../tests/configured-roots.test.js) exercise actual incoming calls, ordering/deduplication, cycles, inactive controls, changes and failures. |

## Finding inspection and external test connection

| Consumer job | Predecessor capability and current boundary |
| --- | --- |
| Explain why a finding exists at a source location | Current `resilient-inspect` selects a file and unique text/offset, runs actual configured ESLint once, and reuses its parser/session. It reports selected findings/suppressions, current model facts and available producer locations, active files and explicit unknown boundaries. It does not restore graph IDs or invent a complete derivation. [Installed inspection](../../tests/installed/inspection.test.js) exercises aliases/barrels, roots, parser ownership, severity, suppression and operational failures. |
| Inspect a JavaScript file before project configuration | Explicit `--standalone` selects the current five-contract-rule profile and relative source closure without reading project configuration. Configured inspection keeps its parser/session contract; no automatic fallback or retired analyzer is introduced. |
| Measure consumer adoption and inventory exceptions | `resilient-measure` and `resilient-audit --inventory` share one configured lint and parsed-source inventory. Reports preserve active/suppressed findings, raw directives, audited boundaries, input/tool identities and selected configurations; complete reports do not fail merely because findings exist. [Installed measurement](../../tests/installed/measurement.test.js) covers actual configuration, suppression, nested selection, incomplete capture and read-only output. |
| Run a consuming project's existing tests against emitted JavaScript | Current `resilient-prove` connects explicit Node-test or consumer-installed Vitest jobs to reference/raw/fixed output. It compares actual cases, source load identities and authored helper bytes, rejects original/un-emitted source fallback, and reports observed coverage. It does not claim arbitrary shell-runner support or require every emitted module to be exercised. [Installed project tests](../../tests/installed/project-tests.test.js) exercise the actual job and false-success controls; external Vitest rehearsals remain disposable artifacts. |

[Project test configuration](typescript.md#run-an-existing-test-suite-against-emitted-output)
and provider proof hooks now have an execution consumer. Resources and dependencies
remain in the existing project; mount settings reject explicitly. There are no
campaign journals, public verify/resume controls or corpus-specific runtime paths.

The contracts preset still sets `settings.resilient.evidenceMessages` without a
current rule consumer. This legacy toggle is not an inspection control. The
operation rule independently reports available imported-producer locations;
the explicit inspector uses current facts without depending on that setting.

## Direct TypeScript source linting: outside required scope

The user explicitly excludes direct TS/TSX ESLint support from the parity work.
The predecessor exported `configs.typescript({ parser, ... })` and
`createTypeScriptConfig`, but its located test only assembles configuration with
`parseForESLint: () => ({})`. That is not functional proof of typed source,
imports or TSX analysis. No working end-to-end project proof was found in this
review; the presence of a factory does not establish lost working functionality.

The frozen [Policy P-02](../reference/policy.md) retains that historical factory
description. It is not an instruction to add direct typed-source analysis now.
Current root AST acceptance does not establish typed project support:
[module loading](../../analysis/eslint/support/modules.js) excludes `.ts`/`.tsx`,
and [dependency parsing](../../analysis/analyzer/modules.js) uses Espree.

The direct-source ESLint route and compiler lowering must remain distinct in
support claims. The first consumes parser output; the second acquires compiler
requirements and emits JavaScript. Passing fp-ts's lowered variants does not
establish direct TS/TSX linting or framework compatibility.

## Release preparation: separate from functional parity

The predecessor had version `0.7.5`, public package metadata, a declared Node
range and packaged consumer documentation. The current [package](../../package.json)
restores public package metadata and ships README, CHANGELOG and LICENSE.
Detailed documentation is linked to the repository rather than duplicated in
the tarball. Node remains pinned to `22.13.0`; runtime-range changes remain a
separate compatibility decision.

The payload still includes experimental lowering by the user's explicit choice.
Lowering is experimental: use it at your own risk. Its presence does not add it
to the supported 0.7.6 feature set.

An API migration guide is new work caused by replacing `./contracts` and
`./project` with current agreement/analyzer and named root exports. The user has
not required old API compatibility. Restoring retired implementations is not a
parity requirement. Choose the intended public API and documentation delivery
when release preparation is in scope.

## Capabilities retained

| Capability | Current owner and acceptance |
| --- | --- |
| All 23 rule IDs and the four JavaScript presets | [Plugin registry](../../index.js), [rule inventory](../../config/rule-inventory.json), public product and canary tests. Mutation-ignore options remain available. |
| Object, array and function runtime helpers | [Standard helpers](../../analysis/host/); the public `standard/*` exports preserve their behavior. |
| Alias, extension and custom resolver configuration | [Project adapter](../../integrations/project.js), production configuration tests and actual imported-provider execution. Configured roots now join that same source closure. |
| Existing-project discovery and selection | [Project preparation](../../integrations/typescript-project.js): directory/exact config, ambiguity rejection, TypeScript inheritance, narrow roots and runtime dependency closure. |
| Provider and ESLint resolver integration | [Resolution](../../integrations/typescript-project-resolution.js), explicit isolated providers, transitive input identity, structural import rewriting and mismatch rejection. |
| ESM project lowering | [Project completion tests](../../tests/typescript-project-completion.test.js) execute native and emitted ESM and reject alternate module modes. Sources use `.ts`/`.tsx`, outputs use `.js`, and package scopes require `"type": "module"`. See [TypeScript lowering](typescript.md). |
| Raw/fixed artifacts, reports and safe publication | [Artifact validation](../../integrations/typescript-project-artifacts.js), complete-tree observation, hashes and publication rollback; exercised through the installed CLI. |
| Internal recovery mechanisms | `emitProject` and `observeTree` can reuse verified completed work; manifest validation and interruption tests remain. No public `--verify` or `--resume` command is implied. |

## Deliberate reductions and deferred requirements

- The old contracts implementation and borrowed/live publication API are
  retired. Current agreement and analysis APIs own their evidence and revisions.
- Read-only consumer measurement and exception inventory are restored through
  current owners. Historical comparison baselines and campaign runners remain
  retired; they are not prerequisites for an adoption report.
- TypeScript `6.0.3` is currently an ordinary dependency. Optional compiler
  installation for JavaScript-only users was deliberately dropped during
  consolidation; reconsider it as a release/package-size decision, not an
  accidental missing helper.
- The predecessor's TypeScript 7/native-compiler and ES2021-minimum plan was
  agreed but not implemented there. Current executable support remains
  TypeScript 6 with ES2016-or-newer output. Carry the migration requirement into
  a separate API/lifecycle acceptance effort rather than claiming it already
  exists or copying the old process packets.
- Coverage supplements, proof journals and verify/resume campaigns are not
  automatic requirements for a new consumer POC. Preserve the useful obligations:
  unchanged tests, actual artifact execution, identities, effects and failures.

## Documentation carried forward

The active guides adapt the durable parts of predecessor analysis identity,
semantic requirements, cyclic evidence invalidation and low-friction adoption:
requirements are not values; cycles are not evidence producers; retained facts
need current grounded support; consumers keep their source/configuration; and
tests must execute the artifacts being assessed.

Those concepts now live in [architecture](architecture.md),
[TypeScript lowering](typescript.md) and the [verification guide](README.md).
The [reference map](../reference/AGREEMENT_MAP.md) retains the agreement laws,
boundaries, async ownership, proof obligations and lowering families. Consumer
patterns and diagnostic usage live in the [migration playbook](../guide/migration-playbook.md)
and [diagnostic guide](../guide/diagnostic-explanations.md).
Old packet controls, benchmark dossiers, chronological handoffs and obsolete
APIs are not active instructions. The selected [essays](../blogs/README.md)
remain design context. The frozen language references retain their authority.

## Acceptance boundaries

Configured roots need real cross-file findings and inactive/change controls.
Inspection needs the actual configured parser, scope and findings. Project test
connections need unchanged cases, correct artifact loads, stable captured inputs
and explicit failure results. These jobs share current owners rather than adding
a second analyzer or restoring the predecessor proof framework.

Public API, runtime range, metadata and documentation delivery remain release
preparation. Direct TS/TSX ESLint support remains outside this work. The retained
rule surface and selected compatibility jobs do not prove equivalence for every
possible predecessor analysis behavior.

This review distinguishes current functionality, bounded verification and
deliberate omissions; historical filenames and passing totals alone establish
none of those claims.
