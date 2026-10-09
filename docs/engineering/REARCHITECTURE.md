# Current architecture and acceptance

Packets 1–6 of the September 30, 2026 plan are **accepted historical work**,
with Packet 6 completed on October 1. This record carries forward the owners,
semantic boundaries and verification needed for new work. The completed plans
and measurements are preserved in the
[October 1 history](https://github.com/augurone/artikulates-resilient/tree/d34d388387304d17a6e2b3f9751272e300b14b9b/docs/archive),
not in the current checkout. No commit or release is implied by acceptance.

The October 1–2 P01 and P05–P15 preservation and correctness follow-ups were
also accepted. Their focused ownership and fresh corpus evidence are recorded
below as historical facts; they extended the Packet 6 baseline without
rewriting its measurements.

The [agreement reference map](../reference/AGREEMENT_MAP.md) owns the dialect's
reference order. [AGENTS.md](../../AGENTS.md) owns repository execution policy.
Neither a corpus result nor this architectural record changes those laws.

The [active October 8 plan](LOWERING_RECOVERY_PLAN_2026-10-05.md#active-plan--two-shared-mechanisms)
focuses on mechanical emission and shared directive rule accumulation. It
replaces selection by individual lint finding or semantic exception family.
Explicit Boolean tests remain intact; the proposed expression-rewrite task
was withdrawn. No dialect or lint configuration changed with this decision.

The [October 8 recovery checkpoint](LOWERING_RECOVERY_PLAN_2026-10-05.md#current-position--october-8-2026)
indexes the accepted shared directive repair and its remaining span dependencies.
The latest accepted corpus retains zero restricted-mechanical changes, three
policy-dependent raw expression findings, 203 generated plus two inherited
unused rule entries and 34 full-fixer changed files. Generated inline directives
fell from 20 to six; two authored/generated stacked pairs remain. The
[scoped acceptance below](#shared-directive-accumulation-acceptance--october-8-2026)
records the preserved behavior and explicit stopping boundary. Historical
acceptance sections keep their original counts.

The [lowering recovery plan](LOWERING_RECOVERY_PLAN_2026-10-05.md) records the
October 5 path from the preserved formatter/grouping snapshot to integrated,
conforming raw emission and a measured decision on optional fixing. Phase 1A's
integration proposal was independently reviewed; its 19-file patch and a
separately reviewed indentation correction were applied in the development
checkout. The original Phase 1B execution remains [unaccepted for two recorded
blockers](/Users/delos/Sites/artikulates/.work-checkpoints/lowering-integration-20261006-phase1b-r4/review.md).
Subsequent, separate fp-ts runner repair evidence resolved the helper-binding
and shared-cache execution defects with strict comparison intact. Its
[one-command follow-up](/private/tmp/resilient-fp-memory-20261006-37YzyV/outcome.md)
completed at an 8 GB heap and was independently accepted **for the runner
packet**. The subsequent [final Phase 1B review](#phase-1b-integrated-acceptance--october-6-2026)
accepts the exact integrated snapshot and preserves the original failed attempt.
Historical 23-stage corpus counts below describe
their original runner; the current per-file runner records 256 stages for this
123-source corpus. The [proof runbook](PROOF_EXECUTION.md#corpus-stages-and-recovery)
describes current execution. Use the plan's [evidence checklist](LOWERING_RECOVERY_PLAN_2026-10-05.md#acceptance-evidence-checklist)
for a final Phase 1B review.

## Historical accepted baseline

The historical P15 corpus evidence is **`2loHgc`**, compared with P08's
**`Oe0KJJ`**. These historical results describe the P15 implementation input at
the time it was accepted; they do not measure the current checkout. Both use
unchanged fp-ts **2.16.11**, commit
`c0a6472121c67a2b083e62fcff13e7d022e39d8f`.

| Measure | Historical accepted result |
| --- | --- |
| Production lint | **0 errors, 3 existing unused-disable warnings** |
| Source runtime | **1,842 / 1,842 passed**, no failures or skips |
| Lowered runtime | **1,966 / 1,966 passed**, no failures or skips |
| Native-fixed lowered lint | **0 errors, 30 existing `prefer-async-await` warnings** |
| Fixed output against `Oe0KJJ` | **10 files changed**: nine P13 mutation-boundary files and one separately present `function.js` directive delta |
| Original source / tests | **123 / 81 files unchanged** |
| Independently exposed mutation findings | **14 errors across 8 modules reduced to 0**; the existing 30 async warnings are unchanged |
| Authored boundaries / named rule sites | **181 / 182**, including **75** transformer boundaries |
| Publication / emitter catalog | **57** agreement kinds; **61** comment calls; **81** directive-string expressions |
| Repository proof | Full sequential tests, rule highlights, integration fixtures and lint gate passed |

All **23 stages completed once** in the final fresh artifact. At acceptance,
these were newly executed runtime results. No generated code was hand-edited;
generated mutation boundaries are limited to checker-proved, source-owned
accumulator operations.

The [Packet 6 acceptance evidence](https://github.com/augurone/artikulates-resilient/blob/d34d388387304d17a6e2b3f9751272e300b14b9b/docs/archive/rearchitecture/packets.md)
records the historical candidate, async-boundary repair, repeated gate,
comparisons and preservation checks. Its host-local summary was:

```text
/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-HgkFOL/summary.json
```

Temporary paths identify the measured artifacts; they are not portable setup
requirements. If they expire, preserve the recorded result as history and
produce new evidence before claiming a fresh measurement. No end-to-end speed
improvement or lint reduction is claimed for Packet 6.

The October 1 documentation and package consolidation also passed the full
repository gate and packed-consumer check on Node v22.13.0 arm64. This is
historical package evidence: it changed navigation and package inclusion only,
while all 133 shipped JavaScript files were byte-identical. The corpus totals
above remain Packet 6's measurement; that follow-up required no corpus
regeneration.

### P01 emission literal preservation

P01 is accepted on Node v22.13.0 arm64. Its input owner is TypeScript's final
printed JavaScript; the emission formatter may place syntax/layout tokens but
does not own declaration-kind selection or literal, template, regex, or
comment payloads. The replacement shields those payload ranges during layout
and restores their exact text, while preserving directive recognition and
wrapping an overlong literal initializer only at the declaration `=` token.
Focused transformer proofs cover the four reported failures, tagged templates,
regexes, comments, raw/fixed lint, and source/lowered runtime parity.

The full repository gate passed, and fresh fp-ts 2.16.11 evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-aMxmak/summary.json`
was integrity-verified after all 23 stages completed once. It records 1,842 /
1,842 source and 1,966 / 1,966 lowered runtime tests passing, with 0
native-fixed lint errors and the existing 30 `prefer-async-await` warnings.
No lint-family decrease is claimed for this behavior-preservation repair.

### P05 native function capability preservation

P05 is accepted on Node v22.13.0 arm64. Checker-backed source facts now own
the decision to emit an equivalent arrow, a native function expression, or a
retained declaration. Arrow admission requires direct-call-only references and
excludes construction, prototype identity, dynamic `this`, `arguments`, direct
or nested-arrow `new.target`, export escape, direct evaluation, and references
that require declaration hoisting. `new.target` is recognized by its actual
TypeScript `MetaProperty` plus `NewKeyword` shape. Final boundary placement
normalizes retained declarations after all other annotations so hoisting and
callable capabilities remain explicit without leaving `func-style` errors.

Focused proofs cover construction, own prototypes, dynamic receivers,
`arguments`, direct and nested-arrow `new.target`, export/escape, ordinary
direct calls, early references, raw/fixed lint, and source/lowered runtime
parity. The completed decision store now has **54** semantic routes, and the
maintained emitter inventory remains **58** comment calls and **76** directive
string expressions.

The full repository gate passed. Fresh unchanged fp-ts 2.16.11 evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-9ecK1S/summary.json`
was integrity-verified after all 23 stages completed once. It records 1,842 /
1,842 source and 1,966 / 1,966 lowered runtime tests passing, with 0
native-fixed lint errors and the existing 30 `prefer-async-await` warnings.
No lint-family decrease is claimed for this capability-preservation repair.

### P06 declaration scope and initialization preservation

P06 is accepted on Node v22.13.0 arm64. Checker-backed lifetime facts now own
declaration-kind selection: original symbol identity, owning function and
lexical scope, reads, writes, early references, captures, redeclarations and
initialization phase are collected before lowering. A directly initialized
function-scoped `var` becomes `const` only when no later write exists, becomes
`let` when writes are proved, and otherwise remains `var` when block escape,
scope-entry `undefined`, capture, redeclaration or direct evaluation could make
lexical lowering observably different. Reassigned native function bindings are
likewise emitted as `let` rather than an immutable declaration.

Early-reference annotations are attached to the complete enclosing statement,
after runtime binding order is known. Placement ignores bodyless overload
signatures, suppresses only references whose emitted runtime definition still
comes later, and leaves self-references and dependencies already reordered
before their consumers unannotated. This preserves initialization timing while
avoiding token-adjacent comments and fixer residue. Focused proofs cover nested
early calls, sibling scopes, recursive cycles, block escape, scope-entry
`undefined`, reassignment, safe immutable lowering, mutable function bindings,
lexical TDZ behavior, overload self-reference, reordered providers, raw/fixed
lint and source/lowered runtime parity.

Corpus iteration exposed and repaired three falsifiers before acceptance:
overload boundaries lost during reannotation, identifier-adjacent comments
that left call-spacing residue after fixing, and overload signatures mistaken
for runtime definitions. The completed decision store now has **56** semantic
routes; the maintained emitter inventory has **58** comment calls and **74**
directive-string expressions.

The full repository gate passed. Fresh unchanged fp-ts 2.16.11 evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-OfWpav/summary.json`
was integrity-verified after all 23 stages completed once. It records 1,842 /
1,842 source and 1,966 / 1,966 lowered runtime tests passing, with 0
native-fixed lint errors and the existing 30 `prefer-async-await` warnings.
Against accepted P05 fixed output, 119 of 123 modules are byte-identical; the
four changed modules contain only six intentional forward-reference directive
placement/reason updates. Original source and test hashes remain unchanged. No
lint-family decrease is claimed for this declaration-lifetime repair.

### P07 authored evaluation-order preservation

P07 is accepted on Node v22.13.0 arm64. Every authored top-level runtime
statement now retains its source position. Checker symbol identity distinguishes
real dependencies from shadowed equal names, and eager/deferred classification
describes observation timing without licensing authored movement. Generated
helpers remain a separate placement problem: eager dependencies are hard
anchors, deferred dependencies may guide placement only before the first eager
consumer, and overload arity metadata follows the last runtime declaration
rather than a bodyless signature.

A forward reference is evidence to inspect, not proof of recursion. Dependency-
graph cycle membership selects the recursion-specific reason; acyclic forward
references record authored order. One scoped `no-use-before-define` boundary
wraps the complete authored statement, survives multiline fixing and later AST
reconstruction, precedes existing next-line directives, and re-enables only its
own rule. Focused proofs cover effects and failure order, throwing getters,
shadowing, deferred closures, direct IIFEs, native TDZ failure, overload
metadata, circular-module initialization, raw/fixed lint and runtime parity.

Corpus iteration falsified three broader strategies before acceptance: placing
metadata after the first overload signature caused a `flow` TDZ failure;
moving apparently passive bindings changed circular-module initialization; and
identifier/physical-line boundaries did not cover formatted multiline
statements. The accepted implementation leaves all authored statements fixed
and performs no checker query during placement.

The full repository gate passed. Fresh unchanged fp-ts 2.16.11 evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-hDMrrD/summary.json`
was integrity-verified after all 23 stages completed once. It records 1,842 /
1,842 source and 1,966 / 1,966 lowered runtime tests passing, with 0
native-fixed lint errors and the existing 30 `prefer-async-await` warnings.
Against accepted P06 output, 69 of 123 modules intentionally change while all
source and test hashes remain identical. No lint-family decrease is claimed for
this evaluation-order repair.

### P08 source-fact-owned arity lowering

P08 is accepted on Node v22.13.0 arm64. Understand now records the source
function identity, native global `Function` and `Object` identities, strict
module parameter semantics, the one direct `arguments.length` dispatch, all
optional-parameter reads and writes, and direct-eval absence before signature
rewriting. Policy admits `lower-arity-from-source-facts` only when those facts
and the protected-use proof agree; shadowed `Function`, callable aliases,
shadowed metadata capability, mapped-arguments scripts and otherwise unproved
forms retain their source arity.

Grammar removes the optional formals only after that completed decision. It
declares their bindings once and performs actual-count-guarded numeric object
assignments in the source switch expression. A supplied position is therefore
read without acquiring `Symbol.iterator`; an omitted position remains
`undefined` without consulting an inherited numeric getter; explicit
`undefined`, parameter reassignment and case fallthrough retain their source
meaning. The source function `.length` is restored before later authored
observation. The lowerer no longer classifies type spelling, mutability,
dispatch ownership or global capability from rewritten syntax.

Focused proofs cover mutable formals, live `arguments`, `.length`, fallthrough,
omission versus explicit `undefined`, inherited numeric getters, a poisoned
array iterator, raw/fixed lint and runtime parity, plus shadowed and aliased
callable rejection. The generated object assignments no longer publish
fabricated final-array-binding reports. The completed decision store now has
**57** semantic routes; the maintained emitter inventory remains **61**
comment calls and **81** directive-string expressions.

The full repository gate passed. Fresh unchanged fp-ts 2.16.11 evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-Oe0KJJ/summary.json`
was integrity-verified after all 23 stages completed once. It records 1,842 /
1,842 source and 1,966 / 1,966 lowered runtime tests passing, with 0
native-fixed lint errors and the existing 30 `prefer-async-await` warnings.
Against accepted P07 output, only `function.js` changes in raw and fixed form,
at the `flow` and `pipe` arity dispatchers. Source and test hashes remain
unchanged. The agreement ledger removes 72 repeated reports owned solely by
the deleted generated array bindings; every remaining ordered report is equal
after normalizing the intended `function.js` output hash, and the empty dynamic
boundary ledger is unchanged. No lint-family decrease is claimed for this
arity semantic-preservation repair.

### P09 lexical analyzer identity

P09 is accepted on Node v22.13.0 arm64. One parser-neutral session index now
owns scope, declaration, binding and reference identity for the ESTree analyzer.
Its frozen records and weak-keyed private metadata are tied to the analysis
session; parser nodes and public name-keyed definition views remain unchanged.
Definition resolution, flow bindings and callable aliases, function/document
lookup, and namespace-import exclusions consume that identity instead of equal
identifier spelling.

Block, loop and catch exit restores the outer presentation view while writes to
an outer binding identity survive. Nested same-named functions remain distinct,
destructured parameters and imports cannot borrow definitions or namespace
capability from an equal name, and project definitions retain their owning
identity index when a caller evaluates an imported function. Accessor-backed
inputs keep their prior live-read lifecycle; plain parentless ESTree receives
the internal index without requiring ESLint scope or parent metadata.

Focused proofs cover rename invariance, block/function/catch shadowing,
import-versus-parameter identity, outer writes across block exit, nested
signature lookup, session replacement, direct portable AST use, project graph
convergence and cache ownership. The full repository gate passed: all tests and
fixture contracts completed, repository lint reported zero errors (with two
existing unused-disable warnings outside the packet), and whitespace validation
passed. This analyzer-only replacement changes no transformer policy or emitted
corpus artifact, so no fp-ts regeneration or lint-family delta is claimed.

### P10 authored and native callable evidence

P10 is accepted on Node v22.13.0 arm64. One finite callable query now owns the
analyzer's `known-authored`, `justified-native`, and `unknown` outcomes.
Inference and operation diagnostics consume that result, while flow and the
return-consistency predicate consumer share its predicate-body proof. A known
own callable member wins before any native method-name interpretation.
Unshadowed `Object`, `Promise`, and `Array` identities and stable `const`
aliases may supply native evidence; shadowed globals, mutable aliases, unknown
receivers, and unsupported effects remain unknown. Direct `Boolean`, `Number`,
and `String` calls and their stable aliases use the same identity admission.

The documented unresolved `isFunction(value)` syntax remains a local guard
compatibility boundary. It does not establish forwarded-consumer safety.
Resolved helpers must be synchronous, unary functions whose body demonstrates
the callable predicate; truthy lookalikes and shadowed helpers do not narrow.
Concrete arguments re-evaluate returned authored callables whose declaration
summary was necessarily unknown, preserving known call-site evidence without
restoring method-spelling inference.

Focused proofs cover shadowed `Object`, `Promise`, and `Array`, genuine native
aliases, shadowed and aliased direct native functions, mutable alias rejection,
false and resolved `isFunction` bodies, known own `map`, unknown receivers,
namespace-published authored members, and the existing
unresolved-local/unresolved-consumer boundaries. The full
repository gate passed: all tests and fixture contracts completed, repository
lint reported zero errors and three unused-disable warnings, and whitespace
validation passed. This analyzer-only replacement changes no transformer
policy or emitted corpus artifact, so no fp-ts regeneration or lint-family
delta is claimed.

### P11 surviving completion composition

P11 is accepted on Node v22.13.0 arm64. Analyzer flow now composes finite
normal, return, throw, break, and continue records with their path environment,
value where applicable, and label target where applicable. Equivalent records
join at statement boundaries so large functions remain finite without erasing
distinct abrupt owners. Sequence, conditional, switch, loop, and labeled-flow
consumers propagate or consume those records explicitly.

Catch entry consumes explicit throw paths with the environment at the throw,
so assignments completed before an explicit throw remain visible. Potential
implicit throws enter catch through conservative environment joins instead of
restoring stale entry certainty. A normally completing finalizer resumes each
pending completion with the finalizer's resulting environment; a return,
throw, break, or continue from the finalizer replaces that pending completion.
The compatibility return view and return-consistency rule now contain only
surviving returns, and local call inference consults that view when completion
composition removes or replaces a structural return.

Focused proofs cover overridden and preserved return and throw, explicit-throw
assignment state, conservative implicit-throw joins, unreachable returns,
switch break, loop break/continue, labels, and finalizers that preserve or
replace loop control. Flow-store ownership proves return evidence is published
only after composition. The full repository gate passed: all tests and fixture
contracts completed, repository lint reported zero errors and three existing
unused-disable warnings, and whitespace validation passed. This analyzer-only
replacement changes no transformer policy or emitted corpus artifact, so no
fp-ts regeneration or lint-family delta is claimed.

### P12 portable return diagnostics

P12 is accepted on Node v22.13.0 arm64. Return consistency is now the fifth
portable contract diagnostic family. One reader in `rules/contracts/diagnostics.js`
consumes P11's surviving-return records, and the document, module graph, direct
contracts export, and thin ESLint presentation adapter all delegate to that
owner. The public result remains a fresh mutable layer on every direct query;
source nodes and the analyzer's completed flow evidence retain their existing
identity and failure timing.

Focused proofs cover the audit's two-return contradiction, async comparison,
callable-absence guards, conditional returns, finalizer replacement, unreachable
returns, direct reader null safety, and document/graph/ESLint parity for all five
families. The parity proof compares diagnostic order and return-expression
locations, while the graph proof preserves file ownership and consumer findings.
The contracts reference now documents the added family and direct reader.

The full repository gate and packed-consumer proof passed. The packed contracts
subpath exports `getReturnDiagnostics`, all fixtures retain their expected rule
coverage, repository lint reports zero errors and the existing warnings only,
and whitespace validation passes. This analyzer/rule publication changes no
transformer policy or emitted fp-ts corpus artifact, so no corpus regeneration
or lint-family delta is claimed.

### P13 independent mutation enforcement

P13 is accepted on Node v22.13.0 arm64. The safety rule now reports mutation
independently of synchronous loop policy: a retained `for-of` no longer waives
`push`, `Object.assign`, member assignment, awaited-loop mutation, or mutation
inside a nested callback. Safety-only and combined-rule proofs establish that
the loop and mutation diagnostics remain separate, and the integration fixture
now requires the newly visible retained-loop mutation finding.

Descriptor enforcement remains deliberately narrower than name matching. A
focused repository audit resolves unshadowed native `Object.defineProperty`,
`Object.defineProperties`, and `Reflect.defineProperty` identities, then
classifies their original-AST targets. Parameters, imports, and captured
bindings are caller-owned; same-boundary locals are private; shadowed globals
grant no native evidence. The current transform-owned retained-reason store has
no caller-owned descriptor writes under that contract.

Measuring accepted artifact `Oe0KJJ` with the repaired rule exposed **14**
previously hidden safety errors across eight modules. Transformer repair grants
an exact loop-scoped boundary only when every mutation is a checker-resolved
native array `push` or simple member write rooted in a fresh, same-function
array/object accumulator. Caller-owned inputs, nested callback mutations,
updates, deletes, `Object.assign`, and mixed unproved mutations remain outside
that admission. Direct live Map/Set builders receive their existing completed
collection decision at each exact mutation statement. The first fresh corpus
candidate correctly exposed two remaining object-backed group accumulators;
extending the same fresh-owner proof repaired those without broadening target
ownership.

The full repository gate passed: all tests and fixture contracts completed,
repository lint reported zero errors and the three existing unused-disable
warnings, and whitespace validation passed. Fresh unchanged fp-ts 2.16.11
evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-Uc6F77/summary.json`
completed all 23 stages once. It records 1,842 / 1,842 source and 1,966 / 1,966
lowered runtime tests passing, with 0 native-fixed lint errors and the unchanged
30 `prefer-async-await` warnings.

### P14 local scaling buffers

P14 is accepted on Node v22.13.0 arm64. The three statement-ordering queues in
`policy/dependencies.js` now consume private iterative buffers, preserving
their separate ordering contracts: function bindings and declarations retain
dependent discovery order, while runtime bindings retain source-position order.
Private child, expression, and diagnostic-index buffers replace growing-prefix
copies without mutating parser-owned nodes or public diagnostic records.

Focused proofs cover source order, duplicate dependency suppression, cyclic
fallback order, accessor/failure propagation, returned identity, and 4k/8k/12k
inputs. P14 eliminated recursion and growing-prefix copies, but it did not
make every ordering queue linear: the current source-position runtime-binding
queue scans consumed entries while selecting the next ready statement. Its
chain controls make 7,998,000 / 31,996,000 / 71,994,000 predicate visits at
4k / 8k / 12k inputs. Five same-runtime measurements below report wall-time
and post-GC heap-delta ranges; they are observations, not a speedup claim.

| Input | Function bindings / runtime bindings / declarations | Children | Diagnostic index |
| --- | --- | --- | --- |
| 4k | 7.013–13.117 / 14.059–35.659 / 6.168–9.154 ms; 8.33–11.62 / 14.55–16.08 / 2.56–16.49 MiB | 0.135–0.294 ms; 0.10 MiB | 0.164–0.387 ms; 0.13–0.14 MiB |
| 8k | 13.113–14.586 / 34.520–35.150 / 12.240–13.176 ms; 14.90–15.71 / 15.35–16.50 / 16.26–17.17 MiB | 0.205–0.223 ms; 0.23–0.25 MiB | 0.325–0.575 ms; 0.20–0.21 MiB |
| 12k | 19.647–21.390 / 63.290–64.220 / 16.564–19.589 ms; 8.99–9.86 / 17.54–19.20 / 18.48–19.59 MiB | 0.251–0.304 ms; 0.36 MiB | 0.607–0.816 ms; 0.35–0.36 MiB |

The full repository gate passed: tests, fixture contracts, zero lint errors
(three existing unused-disable warnings), and whitespace validation. The fresh
unchanged fp-ts 2.16.11 artifact at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-uYx6nU/summary.json`
completed all stages: 1,842/1,842 source and 1,966/1,966 lowered runtime tests
passed, with 0 fixed lint errors and the unchanged 30 async warnings. This
packet changes scheduling mechanics only; no lint-family delta is claimed.

### P15 unconsumed collection-marker removal

P15 is accepted on Node v22.13.0 arm64. The deleted owner is the
`markCompleted` identity wrapper and the direct
`__resilientCollectionAgreement` write in
`lowering/collection-reconstruction.js`; repository reference search finds no
remaining production or test reader. Construction and call order remain owned
by the original factory calls, which now return their created nodes directly.
The distinct exact-tuple-position and collection-timing-boundary descriptors
remain in place because this packet establishes no analogous removal case.

A focused collection-decision proof supplies a custom compiler factory whose
return node observes descriptor definitions. It emits the same lowered
collection and observes no collection-marker descriptor write. That descriptor
mutation was incidental internal behavior, not a TypeScript factory or public
adapter API contract; consumers receive printed output and completed decisions,
not a promise that lowering augments factory-created AST nodes.

The full repository gate passed: tests, fixture contracts, repository lint
with 0 errors and the three existing unused-disable warnings, and whitespace
validation. Fresh unchanged fp-ts 2.16.11 evidence at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-2loHgc/summary.json`
completed all stages. It records 1,842 / 1,842 source and 1,966 / 1,966
lowered runtime tests passing, 0 native-fixed lint errors and the unchanged 30
async warnings. Its source/test hashes, generated-output hashes, agreement
reports, runtime results and lint reports are identical to accepted `Uc6F77`;
the artifact contains no `__resilientCollectionAgreement` occurrence.

### R6-A captured return evidence and portable identity

R6-A is accepted on Node v22.13.0 arm64. Function flow now captures return
families and original conditional/logical branch nodes when the contributing
expression evaluates. A normally completing finalizer preserves that evidence;
an abrupt finalizer replaces it. The return reader compares the completed
records instead of re-inferring under the final context or cloning source AST
nodes. Completed function completions are published alongside the existing
`.returns`, `.contexts`, and `.finalContext` views. Only returned-result
alternatives are retained; call arguments and discarded sequence operands do
not become return alternatives.

Focused proofs cover both F6 mutations, conditional and sequence branch
locations, finalizer replacement, async fulfillment, known conflicts beside
unknown returns, fresh diagnostics with strict original-node identity, frozen
parentless ASTs, and direct/document/graph/ESLint parity. Existing predicate
callbacks exposed by captured logical results now produce explicit boolean
families; their callers consume truthiness, and the complete suite verifies
the corresponding transformer behavior. R6-B's callable-absence rule is a
separate packet; this slice does not claim to settle that waiver.

The full repository gate passed with an 8 GB Node heap for the large
transformer proof: all tests, 22 rule highlights and 9 integration fixtures,
repository lint with **0 errors and 3 existing unused-disable warnings**, and
whitespace validation. The unchanged saved fp-ts 2.16.11 artifact from
`2loHgc` (upstream commit `c0a6472121c67a2b083e62fcff13e7d022e39d8f`)
was re-linted without regeneration. Its 123 generated JavaScript files had
aggregate SHA-256
`73a1f07a934f152377362bcd946433e9ccd5c192d77e9dbd7331d0be1a641b87`
before and after lint. Fixed-artifact errors remain **0**; all **30** prior
`prefer-async-await` warnings remain. One additional unused-disable warning
now appears at `ReadonlySet.js:466`, where captured evidence no longer
establishes a known contradiction for the existing return-consistency directive.
This is a fresh analyzer measurement of saved output, not new transformer or
runtime acceptance.

### R6-B callable absence and completed normal outcomes

R6-B is accepted on Node v22.13.0 arm64. Return consistency now compares
known families from every surviving completed normal outcome. Bare returns
and reachable function-end fallthrough carry `undefined`; throws, async
rejections and nonterminating paths do not supply a normal result. The old
callable-guard waiver is removed. Effect-only guarded callbacks with only
absent normal exits remain consistent without a fabricated callback, default,
collection operation or return value. Unknown paths do not erase separate
known conflicts.

Focused proofs cover the invalid guarded empty-`forEach`/string example under
parented, parentless and frozen ASTs; guarded callable/absence, bare exits,
implicit fallthrough, all-absence, and effect-only controls; source-node
identity, ranges, fresh diagnostics and direct/document/graph/ESLint parity.
The earlier R6-A captured-value and finalizer proofs remain in the complete
suite. The rule page and fixture examples now reflect the completed law.

The full repository gate passed: all tests, 22 rule highlights and 9
integration fixtures, repository lint with **0 errors and 3 existing
unused-disable warnings**, and whitespace validation. The existing checked
switch no-value decision now names return consistency in its exact generated
directive alongside `consistent-return`; it preserves the source's bare exit
or fallthrough and introduces no default. The rule and the directive remain
separate: the portable reader still reports the mixed normal families.

The unchanged saved `2loHgc` generated artifact was re-linted without a fix
or regeneration. Its 123 JavaScript files remained byte-identical before and
after the read-only run. Relative to its saved lint report, the five agreement
families changed only in return consistency: **0 → 9 errors**, all at
`function.js`'s `flow` unsupported-arity fallthrough versus eight callable
returns. The other four agreement families remained at zero. All **30**
`prefer-async-await` warnings remained; the one R6-A unused-directive warning
also appeared in the new analyzer run. The saved `function.js` SHA-256 was
`0ad699734356bbd886fccda77b62eea168553c8b96916dc6a42dfe817720cfb5`.

A fresh unchanged-source fp-ts 2.16.11 proof at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-v3MMUR/summary.json`
used upstream commit `c0a6472121c67a2b083e62fcff13e7d022e39d8f`.
All 123 source hashes and 81 test hashes match the prior artifact. It records
**1,842 / 1,842** source and **1,966 / 1,966** lowered runtime tests passing,
**0** fixed-artifact lint errors and the unchanged **30** async warnings.
Generated outputs changed in `These.ts` and `function.ts`; the latter contains
the exact switch directive. The new `function.js` SHA-256 is
`8338b74cb7e2bff59c7ebca441a6b6b1b47480e426821da3fd425b6372f89310`.
This completed corpus is the transformer/runtime acceptance for the exact
directive addition; the old saved-artifact delta remains the evidence of what
the new portable rule detects without that new directive.

### R7 implicit completion ownership

R7 is accepted as an analyzer packet on Node v22.13.0 arm64. `flow.js` now
owns ordered expression completions and composes their normal and throwing
outcomes through statements, catch, and finally. It captures callee,
receiver, argument, and returned values at their evaluation phases; unknown
effects widen accessible mutable bindings and heap refinements. The old
implicit-throw descendant scanner and try/finalizer rescans are gone. No
second control-flow graph or global effect solver was added.

Focused proofs cover both F7 nested-handler falsifiers, an escaping call,
assignment and call snapshots, a known noncallable, open parameter heap
evidence after an opaque call, array-pattern binding, heterogeneous tuple
positions, literal branch reachability, iterator-close precedence, pattern
failure, and unsupported-expression owner context. Additional read-only
probes covered explicit throw, catch-pattern ownership, finalizer override,
do/while order, false and endless loops, member getter timing, and spread
fallback. The combined-preset valid fixture exports and calls the guarded
callback positive from the R7 contract. The full gate passed: all tests, 22
rule highlights, 9 integration fixtures, repository lint with **0 errors and
2 unused-directive warnings**,
and whitespace validation. A large program-flow proof completed after the
private completion join stopped scanning earlier outcomes and scope
restoration stopped rebuilding an object once per local name. This is a
performance repair within the same completion owner.

The unchanged saved `2loHgc` artifact was re-linted read-only after the gate.
Its 123 generated JavaScript files were byte-identical before and after
(`893e5d639307c642f37f6f739355f3dbc169a2bf372f21f7ae7e434dd770f180`,
SHA-256 of sorted `name:content-hash` rows). The saved report has no
agreement-family findings and 30 async warnings. At that read-only measurement,
the checkout's rules reported
**9** return-consistency errors, **0** in the other four agreement families,
**10** safety-rule errors, one unused directive, and the unchanged **30**
async warnings. The nine return findings are the R6-B saved-artifact delta;
the safety findings are measured in the integrated checkout and are not
attributed to R7 in isolation. This does not claim fresh transformer or
runtime corpus acceptance.

### R8 parameter-phase signature context

R8 is accepted on Node v22.13.0 arm64. Signature defaults now use the owning
function's lexical index and bind earlier parameters before examining later
defaults. Parameter evaluation excludes body `var`/function bindings from its
own function scope while retaining outer bindings. Native static calls require
an indexed occurrence resolved without an authored binding; a standalone
`getSignature` call keeps native-dependent defaults unknown. Literal defaults
remain available through that public helper.

Focused proofs cover genuine `Object.entries`, a parameter named `Object`, an
authored outer `Object`, a stable `const` alias, a mutable alias, body-local
shadowing, earlier and later parameters, an imported signature, parentless
ESTree, call-site and operation findings, and document/ESLint parity. The full
gate passed: all tests, 22 rule highlights, 9 integration fixtures, repository
lint with **0 errors and 3 unused-disable warnings**, and whitespace validation.

The unchanged saved `2loHgc` artifact was re-linted read-only after the gate.
Its 123 generated JavaScript files had identical SHA-256 inventories before
and after (`893e5d639307c642f37f6f739355f3dbc169a2bf372f21f7ae7e434dd770f180`,
SHA-256 of sorted `name:content-hash` rows). The saved report has zero findings
in all five agreement families and 30 async warnings. The fresh report has
zero findings in call-site, operation, destructuring, and property; its nine
return-consistency findings are the R6-B saved-artifact delta recorded above.
All 30 async warnings remain, with one unused-directive warning. This is an
analyzer measurement of saved output; it does not verify current transformer
inputs or replace fresh transformer corpus acceptance.

### R12 descriptor proof guard

The test-only descriptor audit in `tests/project-dogfood-boundaries.test.js`
checks unshadowed native `Object.defineProperty`, `Object.defineProperties`,
and `Reflect.defineProperty` calls in the retained-reason owner. It follows
direct `const` aliases and destructured bindings back to parameters, imports,
and captured bindings. A same-function local is private only when a direct
`const` alias chain reaches fresh object, array, function, or class syntax.
Mutable bindings, property
targets, calls, unbound names, and other unproved origins are unresolved and
fail the production-file assertion alongside caller-owned targets.

The audit still recognizes descriptor APIs by lexical identity and the listed
static methods. It does not follow aliases of `Object` or `Reflect`, model
arbitrary heap paths, or define a general dialect mutation rule. Its fixture
includes syntactic probes with unresolved references; those probes are not
authored-valid examples. The guarded production file has no reported writes.

### R13 structural mutation target

The safety rule now reports its existing assignment, update, `delete`,
mutating-method, and `Object.assign` forms when their target has no root
identifier. Named targets retain the existing diagnostic. Unnamed targets use
"this value"; `ignoredParameters` and `ignoredBindings` apply only to a named
root, while `ignoredProperties` applies to both forms. A fresh object or array
literal passed directly to `Object.assign` remains a construction form. The
rule still uses its documented syntactic vocabulary and makes no ownership or
native-capability inference.

Focused proofs cover equivalent bound/call-result receivers, property writes,
updates, deletion, method vocabulary, nested callbacks, all three options,
negative forms, fixtures, and safety-only/combined-rule lint. Authored
temporary-array sorts and reversals became nonmutating `toSorted` and
`toReversed` calls; private dependency indexes and identity/live-iteration
proofs have adjacent reasons. The repository gate passed on Node v22.13.0:
`npm test`, 22 rule highlights and 9 integration fixtures, ESLint with **0
errors and the same 3 unused-directive warnings**, and `git diff --check`.

Read-only safety-rule measurement of the saved `v3MMUR` artifact compared its
prior **0** safety findings with **10 unnamed-target findings** in 123 generated
JavaScript files: 6 instance writes/binds in `IORef.js`, and 4 fresh-array
`reverse` chains in `Array.js`, `NonEmptyArray.js`, `ReadonlyArray.js`, and
`ReadonlyNonEmptyArray.js`. The sorted file/content SHA-256 inventory remained
`a35320934dc2358e4c0b5cf50ac11f9f9b072557e58a81ff1712b97b590add2b`
before and after measurement. These are enforcement findings on saved output,
not a claim that the source operations are semantically wrong. Any transformer
repair needs its own focused proof, full gate, and fresh unchanged-source
corpus measurement.

## Transformer ownership

The governing route is:

```text
Grammar → Policy → Semantics → checker → Understand → Policy → Grammar → placement → proof
```

| Responsibility | Current owner | Boundary to preserve |
| --- | --- | --- |
| Original source discovery | `understand/source-census.js` | One census supplies the 53 collectors. Token/JSDoc, parameter-shape and local semantic walks retain their different stopping laws. |
| Checker-backed facts | `understand/type-evidence.js`, `binding-evidence.js`, `placement-evidence.js` | Original node/symbol identity supplies facts. Names, filenames and equal source ranges cannot lend evidence to a different tree. |
| Recursive type resolution | `understand/type-resolution.js`, `grammar/resolver-predicates.js` | Private recursion contexts replace declaration mutation; structured predicates carry helper requirements without generated-text searches. |
| Agreement publication and finite decisions | `policy/source-agreements.js`, `decision-store.js`, `defaults.js` | All 57 kinds compile once per transform. Later passes consume indexed completed decisions. |
| Placement | `policy/placement.js`, `grammar/`, `members/` | Placement facts complete before transformation. Grammar and final placement make no checker queries or second classifications. |
| Phase ordering | `transforms/typescript/index.js` | Authored rewriting, declaration assembly and final boundary placement remain explicit, ordered phases. |

Paths in the table are relative to `transforms/typescript/` unless fully named.
The [decision catalog](project-decision-domains.json) links current owners and
source references; [lowering patterns](../reference/typescript-lowering-patterns.md)
carry the proved recipes.

The completed replacements removed repeated Policy interpretation, full-store
scans, duplicate binding translation, name-based factory/collection fallbacks,
the unwired collection probe, and forwarding-only recursive wrappers. Exact
source-owned binding/collection decisions now drive their consumers. Shared
forwarding handles identifier/member consumers and block/arrow identity returns
without inventing a default or changing deferred getter timing.

Retain these proved distinctions:

- Tuple return discovery stops at nested functions, methods, accessors and
  constructors. A shared syntax walk cannot change that boundary.
- Source-time rewriting and final annotation consume one collection decision
  at different phases. Async callbacks, captured builders, shadowed Map/Set
  names and colliding claims cannot borrow synchronous admission.
- Original declaration names retained inside generated bindings keep their
  facts. Unknown generated nodes receive no canonical value, guard or admission.
- Compiler omission defaults preserve node identity, printing and failure.
  Fifteen shared omission cases are proved; two native null-failure boundaries
  remain. Matching call syntax alone does not justify consolidation.
- Callback-projection ownership keeps its finite precedence and publication
  phase. Native absence, receivers, evaluation count/order and failure timing
  remain observable.

The [historical packet record](https://github.com/augurone/artikulates-resilient/blob/d34d388387304d17a6e2b3f9751272e300b14b9b/docs/archive/rearchitecture/packets.md)
names each removed owner, its replacement, focused falsifiers and completed
comparison. The [September 30 closeout](https://github.com/augurone/artikulates-resilient/blob/d34d388387304d17a6e2b3f9751272e300b14b9b/docs/archive/rearchitecture/closeout-2026-09-30.md)
preserves prior deletion evidence and counterexamples; its counts are
historical.

## Analyzer and rule ownership

The analyzer remains the independent ESTree agreement-model reference under
`rules/contracts/`; it does not borrow TypeScript checker facts or adapter policy.

| Responsibility | Current owner | Boundary to preserve |
| --- | --- | --- |
| Ordered discovery, completed definitions and lazy flows | `analysis-session.js` | Local rules and project documents retain separate scope and reset lifecycles. Failed construction publishes no partial result. |
| Same-query diagnostics | `diagnostics.js`, `document.js` | Reuse setup within a query while preserving fresh public result layers, live direct queries and getter timing. |
| Evidence and dependency lookup | `evidence.js` | Ordered indexes retain first-candidate and final evidence-ID/edge ordering. Unknown remains unknown. |
| Definition/document variants | `reference-variants.js` | Finite filename configuration shares the mechanism; live maps, identity, eviction and reset laws remain distinct. |
| Lexical bindings, calls, members and patterns | `binding-evidence.js`, `callable-evidence.js`, `member-evidence.js`, `binding-patterns.js` | Rules consume binding/reference and resolved-body evidence instead of name scans or module-spelling exemptions. |

Paths in this table are relative to `rules/contracts/`. Thin rule visitors and
signature support consume these queries. Local unresolved predicate syntax,
stable captured guards, provider getters and async failure ownership retain
separate proofs. Sharing a cache or visitor is lawful only when its identity,
mutation, stopping, unknown and failure laws agree.

The ESLint manager retains bounded passive discovery and parsed dependencies
between source ASTs, while releasing active graphs and document/evidence
variants. Its definition cache retains at most four environments per AST.
Each lint input uses its current AST, even when its text is unchanged; changed
and deleted dependencies invalidate discovery. ESLint requests the current
file's document while still resolving contracts across the full active import
closure. Public whole-project queries retain all documents and findings.

Public APIs can expose mutable results and accessor-backed input. Snapshot
copies, live queries and parser/session ownership must preserve those existing
contracts. Do not replace them with a universal cache or mutable origin graph.

## Proof execution and catalogs

The [proof runbook](PROOF_EXECUTION.md) owns commands, proof selection, corpus
stages, recovery and inspection. Its stage runner records inputs, outputs and
attempt history. Source runtime, lowered runtime, generation, fixing and
read-only verification keep their separate ownership. A failed stage cannot
be presented as completed evidence or silently cause completed work to replay.

Inspector traversal retains ordered extension probing and live breadth-first
imports. One sequential parser session belongs to a workspace; independent
`captureProgram` calls remain isolated. Malformed options and throwing getters
reject asynchronously, as before extraction. The native lint worker replaces
the orphan formatter; the non-public value helper belongs to test support.

Three maintained JSON catalogs have executable consumers:

- [Decision owners](project-decision-domains.json): derived navigation checked
  and refreshed by `npm run proof:catalogs` / `npm run proof:catalogs -- --write`.
- [Authored transformer boundaries](transformer-authored-boundaries.json):
  source ranges/reasons and proof dispositions checked by the exception audit.
- [Source emitters](transformer-source-emitters.json): comment calls and
  directive strings checked by emitter and publication proofs.

Use `node scripts/audit-eslint-exceptions.js --inventory` for current authored
locations, rules, reasons, AST units and paired endpoints. The source directive
is exception authority; catalog rows are evidence. Historical exemption and
lint snapshots are archived because no current test consumes them.

A retained exception names exact rules and a concrete semantic reason beside
one operation: either an adjacent next-line directive or a paired, one-unit
scoped region. Check built-in rule cases first. A passing syntax audit, a
familiar pattern or a smaller lint total cannot establish semantic necessity.
Generated directives, authored boundaries, named rule sites, suppressed
findings and async warnings are different measures.

## R1 declaration policy and R2 bounded admission

The current checkout's integrated R1/R2 packet passed on Node v22.13.0 arm64.
Declaration lifetime and native function facts now come from original
TypeScript nodes and checker symbols; Policy admits an in-place `const`/`let`,
scope-entry `let` with source-position assignments, or an explicit unsupported
result. Native function declarations remain native when binding lifetime or
callable capability is unproved. The post-emission declaration classifier is
removed, and final AST validation rejects any residual `var` declaration.
Focused tests cover F1, earlier and self reads, repeated declarations,
parameter reuse, nested blocks and loops, direct eval, module exposure,
native callable behavior, and unsupported cases. The safety-rule boundary on
parameter-property initialization and mutation of a fresh slice is emitted
beside the exact retained construct.

The full gate passed: `npm test`, 22 rule highlights and 9 integration
fixtures, repository lint with **0 errors and 3 existing unused-directive
warnings**, and `git diff --check`. Fresh unchanged-source fp-ts 2.16.11
evidence is at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-BOtAVB/summary.json`.
All stages completed on upstream commit
`c0a6472121c67a2b083e62fcff13e7d022e39d8f`; its 123 source and 81 test
hashes match accepted `2loHgc`. Source tests passed **1,842 / 1,842** and
lowered tests **1,966 / 1,966**. The native-fixed artifact has **0 lint
errors** and the unchanged **30** async warnings. An AST scan of all 123 raw
and fixed generated JavaScript files found **0 `var` declaration nodes**.

Against historical `2loHgc`, 65 generated JavaScript files changed and native
function declarations increased from 32 to 458. This measures the current
integrated checkout, which also contains earlier uncommitted work, rather than
an isolated R2-only diff. The retention cost is intentional under the bounded
lifetime proof and does not establish that the extra functions are all
irreducible. No commit or release is implied by this local acceptance.

## R4 arity presence and observation measurement

The R4 implementation admits rest-carrier lowering only for a checker-proved
private module function; declarations also require R2's completed
native-expression decision. A private carrier's length proves original tail
presence at the source dispatch
point; the original `arguments.length` is read once for case selection.
Exported, escaped, captured, reflected, hoisted and otherwise unproved
functions retain their source signature. The adapter emits no function-length
restoration call on this route. Focused proofs cover private expressions and
declarations, omission and explicit `undefined`, fallthrough, mutable
arguments length, one accessor read, retained observable signatures, and
source/lowered runtime parity.

The repository gate passed on Node v22.13.0 arm64: `npm test`, 22 rule
highlights and 9 integration fixtures, repository lint with **0 errors and 3
existing unused-directive warnings**, and `git diff --check`. Fresh unchanged
fp-ts 2.16.11 evidence is at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-8XV8pB/summary.json`.
All stages completed. Source runtime passed **1,842 / 1,842** and lowered
runtime passed **1,966 / 1,966**; the 123 source hashes and test hashes match
the accepted R1/R2 artifact `BOtAVB`. Only generated `function.js` changed:
exported `flow` and `pipe` retain their original formals, and their generated
`Object.defineProperty(..., "length", ...)` calls disappeared.

This is **not zero-error corpus acceptance**. The native-fixed output reports
**417 `resilient/signature-contract-call-site` errors**, all from calls to the
retained `pipe` (347) and `flow` (70) signatures across 58 files; the existing
**30** async warnings remain. The accepted R1/R2 artifact had zero fixed
errors. The portable call-site rule sees the erased optional tail as required
after source arity is retained. This is the measured coverage cost of R4's
necessary metadata and instantiation preservation. Resolve that
agreement-model gap in a separate bounded packet; restoring the unsafe
signature rewrite or adding broad suppressions would invalidate R4's
observation proof.

### Count-dispatch call-site agreement closure (October 3, 2026)

The independent call-site rule now recognizes a narrower, executable arity
agreement for ordinary JavaScript functions that retain their native parameter
list: the first non-directive statement must switch directly on
`arguments.length`; every case test must be a nonnegative integer literal;
the supplied count must have one direct return case; and that return may not
reference omitted formals, the current call's `arguments` object, or direct
`eval`. Arrow functions and local bindings
that shadow `arguments` reject this evidence. Other counts and uncertain cases
keep the existing required-parameter diagnostic. This is a general rule
repair, proved on standalone authored JavaScript, an imported function through
a barrel, and the document API. It does not alter transformer output, weaken
the rule for named corpus functions, or add a suppression.

The full gate passed on Node v22.13.0 arm64: `npm test`, 22 rule highlights
and 9 integration fixtures, repository ESLint with **0 errors and 0 warnings**,
and `git diff --check`. Two obsolete authored call-site directives were removed
after the agreement repair; their parsed exception crosswalk and the emitter
source-position catalog were updated and verified. A read-only relint of
the preceding fresh `W6KzSD` artifact kept all 123 generated JavaScript files
byte-identical (inventory SHA-256
`a166601b22156c713b458cdb3f1f5d10ae89e5f1daa6d188aa639526a0d522e5`)
and changed the observed call-site error count from 417 to 0. Its 30 async
warnings remained; three now-unused directives in that saved fixed output
were diagnostic warnings, not acceptance blockers.

A fresh unchanged-source fp-ts 2.16.11 proof is at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-beWHbU/summary.json`.
All 23 stages completed and `--verify` passed. The upstream commit is
`c0a6472121c67a2b083e62fcff13e7d022e39d8f`; its 123 source and 81 test
file hashes match the preceding fresh proof. Source tests passed
**1,842 / 1,842**, lowered tests
**1,966 / 1,966**. The native-fixed output has **0 errors** in every rule
family and only the unchanged **30 async warnings**. All 123 raw generated
JavaScript files are byte-identical to the preceding `W6KzSD` proof. The
historical R4 result
above remains its own measured intermediate boundary; this fresh integrated
result is the zero-error corpus acceptance boundary for the current checkout.
The 9 return and 10 safety findings in the R7 section were measured only on
older saved output; neither family occurs in this fresh artifact.

## R11 retired authored-ordering helper deletion

R11 removes `orderFunctionBindings`, `orderFunctionDeclarations`, and their
exclusive binding helpers from `transforms/typescript/policy/dependencies.js`.
The package exports the transformer entry point, not these internal helpers;
repository reference search found only their definitions, exports, and obsolete
test calls. P07's authored-order rule remains the replacement: authored
statements retain source order. The production path still calls
`placeGeneratedRuntimeStatements`, which orders generated runtime bindings with
the separate `orderRuntimeBindingStatements`. The shared dependency walker and
active cycle analysis remain in place.

The obsolete helper-only assertions were removed. The retained 4k/8k/12k
runtime-order proof and a direct generated-placement proof cover order, exact
statement identity, duplicate dependency references, and cycle fallback.
The parsed exception crosswalk removed records owned by deleted operations and
kept exact mappings for the 20 surviving boundaries in the dependency module.
The full repository gate passed on Node v22.13.0 arm64: `npm test`, 22 rule
highlights and 9 integration fixtures, repository ESLint with no findings,
and `git diff --check`.

Fresh unchanged-source fp-ts 2.16.11 evidence is at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-VU56il/summary.json`;
all 23 stages completed and `--verify` passed. Its 123-source manifest and
81-test hashes match accepted `beWHbU`. All 123 raw and 123 fixed generated
JavaScript files are byte-identical. All 40 generated JSON reports match after
normalizing only artifact-root paths and runtime timing fields. Source tests
passed **1,842 / 1,842**, lowered tests **1,966 / 1,966**, and native-fixed
lint retained **0 errors** and **30 async warnings**. This accepts the narrow
deletion with unchanged corpus code, reports, and runtime results.

## Current verification boundary and future work

Historical acceptance evidence alone does not accept the current checkout;
the completed R10 current-artifact check below records the latest zero-error
corpus boundary for this integrated checkout. R4's earlier behavior and
coverage measurement remain recorded above.

### R10 completed current-artifact check (October 3, 2026)

The integrated implementation packet passed one complete repository gate on
arm64 Node v22.13.0: `npm test`, `npm run fixtures:check` (22 rule highlights
and 9 integration fixtures), `npx eslint . --ignore-pattern tests/fixtures`
with no findings, and `git diff --check`. The fresh unchanged-source fp-ts
2.16.11 proof is at
`/private/var/folders/pz/6wp6hxds7gl42vnwkyp2w1k00000gn/T/resilient-fp-ts-proof-jUSyaD/summary.json`.
All 23 stages completed and `--verify` passed. The upstream commit is
`c0a6472121c67a2b083e62fcff13e7d022e39d8f`; all 123 source and 81 test
hashes match the preceding accepted `VU56il` artifact. The recorded
implementation-input hashes also match it. Source runtime passed
**1,842 / 1,842** and lowered runtime passed **1,966 / 1,966**, with no
failures or skips. The native-fixed output has **0 errors** and the same
**30 `prefer-async-await` warnings**. All 123 raw and 123 fixed generated
JavaScript files are byte-identical to `VU56il`; all 39 generated non-runtime
JSON reports match after artifact-root normalization. The runtime test report
differs only in artifact paths and timing fields. There is no measured output,
report, lint-family, or runtime delta from that boundary.

A separate read-only ESLint pass over the 123 raw generated files reported
1,018 errors and 695 warnings before native fixing; the warning total includes
665 unused-disable findings and the same 30 async warnings. These are raw
diagnostics, not the native-fixed acceptance totals. The R10 documentation
reconciliation also corrected package navigation: the shipped research and
authoring documents now point to repository URLs for unshipped engineering
records, agent instructions, and essays. `npm pack --dry-run --json` confirmed
the package file list, and a relative-link scan of packaged Markdown found no
missing package targets. These editorial corrections do not change the corpus
implementation inputs. No commit or release is implied by this local check.

### Contract-proof audit follow-up (October 3, 2026)

The audit follow-up corrected the current authored-boundary inventory below
and added focused regressions without changing implementation, configuration,
fixtures, or corpus inputs. R1 now checks compiler-created enum `var` rejection
at ESNext and ES2016 and marker payload preservation at ES2016. R2 now checks
`for-in` and labeled scope-entry `let` cases and executes native-fixed output
for all admitted loop controls, while keeping their independent authored-policy
findings separate. R4 compares native-fixed private-arity execution and checks
a throwing `arguments.length` getter at its source dispatch phase. R7 retains
member-getter versus invocation, earlier-argument failure, await resumption,
finalizer/rethrow, captured-write and opaque-spread controls as regression tests.

On arm64 Node v22.13.0, the complete repository gate passed: `npm test`,
`npm run fixtures:check` (22 rule highlights and 9 integration fixtures),
`npx eslint . --ignore-pattern tests/fixtures` with no findings using an 8 GB
Node heap, and `git diff --check`. The existing `jUSyaD` artifact passed
read-only `--verify` against the unchanged implementation and upstream inputs;
this follow-up claims no new corpus execution or implementation acceptance.

### Runtime and future-work notes

On October 2, 2026, `npm test` in the ordinary shell fails before running the
suite because Node **v21.7.2** is unsupported. Use a supported Node runtime
before interpreting a test result. The current exception audit reports **234
authored boundaries** and **238 named rule sites**; the maintained catalogs
report **57** agreement kinds, **65** comment calls, and **87**
directive-string expressions. These are source inventories, not corpus or
runtime results.

Other behavioral boundaries remain in the current engineering reassessment.
Transformer changes need fresh
unchanged-source corpus execution after the full gate; analyzer-only changes
can measure the unchanged saved artifact as R6-A did. Do not regenerate the
corpus merely to validate editorial reconciliation.

Use supported Node **`^22.13.0 || >=24`** consistently. This host's accepted
runtime is arm64 Node **v22.13.0**:

```sh
export PATH=/Users/delos/.nvm/versions/node/v22.13.0/bin:$PATH
export NODE_OPTIONS=--max-old-space-size=8192
node --version
node -p process.arch
```

The ordinary shell previously selected unsupported v21.7.2 x64. Before corpus
execution, verify actual Rollup loading and esbuild execution with the selected
architecture; the pipeline performs this preflight. Use matching dependencies
or an isolated overlay for a host repair. Preserve shared dependencies and
npm caches, and resume completed evidence instead of repeating it.

Develop focused positive, guarded, rejection and semantic proofs, then run
the full gate for a completed material packet:

```sh
npm test
npm run fixtures:check
npx eslint . --ignore-pattern tests/fixtures
git diff --check
```

Repair a failure and restart the entire gate before corpus measurement.
Transformer replacements, purges and claimed lint repairs require completed
corpus runtime/lint comparison against the accepted baseline. Analyzer/rule
changes require the applicable saved-artifact measurement and broader proof
where their semantics demand it. Editorial-only documentation changes need
source verification, relevant documentation checks and `git diff --check`.
Package changes also require the full gate and packed-consumer verification.

Preserve diagnostic locations/fixes, unknown treatment, receiver/getter timing,
evaluation order/count, iterator liveness, native failure, key/value and builder
identity, callback count, argument order and async/direct-return ownership.
Generated code is a pipeline outcome and read-only measurement artifact.
Never edit it, recognize corpus-specific names, weaken rules or expand
suppressions to obtain acceptance.

The reviewed historical work is complete. There is no pending packet hidden in
historical plans, and no promise of every future source shape or throughput
improvement. Current repairs start with a demonstrated source or consumer
problem, a semantic obligation and focused evidence. Product possibilities are
collected in the [roadmap](roadmap.md); they are not implementation orders.


### Isolated formatter candidate acceptance (October 5, 2026)

The isolated formatter candidate is accepted at identity
`61ced4b7dc7c3845bf120342a6f874d0ea070ac5b6c3ca69fc4b5ce1fd3c912f` in
`/private/tmp/resilient-emission-verification-01a10a32`. This is scoped acceptance of that frozen candidate; no implementation
had yet been copied into the unsplit main workspace. The
[placement acceptance record](RESILIENT_FORMATTER_PLACEMENT_ACCEPTANCE_2026-10-05.md)
contains the admitted/rejected layouts, failed intermediate attempts, complete
proof, and recovery paths.

The full repository gate passed on arm64 Node 22.13.0 with an 8 GB heap. Fresh
artifact `resilient-fp-ts-proof-8Y2iE7` completed all 23 stages and read-only
verification; its 123 source and 81 test hashes match accepted `jUSyaD`.
Source tests passed 1,842/1,842; fixed and unchanged raw output each passed
1,966/1,966, with matching test identities/outcomes and no failures or skips.
All 123 generated files were measured; runtime coverage contains 96 filenames.

Native-fixed output has **0 errors and 30 unchanged async warnings**. Raw errors
fell **1,018 → 30**, warnings **695 → 687**, and the claimed
formatter families **1,015 → 27**, with no per-file family increase.
Only `ReadonlyMap.js` retains a declared mechanical-fix delta. The new placement consumes
existing indexed-read/provider decisions and preserves authored constraints,
neighboring findings, runtime observables, and established helper import order.
The accepted record does not extend to the preserved rejected candidate identities.

Execution speed was unmeasured at that acceptance. Production still fixed every
file; fewer diagnostics did not establish faster execution. CLI/profile
redesign, performance work, broader directive work, workspace integration, and
publication were then parked. The later integration is described above.


### Isolated directive grouping acceptance (October 5, 2026)

The isolated candidate `f66136a567e6f063b859b368143cbf1b0f553dfdb605b39db78ca4c818496b48` is accepted for grouping generated
next-line directives with the same AST owner and the user-requested grouped
comment line-length exception. See the [grouping acceptance record](RESILIENT_DIRECTIVE_GROUPING_ACCEPTANCE_2026-10-05.md)
for its exact scope, preserved evidence, and changed profile. At that
acceptance, implementation remained isolated; it was later integrated as
described above.

The complete gate, offline packed-consumer proof, 23-stage fresh corpus, read-only
verification, and unchanged raw runtime passed. Source tests passed 1,842/1,842;
fixed and raw tests each passed 1,966/1,966. All 123 source and 81 test hashes
match the previous accepted artifact. All 123 generated files were measured;
runtime coverage still contains 96 filenames. Executable tokens and visible and
suppressed non-layout diagnostic targets match across all 123 raw files.

Under the same new profile, raw unused warnings changed 657 →
643, and named unused rule entries changed
727 → 714. Remaining raw
totals are 30 errors / 673 warnings, with no per-file
family increase. Native-fixed output remains 0 errors / 30 async warnings.
This does not establish corpus-wide directive necessity or fixer independence;
643 unused warnings remain. Production still fixes every
file, and no speed improvement was measured.

## Phase 1B integrated acceptance — October 6, 2026

Phase 1B is accepted for `/Users/delos/Sites/artikulates/artikulates-resilient`
on branch `inDev-NotMain`, base `3167541010248110ce1abaa4b097da7cbf3fdc71`.
The [final reconciliation](/private/tmp/resilient-phase1b-acceptance-20261006-pCbu2y/reconciliation.md)
and [independent Phase 1B verdict](/private/tmp/resilient-phase1b-acceptance-20261006-pCbu2y/review.md)
cover the reviewed 19-file integration, indentation correction, four-file
runner repair and final two-file cache cleanup, together with the original
failed execution. The original r4 verdict remains **UNACCEPTED for that
attempt**; its helper-import token mismatch and shared-cache mutation are
preserved. Later runner acceptance alone was not used as the phase verdict.

The reviewed 414-path content identity before this editorial record is
`6ac59ce22b809e6ee43e962a51a8edcae061440945219dc37a7569a1eabc49ab`.
The [final snapshot](/private/tmp/resilient-phase1b-acceptance-20261006-pCbu2y/snapshot-final.json)
records this documentation update separately. Blogs and `.DS_Store` are
excluded. All 19 integration postimages match the reviewed proposal plus
its reviewed indentation correction. The four runner files match
`/private/tmp/resilient-fp-memory-20261006-37YzyV/runner-final.sha256`.
No implementation or dependency changed during this review.

Completed evidence was reused after rechecking actual source, helper,
configuration and dependency identities. The final full repository gate
passed on Node v22.13.0 arm64 with an 8 GB heap. Original 14 focused modules,
81 profile fixtures and packed-consumer compatibility evidence remain valid
for their unchanged exercised inputs. The final accepted/candidate corpora
are `LbW59m` and `QmDGOx` under
`/private/tmp/resilient-fp-memory-20261006-37YzyV/artifacts/`.
Both completed all 256 stages once in a single invocation. Each artifact's
1,855 saved output hashes and complete directory sets verify.

| Phase 1B predicate | Accepted integrated result |
| --- | --- |
| Emission, lint and runtime files | Exactly 123 raw/fixed/baseline/raw-runtime files and 81 unchanged source test files; raw runtime consumes the same immutable raw bytes. |
| Tokens, diagnostics and profiles | Exact raw/fixed executable tokens and visible/suppressed nonlayout targets match the fresh accepted snapshot, with identical helper literals; all effective profiles match historical grouping. |
| Raw lint | 24 errors, 526 unused-directive warning records containing 562 named entries, and the same 30 async warnings; no per-file family increase. |
| Fixed lint | 0 errors and the same 30 async warning identities. |
| Runtime | Exact historical and fresh source 1,842 and raw/fixed 1,966 passing test identities; no failures or skips; the same 96 coverage filenames. |
| Fixer comparison | Full fixer changes 52 files, contained in the accepted 55; restricted mechanical comparison changes only `ReadonlyMap.js`. |
| Positive/negative control | Strict positive comparison passes; saved failed-A1 `Array.js` max-len regression, 3→4, is rejected by the intended per-file predicate. |
| Shared inputs | All 14,942 upstream and 2,581 repository dependency identities unchanged during final execution; runtime caches remain inside artifacts. |
| Recovery | Interrupted-stage/partial-output/SIGTERM controls retained; earlier OOM artifacts resume only unfinished lint, and final completed resume replays no stages. |

The new acceptance review closes the previously unrecorded phase verdict,
named-unused-entry threshold and historical profile/runtime/coverage linkage.
It did not rerun the gate or regenerate corpora without an input change.
Original failures, both checkout archives and later evidence remain intact.
The [original reverse patch](/Users/delos/Sites/artikulates/.work-checkpoints/lowering-integration-20261006-phase1b-r4/preservation/reverse.patch)
is preserved for its matching integration postimages; it does not reverse
later runner or unrelated work.

This milestone does not establish zero raw lint or fixer independence.
The 24 raw errors, unused entries, 52 full-fixer changes, mechanical layout
debt and remaining directive limitations stay explicit. The measured
accepted/candidate peak RSS was 6.900/6.279 GiB on this host; it is not a
general memory guarantee. Phase 1B ends here, with no DEV redesign, next
transformer packet, commit or publication.

## Recovery packet 2 acceptance — October 6, 2026

Packet 2 is accepted for this checkout after the full gate, packed-consumer
checks and [independent acceptance](/private/tmp/resilient-packet2-20261006-VqZdDS/review-final.md).
The [packet outcome](/private/tmp/resilient-packet2-20261006-VqZdDS/outcome.md)
indexes the finite contract, preserved failures, byte proofs, final snapshots
and reviews. Phase 1B remains accepted; its implementation, repaired corpus
runner and historical evidence were preserved.

The exact 414-path material snapshot before this editorial append is
`dad7a28d9ad2b6cec8818e2025825c805effd72dce851ef3ce6871c6f1541e5c`.
Only the lowering CLI, existing fix worker, their registered focused tests,
necessary README documentation and existing packed-consumer check changed.
The final snapshot records this sixth, editorial file separately; blogs and
`.DS_Store` are excluded. The original dirty checkout is preserved in the
packet's `before/`, `start-status.txt` and `start.diff`.

Default lowering publishes completed raw JavaScript without an ESLint worker.
`--report` measures those same bytes read-only and states `fixApplied: false`.
`--fix` explicitly enables the existing optional fixer; `--fix --report`
separates raw, post-fix and published findings, with per-file content hashes,
profiles and actual changed-file counts. The preserved disposable quote
fixture proves default/report byte identity and fix/fix+report byte identity;
its original defective report changed double quotes to single quotes.

Incomplete configuration or coverage, ignored/unsupported input, parse failure
and worker failure return failed lowering rather than clean lint. Focused
controls verify profile and actual parse/rule coverage (including processors),
IPC error propagation, failed spawn, bounded worker shutdown and prior
output/report preservation through staging and publication failures. Ordinary
lint findings remain complete successful measurements with `clean: false`.
Public options, API signatures and consumer configuration discovery remain
compatible.

The final full gate passed on Node v22.13.0 arm64 with an 8 GB heap:
`npm test`, `npm run fixtures:check`,
`npx eslint . --ignore-pattern tests/fixtures` and `git diff --check`.
The exact packed tree passed the unchanged existing consumer contract plus
all four lowering modes and runtime imports of portable object, array and
function helpers. Its 212 packaged files match both checkout and installed
consumer bytes. The first offline install failure and corrected private-cache
retry remain preserved; no peer-resolution bypass or source change was used.
All 2,581 repository dependency identities and indexed historical evidence
remain unchanged.

No new corpus run was required: the unchanged runner uses its own lint path
and calls the transformer directly, without this CLI or worker. Phase 1B's
24 raw errors, 526 unused-directive records/562 named entries, 30 async
warnings, 52 full-fixer changed files, `ReadonlyMap.js` mechanical debt and
123 lint files versus 96 runtime coverage filenames remain explicit.
This packet establishes truthful measurement modes, without claiming zero
raw lint or fixer independence. Packet 2 ends here; no directive-family
cleanup, DEV redesign, transformer packet, commit or publication followed.

## Recovery packet 3A acceptance — October 7, 2026

Packet 3A is accepted for retained indexed-operation generated directive
necessity and placement after the complete gate, fresh corpus comparison and
[independent exact-snapshot acceptance](/private/tmp/resilient-packet3a-green-final-20261007-uZ3ihL/review-final.md).
The [packet outcome](/private/tmp/resilient-packet3a-green-final-20261007-uZ3ihL/outcome.md)
indexes the exact changed files, controls, preserved failures and final
editorial verification. Phase 1B, packet 2, the corpus runner, rules, profiles,
dependencies and unrelated dirty work remain preserved.

The accepted implementation contains 425 paths, with identity
`0127eb6108a7ffa33652db30b376f121303f55b2b22531d7ede46ccd75babddb`
using `sha256(JSON.stringify(rows))`. Its complete nine-file packet diff has
SHA-256 `5ba2c052aaccc6f8dfb9319c35e4ad02916909927df5ab115f16348fee695f2e`.
The [implementation snapshot](/private/tmp/resilient-packet3a-green-final-20261007-uZ3ihL/final-implementation.json)
remained exact through gate, corpus and verdict. The
[final editorial snapshot](/private/tmp/resilient-packet3a-green-final-20261007-uZ3ihL/final-editorial.json)
records only this append separately; all historical text remains byte exact.

Generated directives now follow the completed TypeScript AST owner, with no
ESLint selector in production lowering. Inert parentheses and ordinary
trailing separators keep each retained operation on its directive's physical
target line. A completed computed-property initializer uses a second value
wrapper: the real `{ [keys[i]]: args[i], after: 1 }` counterexample now passes
canonical indentation and native comma rules without fixing. Removing either
directive exposes its intended member finding, while an adjacent unannotated
`host.value` remains active. Getter, ToPropertyKey, null and thrown-failure
traces agree with source execution. Original 27 source counterexamples and
all prior 41 packet cases remain unchanged; the new following-property case
also passes idempotence. Catalogs retain unrelated authored-boundary semantics.

The [full repository gate](/private/tmp/resilient-packet3a-green-final-20261007-uZ3ihL/gate-status.json)
passed on Node v22.13.0 arm64 with an 8 GB heap: `npm test`,
`npm run fixtures:check`, `npx eslint . --ignore-pattern tests/fixtures`
and `git diff --check` each exited 0 with no signal. The unchanged corpus
runner completed fresh
[XIoczU](/private/tmp/resilient-packet3a-green-final-20261007-uZ3ihL/artifacts/resilient-fp-ts-proof-XIoczU/manifest.json)
against latest accepted
[QmDGOx](/private/tmp/resilient-fp-memory-20261006-37YzyV/artifacts/resilient-fp-ts-proof-QmDGOx/manifest.json),
with all 256 stages, 1,855 saved output hashes, 11 directory sets and 378 live
input hashes verified. Both include 123 modules and 81 unchanged source tests;
raw runtime consumes the same immutable raw generated bytes.

| Packet 3A predicate | Accepted baseline → candidate |
| --- | --- |
| Raw lint errors | 24 → 4; 20 max-length errors removed, with no per-file family increase. |
| Unused directives | 526 → 492 warning records; 562 → 528 named rule entries. |
| Async warnings | The same 30 raw and 30 fixed warning identities. |
| Fixed lint errors | 0 → 0. |
| Full fixer | 52 → 50 changed files; candidate changes are a subset of accepted changes. |
| Restricted mechanical fixer | Only `ReadonlyMap.js` changes in each; all 123 output/token/target comparisons pass. |
| Runtime | Source 1,842, raw 1,966 and fixed 1,966 passing tests, with exact accepted identities and no failures, skips or todos; the same 96 coverage filenames. |
| Profiles and diagnostics | 246 profiles, 246 normalized executable-token comparisons and 492 visible/suppressed nonlayout target comparisons pass. |
| Evidence references | 20 rendered hints match independently reconstructed selected provider records, ranges, locations and token anchors before comparison. |
| Directive audit | 214 canonical selected-family directives; 3 authored occurrences preserved. |
| Negative controls | Array max-length 2 → 3, executable import-token mutation and NonEmptyArray line 286 → valid but incorrect line 1 each fail their intended predicate. |

The pinned fp-ts 2.16.11 checkout at commit
`c0a6472121c67a2b083e62fcff13e7d022e39d8f` was recovered with all 206
source/test/package/lock identities matching accepted inputs. Its conventional
physical dependency tree matches all 14,942 accepted entries, including modes
and symlink targets. The 2,581 repository and 13,727 old upstream dependency
identities remain unchanged. Exact restored inputs do not retroactively
restore the damaged historical checkout's live provenance. Three historical
packet-2 CLI input differences already existed at packet start and remain
separate from the authorized transformer changes.

All historical evidence remains intact, including the failed recovery under
`/private/tmp/resilient-packet3a2-20261007-uxc11i78/` and the rejected native-comma
repair under `/private/tmp/resilient-packet3a-green-20261007-s9IN8D/`.
That predecessor's interrupted second gate is explicitly invalid as complete
gate evidence. The final gate and corpus above supply acceptance evidence.

Residual limits remain: programless/missing-checker member findings; safely
rejected authored collision layouts involving multiple members, defaulted or
binding-pattern parameters and competing scopes; the unchanged `residual.js`
ForStatement unused entry; and other-family corpus debt. The four remaining
raw errors are one `no-unneeded-ternary` in `Ord.js`, two
`no-extra-boolean-cast` in `ReadonlyArray.js` and one `operator-linebreak` in
`ReadonlyMap.js`. The 492 unused records/528 named entries, 30 async warnings,
50 full-fixer changed files and `ReadonlyMap.js` mechanical debt remain
explicit. This acceptance does not establish zero raw lint or fixer
independence. Packet 3A ends here, without another family, commit or publication.

## Recovery packet 3B acceptance — October 7, 2026

Packet 3B is accepted for the checker-known lexical-shadow necessity subfamily
of generated runtime-binding directives, after focused proofs, the complete
gate, a fresh corpus comparison and
[independent exact-snapshot acceptance](/private/tmp/resilient-packet3b-20261007-5j1c52ea/review-final.md).
The [packet outcome](/private/tmp/resilient-packet3b-20261007-5j1c52ea/outcome.md)
records scope, all source owners, preserved failures, controls and final
editorial verification. This acceptance covers obsolete module-reference
annotations caused by shadowed bindings; the whole emitter is not canonical.

The original 528 named unused entries were ranked by their actual owning
emitter, including per-rule attribution within grouped warnings. The
[source-owner ledger](/private/tmp/resilient-packet3b-20261007-5j1c52ea/unused-ledger-v2.json)
and [complete ranking](/private/tmp/resilient-packet3b-20261007-5j1c52ea/emitter-ranking-v2.json)
account for all 492 warning records. Final exceptions own 292 entries,
cyclic runtime-binding references 112, retained static member access 52 and
completed return boundaries 25; the other owners account for 47. One grouped
warning spans two owners, so summed owner-warning records differ from the
unique warning count. The initial ranking remains preserved as discovery history.

The selected cyclic emitter previously treated a local callback formal `f`
as a reference to a later top-level `f`. Original checker symbol identities
now establish reference-range to module-statement-range facts once at the
existing analysis boundary. The emitter rejects known mismatched targets
before its existing spelling policy. Both obsolete endpoints disappear.
True eager/deferred forward reads, cycles, imports, completed lifetime
agreements and conservative missing-fact behavior retain their decisions.
No ESLint query was added to production lowering.

The accepted implementation snapshot contains 425 paths with identity
`c62cd6cd4aed098ae2cfabd3be328a71d94dee7843cfe223931db86d1c980fa4`,
using `sha256(JSON.stringify(rows))`; its complete seven-file packet diff has
SHA-256 `b753cf3488ccccc7a62f3651167ec45736cd33e8c4575aa40a543be9781ef047`.
The [implementation snapshot](/private/tmp/resilient-packet3b-20261007-5j1c52ea/final-implementation.json)
remained exact through gate, corpus and review. Three source owners change,
16 direct/public cases are appended to the existing proof file, and three
catalogs refresh coordinates while preserving their metadata. All original
proof bodies remain byte exact. The
[final editorial snapshot](/private/tmp/resilient-packet3b-20261007-5j1c52ea/final-editorial.json)
records only this append separately; historical documentation is preserved.

Focused cases cover local/default/captured bindings, shorthand and property
names, classes and catch bindings, necessary mixed/forward/recursive/hoisted
reads, native TDZ failure, computed-key conversion, getter timing and receiver
identity. Necessary-rule removal, outer-scope unmasking, an unnecessary member,
neighbor findings, authored scopes and formatting/grouping idempotence pass.
Earlier test-harness and source-lint failures remain in the
[focused evidence](/private/tmp/resilient-packet3b-20261007-5j1c52ea/focused-outcome.json).

The [full gate](/private/tmp/resilient-packet3b-20261007-5j1c52ea/gate-status.json)
passed on Node v22.13.0 arm64 with an 8 GB heap: `npm test`,
`npm run fixtures:check`, `npx eslint . --ignore-pattern tests/fixtures`
and `git diff --check` each exited 0 with no signal. The unchanged runner
completed fresh
[NkiUPQ](/private/tmp/resilient-packet3b-20261007-5j1c52ea/artifacts/resilient-fp-ts-proof-NkiUPQ/manifest.json)
against accepted XIoczU using the same pinned fp-ts 2.16.11 checkout and exact
recovered dependencies. All 256 stages, 1,855 output hashes, 11 directory sets
and 378 live input hashes were verified; 123 modules and 81 source tests
remain exact. No dependency installation or runner/profile/rule change occurred.

| Packet 3B predicate | Accepted baseline → candidate |
| --- | --- |
| Unused directives | 492 → 469 warning records; 528 → 505 named rule entries. |
| Selected family | 112 → 89 unused entries; exactly 23 previously-unused canonical pairs removed. |
| Raw/fixed lint | The same four raw errors, 30 raw/fixed async warning identities and zero fixed errors. |
| Full fixer | 50 → 49 changed files; candidate subset, with `Separated.js` leaving the set. |
| Restricted mechanical fixer | Only `ReadonlyMap.js` changes in both; all 123 output/token/target comparisons pass. |
| Runtime | Source 1,842, raw 1,966 and fixed 1,966 passes; exact test identities, no failures/skips/todos and the same 96 coverage filenames. |
| Profiles and diagnostics | 246 profiles, 246 strict executable-token comparisons including parentheses, 492 active/suppressed nonlayout target comparisons and 20 reconstructed provider evidence references. |
| Directive audit | 422 → 399 canonical pairs; every retained pair keeps its token boundaries; 90 protected residual directive records remain identical. |
| Negative controls | Per-file max-length regression, executable import-token mutation, valid but incorrect provider reference and malformed-scope anchor mutation each fail the intended check. |

The [comparison](/private/tmp/resilient-packet3b-20261007-5j1c52ea/reports/comparison.json)
preserves nonselected comment payloads and executable-token anchors, other-emitter
unused target identities and per-file family nonincrease. The
[removed-pair audit](/private/tmp/resilient-packet3b-20261007-5j1c52ea/family-removal-audit.json)
identifies each removed pair in the original selected unused ledger.

Residual limits remain explicit. The other 89 selected-family unused entries
are not resolved by this bounded symbol-mismatch repair. Broad strict audits
failed on four existing unmatched opens: source-lifetime directives in
`ReadonlyMap.js` and `ReadonlySet.js`, and authored-order `union` directives in
`ReadonlySet.js` and `Set.js`. Their exact file, payload, token anchor and scope
classification remain unchanged; new malformed scopes are rejected. The
[residual/failure inventory](/private/tmp/resilient-packet3b-20261007-5j1c52ea/directive-audit-outcome.json)
preserves these findings. Standalone authored EOF closing-comment loss also
predates 3B and remains unchanged in its saved baseline/candidate probe.
The four raw errors, 505 unused entries, 30 async warnings, 49 full-fixer files
and `ReadonlyMap.js` mechanical debt remain. This does not establish zero raw
lint or fixer independence. Packet 3B ends here without another family,
commit or publication.


## Shared directive accumulation acceptance — October 8, 2026

The shared accumulation and statement-placement repair is accepted for the
finite scope in the [recovery checkpoint](LOWERING_RECOVERY_PLAN_2026-10-05.md#current-position--october-8-2026),
with [result](/private/tmp/resilient-accumulation-m45c4jxi/validation-final/result.json),
[comparison](/private/tmp/resilient-accumulation-m45c4jxi/validation-final/reports/comparison-initial.json)
and [independent review](/private/tmp/resilient-accumulation-review-CqREZD/review-final.json).
The software identity is
`4073f40d95be425b514c851b303a265eb06eeaaff1d6a978d5cd6c5918559c8f`.
Eight implementation/test/catalog paths change; these acceptance-document edits
are recorded separately after the software freeze.

Existing operation-boundary placement now gives callable declarations stable
scoped layout independent of rule count. Final next-line grouping canonicalizes
singleton duplicate lists and repeated contributions while retaining distinct
reasons and source trivia. Selected-payload bindings, operational key/value
assignments and static operational member statements feed that existing grouper.
The production diff is 61 additions/42 deletions in two files. Superseded
declaration cardinality and operational static inline paths are removed. Catalog
identities remain stable except retired emitter ID 54; no rule, necessity,
expression, profile or emission-layout implementation changes occur.

Focused direct/public proofs and the independent 12-case exact layout matrix
pass. `npm test`, `npm run fixtures:check`, repository ESLint and `git diff --check`
passed separately on Node v22.13.0 arm64 with an 8 GB heap. The fresh unchanged
runner's [5n8Uhy manifest](/private/tmp/resilient-accumulation-m45c4jxi/validation-final/artifacts/resilient-fp-ts-proof-5n8Uhy/manifest.json)
and [audit](/private/tmp/resilient-accumulation-review-CqREZD/corpus-audit.json)
verify 256 stages, 379 live inputs, 1,855 final output hashes and 11 directory
sets. All 123 source and 81 test hashes, agreements/helpers, runtime identities
(source 1,842; raw/fixed 1,966) and 96 coverage filenames are preserved.

Strict comparison passes 246 token/profile checks, visible/suppressed diagnostic
targets and ordinary/authored comment payloads, anchors, order and multiplicity.
It accounts for 28 exact same-owner generated reason echoes across raw/fixed
modes; duplicate-echo, token, evidence-reference and profile controls reject
mutations. Restricted mechanical fixing remains 0/123. The same three raw
expression errors, 181 unused warning records/205 names (203 generated plus two
inherited), 30 async warnings and 34 full-fixer changed files remain. This is a
placement repair, with no semantic cleanup claim.

Fourteen statement-owned inline occurrences are integrated; six expression-only
inline occurrences and two authored/generated stacked pairs remain. Their
missing lawful emitted span/trivia facts and rejected authored counterexample
are explicit in the checkpoint. This scoped acceptance does not establish
complete directive conformance or full-fixer independence. Original failed
review probes, the test-style gate failure and corrected default-heap focused
failure remain saved. All 15,904 protected inputs, unrelated initial changes and
the pre-existing missing `docs/rules.zip` are preserved. No dependency installation,
commit or publication occurred.


## Remaining shared placement acceptance — October 8, 2026

The [current recovery checkpoint](LOWERING_RECOVERY_PLAN_2026-10-05.md#current-position--october-8-2026)
records the accepted general placement packet at `cf74ac769a92dbaa49ac12c16300a5212a85a7eb50c94ef566257b2e7f5f0b36`. Authored
single-line next-line collisions with disjoint generated rules are reconciled at the exact typed printer
statement occurrence before compiler insertion or erasure. Completed generated
inline trivia migrates after compiler emission ahead of exactly its original
physical target line. This preserves its existing diagnostic set, including
already-covered neighbors, across arrows, conditionals, spreads, arguments and
computed/header expression fallbacks. Existing semantic owners remain authoritative;
there is no library-specific lowering or new ownership/classification system.

All four reversal and two callback corpus owners use this same emitted-line
pattern. The intermediate return-only route was removed; their original producers supply
rules, reasons and provenance without executable rewrites. Compatible coincident
contributions unite, explanations deduplicate and wrap against indentation, and
existing line-sensitive layout protects the exact target. Operational iteration
headers and runtime class heritage also use their existing syntax owners.

Authored-identical or duplicate emitted payloads, overlapping/bare preceding
next-line scopes, overlapping generated entries with distinct unused attribution,
multiline/bare/overlapping authored stacks, payload-interior line starts and insufficient
header width retain original placement. Earlier overlapping inline comments and
authored next-line bridges sharing another executable line also retain their
original endpoints. Quoted names, empty comma entries and justification delimiters
use the shared directive grammar; repeated contributions keep captured authored
payloads and priority. Their concrete endpoint/precedence
requirements and counterexamples are recorded in the checkpoint. Restoring
bare/overlapping authored coverage requires an explicit choice to change the
accepted unused-entry attribution; the guarded stack preserves it. Expression
pairs cannot replace these guards under P03. Original failed catalog and typed
printer validation freezes, focused counterexamples and comparison execution
failures are preserved. The [accepted result](/private/tmp/resilient-placement-_wmw4p50/validation-accepted/result.json),
[strict comparison](/private/tmp/resilient-placement-_wmw4p50/validation-accepted/reports/comparison-accepted.json) and
[independent review](/private/tmp/resilient-placement-review-bER8yd/review-final.json)
record three production files with 309 additions/30 deletions, focused fluency,
all four separate gates and the unchanged fresh Yi3dB7 corpus. Exact tokens,
profiles, comment payloads/scopes/targets, runtime identities and coverage pass;
all four negative controls reject mutations. Restricted mechanical changes remain
0/123; generated inline sites fall 6→0 and authored/generated stacks 2→0.
The three raw errors, 181 unused records/205 names (203 generated plus two
inherited), 30 async warnings and 34 full-fixer files remain unchanged.

The [stabilization assessment](/private/tmp/resilient-release-readiness-20261008/result.json)
validates Analysis, rule code/docs, inspector, fluency summaries and exception
measurement, including packed commands against existing supported dependencies.
Every original consumer assertion and all 214 packaged files are independently
verified. This is bounded stabilization evidence, not fresh-install release
verification or completion of all lowering goals. Acceptance prose changes only
the two checkpoint documents after the software freeze. Protected/unrelated
initial state and absent docs/rules.zip remain intact; no install, version bump,
commit or publication occurred.
