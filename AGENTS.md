# Resilient project guidance

This repository is the sole active Resilient project, cut over to
`/Users/delos/Sites/artikulates/artikulates-resilient` on November 9, 2026.
This is one self-contained production package. There is no runtime or tooling
dependency on the parent directory, another checkout, or a separate `resilient`
package. Keep all implementation, tests and required commands here.
Read README.md for the active layout and docs/engineering/README.md for current
engineering contracts. docs/engineering/feature-review.md records retained
capabilities and gaps to resolve before broader adoption.
Old analysis is removed from this build. Do not copy it back, wrap it, or use it
as a fallback. Historical campaigns live outside this project and are not gates.

The foundation has four principles: agreement, identity and ownership, demand,
and change. We are building the slab: the algorithms and mechanisms joining them,
progressing slowly toward the relationship between ESTree and agreement.
The user's criteria are correctness, fluency, and throughput. Develop proposals
within this frame; state their assumptions and expected work/storage costs before
implementation. Measurements must answer a stated question about a proposal.
Existing implementation and benchmark results do not select the architecture.
Utilities are encouraged where closely similar patterns share a semantic contract;
give repeated mechanisms a focused owner while preserving caller responsibilities.
Rule coverage and test totals are verification, not the foundation roadmap.
Foundation acceptance requires stated semantic invariants and work/storage bounds
under composition. Exercise shared requirements, wide and successive joins,
unknown beside contradiction, and revisions of retained evidence. Stack safety,
cached-fact counts, lint and isolated examples do not establish those guarantees.
Do not call a foundation slice complete while a known structural defect remains
within its supported contract.
Connect rule policy to shared evidence, product findings, and adversarial tests;
checker coverage alone does not establish product support. The architecture and
TypeScript guides under docs/engineering/ define current ownership and boundaries.
Producer-projection optimization is deferred.

Build shared agreement and analysis under analysis; TypeScript source acquisition, policy and emission belong under transforms. Consumers use the package's eslint-plugin-resilient/agreement
and eslint-plugin-resilient/analyzer entry points; ESLint hosts use eslint-plugin-resilient/eslint. Maintained correctness tests belong in tests; their support belongs in tests/support.
Only required development and shipping commands belong in scripts. Generated
verification output belongs in ignored .artifacts. Do not add exploratory runners
or historical snapshots to active code. Do not
add empty architectural layers or a second implementation to integrate later.

The old checker and predecessor analysis are retired from the active build.
All required contract and test inputs are in this package. Do not make commands
read another checkout or restore legacy analysis through a compatibility wrapper.
Use Node matching package.json's engines.node on PATH and this project's
node_modules installation. CI installs that version and runs npm ci followed by
npm run check.

The normative dialect is preserved locally in docs/reference/grammar.md,
policy.md, and semantics.md, with docs/ai/CODING_STANDARDS.md. These core documents
match their frozen reference bytes. docs/ai/writing-resilient.md maps their use
to the current owners; docs/reference/README.md distinguishes retained language
policy from predecessor implementation claims. Current rule behavior and
capability boundaries belong to the current engineering guides, tests and source docs.
The user specifically identified docs/reference/, docs/blogs/, and docs/ai/ as
useful guidance. Current engineering contracts live in docs/engineering/.
Historical engineering records are removable; no active command, test or guide
may require them. Archived plans do not authorize restoring the old
analysis, adding build dependencies or introducing new acceptance gates.
Read the owning references before a semantic decision.
Preserve known, contradictory, and unknown evidence. Never fabricate defaults or
validation, conflate execution failure with unknown, or change observable behavior
merely to satisfy a diagnostic. Local exceptions require the exact rule and a
concrete semantic reason under Policy P-03; do not generate blanket suppressions.

Fluency is required in every increment. Avoid explicit undefined assignments and
defaults; preserve natural absence only at its owned boundary without inventing
replacement evidence. Use collection methods where their semantics fit, including
sparse slots and callback arguments. Isolate recurring async, I/O, and private
mutation mechanisms in focused utilities with narrow, explained exceptions.

Run npm run check for acceptance: dialect lint and exception audit, maintained
tests, and a normal isolated install of this one package. Product assertions and
fixtures remain required. Historical source surveys, corpus campaigns and timing
runners are archived; do not restore them to this gate. The dialect gate must
pass before further analyzer behavior is accepted. Focused tests and
benchmarks do not replace that gate. Run measurements to test a stated proposal
question, and distinguish observations from performance hypotheses. Design-only
work does not require rerunning implementation benchmarks. Read-only source samples
are not proof of complete lint coverage or whole-lint speed.

Preserve history and unrelated work. Review changes to local host policy,
dependency versions and corpus inputs explicitly; never silently refresh the
pinned standards or retained diagnostic expectations. The removed checker's
original pins and historical results remain evidence, not runtime dependencies.
