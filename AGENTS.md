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
as a fallback. Historical campaigns live outside this project and are not gates,
except for the explicitly required fp-ts transformer acceptance described below.

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
Analyzer repair bundles follow the guarded handoff in
docs/engineering/analyzer-completion.md. Start with its shared ownership contract,
record readable counterexamples under their rules in tests/fixtures/bad.js, and
reuse the existing public harness. Do not create a suite for each counterexample.
Remove checks that only mirror implementation, duplicate an established check or
mistake metadata/counts for behavior. Preserve meaningful semantic, revision,
query-order, delivery and resource checks. A failed pathway returns to the shared
contract and a revised hypothesis before another candidate or expanded scope.
Prefer a few decisive validations of composed public contracts. Organize suites
by durable semantic owners, not repair history. Illustrative unit cases and
equivalent syntax spellings belong in readable comments in bad.js; they do not
justify another executable matrix or harness. Remove duplicate cases as well as
duplicate suite files. Each retained check must establish a distinct useful
property. Do not add JSDoc or other documentation-test tooling for these examples.
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
runners are archived. The user's required fp-ts transformer acceptance is the
exception: whenever the transformer is touched, run `npm run check:fp-ts` against
the final tree, in addition to `npm run check`. This includes shared analysis,
policy or delivery changes that affect lowering. Fixture-only lowering does not
replace this run. The full fp-ts corpus run is the main transformer acceptance
test. Preserve the local ignored corpus in `tests/fixtures/fp-ts` and its
manifest; do not check the corpus into version control. Maintain the harness in
`scripts/check-fp-ts.js`; generated output belongs in `.artifacts`.
Require all 1,818 cases to match across native, raw and fixed JavaScript, physical
load receipts for all 123 emitted modules, zero post-fix errors, and only the
accepted 30 `resilient/prefer-async-await` warnings. Any emitted error blocks
acceptance: investigate whether the change exposed a new lint or introduced a
regression. Never refresh the corpus or baseline merely to pass. Retain and
report the output directory and acceptance receipt. Run it after the normal
check, without competing test runs. If the private corpus is unavailable, report
transformer acceptance as unverified; do not replace it with fixtures or a CI
pass that did not run the corpus. The dialect gate must
pass before further analyzer behavior is accepted. Focused tests and
benchmarks do not replace that gate. Run measurements to test a stated proposal
question, and distinguish observations from performance hypotheses. Design-only
work does not require rerunning implementation benchmarks. Read-only source samples
are not proof of complete lint coverage or whole-lint speed.

The self-lint requirement applies only to `npm run lint`: it must complete in
strictly less than 69 seconds; the target is 50 seconds or less. Measure that
command separately. `npm run check` has no current elapsed-time budget or
timeout; allow its lint, tests and isolated package installation to complete.

Validate changes in an isolated candidate before applying them to the active
workspace. Keep the last verified workspace checkpoint intact while developing
and reviewing the candidate. Run the applicable required gates on the final
candidate bytes, then promote only those verified bytes and verify their hashes.
Any subsequent source change invalidates that candidate's acceptance. Preserve
concurrent user edits; do not overwrite them during promotion. A clean review is
a valid result: fix supported-contract P0–P3 findings, and do not manufacture
findings or equate an intentional unknown boundary with a false diagnostic.

Preserve history and unrelated work. Review changes to local host policy,
dependency versions and corpus inputs explicitly; never silently refresh the
pinned standards or retained diagnostic expectations. The removed checker's
original pins and historical results remain evidence, not runtime dependencies.
