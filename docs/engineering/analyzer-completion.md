# Dialect analyzer capability map and completion plan

The target is **Resilient dialect enforcement**, not a general ECMAScript analyzer.
The analyzer supplies the evidence needed by the existing rules. It does not need
to infer every ordinary JavaScript expression before the dialect can be complete.

The current package has connected rule, analyzer and installed-product paths.
There are also real failures in particular compositions. Passing implementation
regressions did not establish that every required dialect workflow was complete.
Conversely, an unsupported expression does not establish that an entire required
system is missing. Both distinctions govern this plan.

Codex owns implementation, neighboring-case discovery and verification. The user
should not have to supply the regressions that define completion.

## Scope and the meaning of unknown

The authority is [Policy P-01–P-03](../reference/policy.md),
[Semantics S-02–S-10](../reference/semantics.md) and the bounded public questions in
[contracts](../reference/contracts.md). Grammar identifies available source forms;
it is not a promise to interpret all of them.

A repair belongs in this completion plan when it addresses one of these outcomes:

- A rule rejects a valid dialect contract or recommends an invented default,
  validation, or behavior-changing rewrite.
- A rule misses an established contradiction within its supported evidence paths,
  including a known bad contribution beside an unknown one.
- Evidence promised by the dialect is lost across an admitted relationship, such
  as a known callable contract through aliases, properties or returns.
- Ownership, query order, cache reuse, source changes or resource handling changes
  the answer to the same admitted question, or admits an unsafe exception.

An unknown remains acceptable when the consumer lacks the required premise:
external data, mutable/exposed state, an unresolved signature/protocol, or execution
outside the bounded model. It must not validate input, erase independent evidence,
create a false finding, or authorize an unsafe rewrite. Distinguish an unavailable
premise from a lost premise the analyzer already owned.

A useful precision improvement can be optional. It becomes a completion blocker
only with a named dialect obligation, a concrete rule outcome, an owned source
premise and a bounded repair. “Native execution returns 42 but analysis says
unknown” is insufficient on its own. This is not permission to redefine a failing
existing contract as unsupported.

## What is connected end to end

“Connected” below means maintained tests exercise the stated path and actual rule
result; it does not mean every composition passes. The [rule inventory](../../config/rule-inventory.json)
provides per-rule evidence. [Semantic obligations](../../tests/semantic-obligations.test.js)
and [product workflows](../../tests/product-workflows.test.js) run native valid and
invalid examples and check actual configured lint results. The package gate also
runs public and host suites against an isolated installation.

| Workflow and rules | Working consumer path | Remaining closure work |
| --- | --- | --- |
| R01 Source form: no-else, no-nested-if, operator-linebreak, no-falsifiable-property-key | Syntax, lexical identity, key normalization and source locations reach policy findings. [Layout](../../tests/rule-contracts.test.js), [keys](../../tests/rule-contracts.test.js). | Preserve scope/key cases and actual configured severities. No new language execution engine is needed for these rules. |
| R02 Absence/presence: no-null-assignment, no-undefined-assignment, no-undefined-comparison, no-destructuring-fallback, no-length-comparison | Native absence identity and the policy's value/content distinctions reach findings. [Absence](../../tests/signature-policy.test.js), [native identity](../../tests/absence-contracts.test.js). | Explicit null and undefined assignments follow contributing values, including returned/passed record and array contents; undefined assignment and equality tests recognize void. Each source value reports once. Shadowed names, discarded operands, keys, coercing assignments and natural absence remain distinct. Native fixture/API exceptions preserve exact boundary values. |
| R03 Authored signatures: prefer-signature-destructuring, prefer-destructured-member-access, prefer-safe-destructuring-defaults | Declared shapes/defaults, rest exceptions and many guarded callback cases are connected. [Signatures](../../tests/signature-policy.test.js), [use roles](../../tests/consumer-contracts-public.test.js). | Guarded returned callbacks and guards preceding every closed local invocation reach absence consumers. Static computed keys and nested array leaves enforce authored defaults. Root scalar entry executes ordered defaults. Owned flat factory-root and lazy call-valued object defaults share ordered binding publication; nested/computed/rest patterns retain conservative boundaries. |
| R04 Callback safety: no-unguarded-callback-invocation | Direct guards, executable predicates, aliases, many closures, collection uses and local loop guards reach findings. [Callable guards](../../tests/signature-policy.test.js), [use roles](../../tests/consumer-contracts-public.test.js). | The repaired local return/capture paths preserve optional-callback identity. Preserve mutation/publication boundaries; a truthiness check must not become proof of callability. |
| R05 Call contracts: signature-contract-call-site | Known signatures, supplied argument contradictions, supported spread/call/apply layouts and imported callables reach the caller. [Calls](../../tests/call-contracts.test.js), [product workflows](../../tests/product-workflows.test.js). | Closed source-owned captures preserve native call/apply permission, with own-method replacement, alias, escape and receiver controls. Owned local callable selections and closed captured native call/apply reads retain receiver and creating-frame evidence, including repeated calls. Other carrier/exposure paths retain their required lifetime premises. |
| R06 Shape/property contracts: signature-contract-destructuring, signature-contract-property | Owned fields, defaults, absence, record copy/rest and selected patterns reach findings. [Patterns](../../tests/shape-contracts-public.test.js), [field forwarding](../../tests/consumer-contracts-public.test.js). | Nested array and inert computed-key signature leaves use shared owned selections. Closed synchronous local readers retain borrowed payloads only with complete local lifetime proof. Escaping and asynchronous readers remain unproved. |
| R07 Operation contracts: signature-contract-operation | Known receiver families, source-owned normalization, admitted native producers and field/call transport reach wrong-operation findings. [Normalization](../../tests/call-contracts.test.js), [product workflows](../../tests/product-workflows.test.js). | Direct earlier-formal record defaults retain actual fields through the sole-transfer proof, including beside unknown alternatives. Supplied overrides retain their own values; mutation, capture and competing source hazards keep their existing boundaries. Other native API or execution inference remains separate. |
| R08 Return contracts: prefer-falsey-returns, signature-contract-return-consistency | Known normal-return families, bare exits, nullish alternatives and supported abrupt completion reach findings. [Outcomes](../../tests/completion-contracts.test.js), [calls/completions](../../tests/completion-contracts.test.js). | Require known incompatible returns to remain contradictory. Computing recursive results or proving termination is not required to enforce that rule. |
| R09 Transformation ownership: prefer-safe-transformations | Writes, aliases, authored transformation boundaries and configured exceptions reach policy outcomes. [Mutation policy](../../tests/rule-contracts.test.js), [member composition](../../tests/lifetime-contracts.test.js). | Preserve identity and mutation effects. A full local-state interpreter or general heap analysis is not a completion requirement. |
| R10 Traversal policy: prefer-prototype-methods | Collection preference and supported retained-boundary decisions use observable order, termination and effects. [Syntax policy](../../tests/rule-contracts.test.js). | Check retained-loop exception safety and targets. Full switch/loop execution is not required unless a particular policy decision depends on a missing fact. |
| R11 Failure ownership: no-silent-catch | Catch use and failure-ownership policy are connected. [Error policy](../../tests/rule-contracts.test.js). | Preserve error identity, cleanup and meaningful ownership. General destructured-catch value inference is not automatically a blocker. |
| R12 Async ownership: no-unhandled-promise-chain, prefer-async-await | Source/native promise identity, forwarding, ownership and supported aggregate fulfillment/rejection reach consumers. [Promise ownership](../../tests/promise-contracts-public.test.js), [aggregates](../../tests/promise-contracts-public.test.js). | Preserve rejection/cleanup order and distinguish owned promises from arbitrary thenables. Generator execution is not needed to recognize that a generator is not a promise. |

These rows cover every current exported rule ID. Core ESLint restrictions and
preset assembly remain part of configured-product acceptance, rather than new
analyzer inference obligations. Static ESM relationships, configured roots and
installed inspection serve these rows: [module signatures](../../tests/module-contracts-public.test.js),
[roots](../../tests/module-contracts-public.test.js), [inspection](../../tests/installed/inspection.test.js).
They are connected host paths, not substitutes for correct rule outcomes.

The directed enforcement bundle additionally removes blanket ambient-name native
invalidation, admits acquired primitive computed keys for members/construction and
local patterns plus flat ordered object parameters, models native string `split`
results, and rejects known async `forEach` callbacks. Unknown/custom key coercion
and ambiguous rest exclusions remain unproved; this does not accept loss of a
separately owned contradiction. The existing public canary consumes the six
canonical cases and valid neighbors in bad.js. Composed key checks retain order,
failure, unknown alternatives, repeated/shared selections and source revisions.
See the [accountability update](evidence-erasure.md#current-directed-repair-bundle)
for the distinct pre-existing returned rest-carrier gap; this is not foundation
completion.

Configured source policy uses core ESLint to reject traditional authored function
expressions while preserving protocol method/accessor nodes. The analyzer still
consumes those JavaScript source forms; its input model is not a syntax waiver.
Every loop remains a policy finding, even for ordered async or synchronous I/O.
An exact-rule, concrete-reason exception owns any intentional loop.

## Confirmed observations and their actual priority

The review used small native/public-query/rule witnesses. They demonstrate the
listed behavior, not a coverage percentage. Their classification matters more
than how many returned unknown.

| Observation | Dialect consequence | Disposition |
| --- | --- | --- |
| Guarded callbacks returned through local closures previously received an incorrect default finding. | Existing generic invocation evidence was disconnected from declaration consumption; named captured returns also lacked result-consumer links. | Repaired for the cases in [callback result roles](../../tests/consumer-contracts-public.test.js): producer/result/consumer guards, aliases, nested guarded closures and successive local returned-call relays. Full production configuration accepts the valid neighbor; unsafe calls, writes and publication keep their obligations. |
| A returned formal forwarded to an unresolved data consumer could previously lose its absence obligation beside a separate guarded call. | Returning was incorrectly treated as evidence that the next consumer handled absence. | Repaired in the shared result-consumer path. Native-failing formal and captured-return controls now retain the default finding; known guarded consumers remain admitted. |
| An outer known callable reached through call/apply inside a wrapper previously lost its number result. | A later wrong-operation finding was missed. | Repaired for closed source-owned ordinary functions, stable aliases and inline conditional callable alternatives. Per-read native protocol proof rejects overrides, publication and prototype changes. Conditional alternatives through named bindings still lack permission even in the same frame; retain this as a separate repair candidate, not a permanent accepted boundary. |
| A local closure returning a borrowed record previously lost fields while a fresh copy retained them. | Missing borrowed fields could suppress operation and property findings. | Repaired for synchronous local readers whose complete reference set remains direct and whose source payload is unchanged and unexposed. Writes before or after return, aliases, publication, escaping readers and async readers withhold permission. The broader lifetimes remain unproved; callable identity does not substitute for payload ownership. |
| An uncalled returned handler with a computed default previously hid an independent numeric record field and incompatible enclosing returns. | Initializer-only opacity propagated out of the function whose entry was unmodeled. Full production lint missed name.trim() on an explicitly numeric field. | Repaired by confining that opacity. [Initializer regressions](../../tests/entry-contracts.test.js) retain lexical/write barriers and prove actual operation/return findings, valid neighbors and primitive export transport. |
| A function with its own computed default could remain opaque even when an argument was supplied. | Authored entry could suppress known operation findings and ignore default throws. | Root scalar defaults execute in order through shared expression/completion owners, including beside pattern parameters. Defined supplied values skip fallback effects; omitted alternatives retain throws and unknown execution. Earlier formals are available; later formals and body locals remain unavailable. Direct earlier-formal record defaults reuse the sole-transfer proof instead of retiring the source at its own read. Captured or multiply hazardous sources, other pattern-entry forms and skipped effectful defaults retain their existing boundaries. |
| Earlier-parameter defaults and nested/computed patterns lost selected contract evidence. | Incompatible supplied leaves could evade signature-contract-call-site. | Inert known computed keys and nested array/object leaves now select shared field/slot evidence, including holes, literal spreads and joined default alternatives. Unknown keys, arbitrary iterators, rest selections and invalidated owners remain unresolved. Earlier scalar parameter references retain entry order. |
| A dead callback invocation beside a guarded use still affects the absence requirement. Guards after closure creation previously could not establish capture admission. | Every callable source use requires admission, while a closed reader may be provably guarded at every invocation. | Post-creation guards are now admitted only when every acquired local call site is represented under a resolved parent completion and is guarded. Calls before guards, mutation, publication and unmodeled later uses retain obligations. Dead source invocations retain the explicit every-reference policy in the default rule. An executable callable guard that dominates an immutable source use, including nested function-expression creation, supplies that use's admission even when known absence prunes its execution. An unguarded dead use retains its requirement; hypothetical intermediate closure execution cannot establish a contradiction about an unreached ancestor creation. |
| Switch/while/for-of, recursion, generators, method receivers, arguments slots, tagged templates, sorting and extra native APIs have precision limits. | Some examples miss a later operation finding; some retain the finding while completion is incomplete. This is not evidence that the corresponding dialect rule is disconnected. | No blanket completion backlog. Reopen only for a specific required rule contract; general execution modeling is excluded below. |

The repaired rows identify concrete dialect failures and executable regressions.
Fresh broad review additionally found null/undefined container values escaping
assignment enforcement, explicit void missing from undefined comparisons, and a foreign execution incorrectly recovering a
pre-capture escape. [Explicit absence values](../../tests/absence-contracts.test.js)
and [closed capture contracts](../../tests/lifetime-contracts.test.js) cover
these repairs, source locations, native counterexamples and negative controls.
The remaining candidate rows require a concrete consumer obligation and a separately validated bounded repair; their current implementation limits do not establish permanent product acceptance.
They are not already approved architecture projects. Existing admitted unknown
boundaries and the user's narrowed target both remain visible.

Enabling computed scalar defaults also exposed a preexisting flow ownership
defect: later guarded reads could replay a completed local initializer, creating
fresh invocation conditions for the same runtime call. Local declaration initializers
now retain their completed values in the owning execution; later guards select
those values, including the input of an object or array pattern.
[Stored initializer regressions](../../tests/entry-contracts.test.js)
check native invocation counts and bounded independent compositions. The repair
preserves default coverage and ordinary distinct-call identity rather than
restoring opacity or broadening pure-call memoization.

Assignment/container listeners share a contribution-aware traversal with at most
two visits per source node and one report per explicit value. Native fixtures and
compiler absence markers retain exact values under local P-03 explanations;
ordinary optional locals retain natural absence without fabricated defaults.

Natural uninitialized `let` values now retain their declaration-owned absence
through supported local fields, tuples, results and captures. Known unsafe
invocations remain call-site contradictions, including collection callback slots;
guarded consumers preserve absence without a fake callable or boolean default.
TypeScript fresh creation slots use that native grammar where their source
absence and contextual boundary are proved. Assertions do not establish a family,
and an incompatible consumer still reports. Script-global, dynamic, overwritten
and constrained incompatible slots retain their original obligation. These paths
are covered by [natural absence checks](../../tests/absence-contracts.test.js)
and the output-contract oracles below.

Generated exact-undefined defaults now retain their own R02 exception through
printing and fixing. Authored sibling defaults and missing-default obligations
remain visible. Declared `undefined` fields no longer acquire `{}`; optional scalar
undefined parameters retain natural omission and function arity. Native compiler
annotations cross clones through their six owned data properties, preserving
absence and descriptors without general descriptor reflection.
[Output contracts](../../tests/typescript-output-contracts.test.js) and
[generated absence boundaries](../../tests/typescript-emission-contracts-local.test.js)
exercise these consumers and exception scopes.

Additional native and emission observations:

- Closed, uncalled, unpublished synchronous leaf helpers retain acquired native
  hazards only within their own execution. The canonical deferred descriptor
  helper no longer retires `getObject(false)`'s native premise or erases
  independent known conflicts. Reflective lookup itself is not a native
  mutation; unknown results remain unknown at their own boundary. This source
  proof introduces no conditional completion premise; general conditional
  native-exposure sequencing remains unproved. The compiler's explicit
  annotation protocol independently avoids unnecessary reflection in that
  mechanism.
- Authored next-line exceptions on isolated flat object-binding fields retain
  their field identity into final layout. One retained original field, unchanged
  directive multiplicity and matching printed field signatures permit restoring
  that field's boundary. Siblings and closing initializers stay outside the line;
  payload behavior and the independent sibling finding survive raw/fixed output.
  Already-invalid source, ambiguous or changed occurrences acquire no new proof.
  [Directive contracts](../../tests/typescript-directive-contracts.test.js) consume
  the readable emission-authored-field-unit example in bad.js, with a clean
  field-only neighbor and the existing parser-budget oracle. Ignored receipts own
  repair and E acceptance status; source prose alone is not acceptance.

The native-named-selection case in bad.js now composes local selection, repeated
captured native calls and the numeric operation consumer. The local store keeps
receiver evidence; the capture keeps its completed creating-frame value; direct
native receiver reads reuse the closed protocol proof across prior calls. Foreign
calls do not become evidence that can recover a parent's escaped payload. Existing
canary, lifetime and value-case harnesses retain branch choice, generic/actual
queries, invalidation, owned record transport and resource/reuse checks. Ignored
receipts own acceptance; this prose alone does not close E.

The remaining conditional native-exposure work is concrete, not an accepted
permanent product boundary. Its premise remains separate from the closed capture,
generated-default and authored-field exception obligations repaired here.

## Guarded handoff

Start broad: [evidence and query ownership](architecture.md#evidence-and-query-ownership)
is the center. Passive sources own reusable facts and relationships; active
queries own requested facets; call sites own actual inputs, completion and effects;
local functional consumers own agreement. A bundle repairs a demonstrated break
in that contract. It does not expand the language because a synthetic example
returns 42. The capability rows above remain the product scope.

The sequence is **readable examples, test cleanup, ownership repairs, acceptance**.
Use this guide for plans and handoffs, architecture.md for owner contracts, and
README.md for verification policy. Keep engineering explanations on those docs.
bad.js contains code and short explanations of expected outcomes. Inventories,
measurements, hashes and failure receipts belong in ignored .artifacts, not new
engineering reports or exploratory runners.

Current handoff state: bundle B's structural review covers every maintained
family. Entry admission, ordered completion, deferred evidence and stored
initializer reuse share [one suite](../../tests/entry-contracts.test.js). Calls,
completion, absence, signatures, lifetimes, shapes, promises, modules and compiler
contracts now have composed owners, with workspace and installed-package
boundaries preserved. Distinct graph, revision, native, delivery and resource
oracles remain executable; repeated spelling grids and private strategy mirrors
are removed. Illustrative examples remain ordinary comments in bad.js.
The candidate's ignored bundle-B receipt owns its validation status and byte
identity; source review alone does not permit promotion. Keep earlier failed
candidates stopped. Explicitly initialize nvm and select the required Node 22.13.0
before validation, then verify the local native resolver loads without fallback
installation. This execution setup does not amend analyzer evidence or expected
diagnostics. Bundle C uses shared callable source facts to scope native hazards from closed,
uncalled, unpublished synchronous leaves to their own execution. Actual calls,
aliases, publication and unsupported execution keep conservative boundaries.
Family scope permission is separate from callee lookup timing. No conditional
completion premise is added; values.js and outcomes.js keep their projection.
The ignored C receipt owns acceptance and promotion status. Failed candidates
remain stopped; their focused passes are not acceptance.
Bundle D selects the flat factory-root object workflow, using ordered publication
for every formal in an admitted frame. Captured availability is distinct from raw
argument/default evidence: a premature read cannot execute a future default,
and a caught early failure cannot poison a later completed binding or call. The
existing entry suite owns native/public/import/query-order and resource checks;
the public canary owns the numeric operation finding and clean neighbor. The
ignored D receipt owns gate and promotion status. The leaf continuation selects
flat static own-key patterns with call-valued defaults. It shares the existing
omitted-value projection, completion and field publication: supplied fields skip
fallback calls, effects and throws; direct earlier-field reads retain their source
order, and unknown inputs cannot erase an independent known conflict. Nested,
computed and rest patterns, other non-inert leaf expressions and new alias/captured-
writer inference retain their existing boundaries. Ordinary signature lowering can already move a
scalar-default/body-destructuring normalization through its existing owners; that
mechanical form is not evidence that the raw factory-root pattern is supported.

### Pattern register

Canonical source is [bad.js](../../tests/fixtures/bad.js); find the stable comment
IDs below under their owning rules. A listed expected result is not a passing
receipt. Every required failure also needs a fluent neighbor and an explicit
unknown boundary; defaults never validate supplied values.

| Comment ID | Rule and role | Next decision |
| --- | --- | --- |
| native-reflection-control | signature-contract-destructuring; valid normalizer falsely rejected beside deferred reflection | First repair candidate: preserve native premises until an applicable exposure. |
| entry-root-default | signature-contract-operation; factory root default | Selected D workflow: bind completed root evidence before consuming the field; acceptance belongs to the D receipt. |
| entry-binding-availability | signature-contract-operation; premature captured formal and later successful read | All formals publish completed bindings; supplied inputs and default producers cannot bypass availability. |
| entry-leaf-default | signature-contract-operation; lazy field default | Selected D continuation: complete only the omitted leaf's initializer and publish its binding; acceptance belongs to its receipt. |
| entry-leaf-order | signature-contract-operation; composed scalar/formal/field transport | Preserve earlier completed bindings, later-field TDZ and supplied-value skipping in the existing native entry oracle. |
| entry-skipped-throw | signature-contract-operation; adversarial completion control | Protect supplied-value skipping; not a separate feature or suite. |
| entry-formal-alias | signature-contract-operation; selected record-forwarding/default-override workflow | Retain fields at the sole source transfer, preserve supplied overrides and target invalidation, and keep unsafe sources unknown. Existing canary, entry and lifetime owners retain the checks; ignored receipts own acceptance. |
| entry-skipped-write | signature-contract-operation; mutable-boundary control | Not ordinary dialect authoring; no general heap/captured-writer expansion. |
| entry-known-with-unknown | signature-contract-operation; evidence-preservation control | Preserve the independent numeric contribution; external data stays unknown. |

The reflective normalizer is valid source beside an independent numeric operation
error. Unknown reflected values remain unknown without withdrawing the native
receiver requirement. The existing public canary executes that control and a
fully clean valid neighbor. An executable reflective lookup in the combined
fixture also requires its independent numeric finding while the existing
negative anchors remain active.

### Checklist for every bundle

The bundle receipt must link back to this center, the pattern IDs, the relevant
capability row, the shared source owners and the retained executable check.
Child work references that same record and reports back to it; it does not create
another roadmap, private contract or independent definition of completion.

- [ ] Start from the current active filesystem, including all dirty and untracked
  work. Compare with the recorded manifest; preserve and report newer edits.
  Copy to a fresh isolated candidate. Do not reconstruct HEAD, reset, clean,
  stash, switch branches, or modify the active tree before acceptance.
- [ ] State one semantic obligation and its local consumer. Classify the example
  as a required workflow, an adversarial control, or a legitimate unknown.
  Name supplied/omitted behavior, order, throws, TDZ, mutation and publication
  only where they affect that obligation. Do not infer a requirement from a test.
- [ ] Trace producer -> transport -> query -> local judgment. Locate the first
  owner that has sufficient premises. State which stable fact is reused, which
  execution choice remains local, and which revision can invalidate it.
- [ ] State a falsifiable mechanism, affected owners and exclusions before edits.
  Bound new records, invocation work and Boolean work separately. No copied
  histories, alias-driven invocation replay, blanket exposure/opacity, fabricated
  defaults, arbitrary invocation merging or increased heap/performance budgets.
- [ ] Make one coherent change and use existing public/semantic checks. No new
  counterexample suite, campaign, replacement interpreter or unused layer.
  Describe any necessary shared-owner change rather than imposing another
  arbitrary four-/six-file cap or quietly expanding beyond the approved bundle.
- [ ] Run cheap authorized checks first, then one small serial measurement of the
  stated cost question. Warm reads must reuse completed work. A supplied value
  must not execute a skipped default. A passing count is not a performance result.
- [ ] Record exact candidate bytes, observations, limitations and the next action.
  Source review and focused passes are intermediate evidence. Only final required
  acceptance permits guarded promotion and applied verification.

### Bundles and exits

| Bundle | Bounded deliverable | Exit / fast failure |
| --- | --- | --- |
| A: Readable examples | Keep the canonical negative source and useful valid neighbors in bad.js under the correct rule. Label controls and pending expected findings honestly. | Each repair points to an understandable example and dialect obligation; no analyzer change or new suite. Prepared, not accepted. |
| B: Test cleanup | Review existing suites by semantic family. Move counterexample sources to bad.js and reuse the existing public harness. Remove implementation mirrors, duplicate example-only checks and metadata/count assertions without behavioral value. | Every behavioral deletion names its canonical example and retained check; real property checks remain. Completion requires scoped executable checks and required package acceptance on the recorded candidate bytes. |
| C: Native ownership | Repair the real normalizer false finding through acquisition, demand and lifetime premises. Account explicitly for condition retention in values.js and propagation in outcomes.js. | Deferred lookup does not become global exposure; actual reached mutation/publication still retires the affected premise. If completion correlation cannot survive projection, fail here before a full gate. |
| D: Fluent entry | After C is accepted, select the smallest required factory/lazy-default workflow. Reuse ordered entry and binding publication. Replace the corresponding opacity check rather than running overlapping new/legacy execution paths. | Correct supplied/omitted results, abrupt entry and independent evidence; no caller proof enters a generic template. Aliases/captured writers are not automatically added. |
| E: Acceptance | Independent review across the existing dialect capability rows and installed consumers; final required gates, byte verification, guarded promotion and applied verification. | No known in-scope P0–P3 finding, no fluency/resource failure and no stale or unverified installed bytes. |

For B, removed checks assert shared-law and private role labels, coverage-file
existence, incidental rule totals, a duplicate nullish-fact total and fixed host
manifest labels. Semantic fault controls, delivered-rule equality, exact preset
policy, single-census ownership, failure identity and program identity remain.
Census selection and binding references now name concrete source identities so
empty results cannot satisfy order or disjointness checks. Four scalar-entry
examples moved from the entry suite to their rules in bad.js and the existing
public canary harness, retaining native failure checks, valid neighbors and
unknown supplied-input controls. The inventory records each suite's disposition
and the retained assertions. Structural consolidation additionally records why
each removed case is redundant, its canonical comment and its retained decisive
check. The entry/default family has one shared query-order harness and one
adaptive interruption schedule. Root/selected-pattern admission, native actual
results, lexical ownership, unknown/abrupt completion, reached effects and stored
value bounds remain distinct useful properties. No fixture comment is presented
as a passing assertion. The inventory is source-review evidence, not acceptance.
TS-only pipeline inputs may retain their necessary TS fixture; bad.js records the
emitted-JavaScript rule counterexample or a clearly labelled source comment.

### Failure and resource protocol

Complete ordinary syntax, style and source-lint corrections during authoring,
before freezing acceptance bytes. These corrections do not reject a semantic
hypothesis. On a failed semantic or resource pathway, or a failed required gate
after freezing, stop that bundle and its workers. Keep the active checkpoint
unchanged and mark the candidate stopped. Return to the center contract and
canonical example: identify the falsified premise, distinguish a source defect
from an analyzer defect, and propose a different mechanism. Do not continue with
neighbor patches, reinterpret expected outcomes, weaken checks, or restart the
same campaign. A valid boundary or clean review is a legitimate result.

Keep work serial and bounded. The first repair checkpoint has a four-hour effort
ceiling; stop and re-estimate if it cannot produce a reviewable bounded change.
Self-lint means `npm run lint`; it must complete in strictly less than 69 seconds,
with a target of 50 seconds or less. Measure it separately under normal heap and
without NODE_OPTIONS. This threshold does not apply to `npm run check`: that
command has no current elapsed-time budget or timeout. Run `npm run check` to
completion, then `npm run check:fp-ts -- --offline` with no competing tests; the
fp-ts run retains its separate 20-minute outer stop. A failed gate ends the
round; no automatic retries. Use Node 22.13.0. Preserve corpus inputs and
diagnostic baselines.

Both gates and broad independent source/installed review are required for final
semantic acceptance. Require 1818 matching corpus cases, 123 real module loads per
variant, zero post-fix errors and the accepted 30 warnings. Freeze exact bytes,
verify the installed package, compare the active manifest for concurrent edits,
promote only accepted bytes with guards, then verify the applied workspace. Any
subsequent source change invalidates acceptance. Reading this handoff does not
authorize implementation or validation outside the current approved bundle.

## Architectural assessment

The agreement, ownership, demand and revision foundation is connected to consumers.
Maintained tests exercise contradictions beside unknown, query-order independence,
revision invalidation, retry and retention. Those tests protect the relevant laws;
they do not imply complete language coverage or globally linear complexity.

The existing ownership boundaries locate the remaining repairs:

1. **Callable/guard transfer:** model, values, demand, environments and declaration
   consumption must refer to the same producer and invocation through an admitted
   alias/return/capture. The local captured-return repair reconnects those relationships; do not cache a consumer's
   answer in a producer or use one caller's guard for another caller.
2. **Entry admission:** bindings/model currently allow some initializer uncertainty
   to make an entire execution opaque. Initializer-only opacity is now confined to
   its function so deferred defaults cannot hide independent enclosing evidence.
   Root scalar entry now uses ordered shared completion steps. Pattern-entry effects remain conservative; preserve dynamic lookup, TDZ and abrupt entry.
3. **Lifetime and native premises:** acquisition records potential hazards, while
   applicability belongs to the reached execution and requested facet. Reflective
   lookup must not become unconditional global exposure. Completion conditions
   needed for that validity must survive the relevant projection and call boundary.

These are repair questions within existing owners. The evidence does not justify
a replacement analyzer, a general execution interpreter, a recursive fixed-point
engine, or resumable generator architecture for dialect completion. Any proposed
shared change must name the rule outcome it repairs and its work/storage cost
before implementation.

## Concrete completion sequence

Follow bundles A-E in the [guarded handoff](#guarded-handoff). The capability map
and confirmed observations identify obligations; they are not a second sequence
or authorization to implement every precision improvement. Retain admitted
transport and bounded entry repairs, and require independent dialect acceptance
across all rows. A new qualifying defect reopens its owner; an unrelated inference
wish does not reopen the product target. The earlier broad language-expansion
list was not a valid basis for weeks of required work.

## Verification and stopping rule

For a semantic change, use native behavior where it establishes the premise,
public evidence, the actual rule/location, and a clean full-production neighbor.
Keep independent known/conflicting evidence beside unknown; test stale guards,
mutation, escape, abrupt prefixes, generic/actual ordering and changed-source
sessions where the repaired relationship can be affected. An independent final
review must choose cases from the dialect obligations, not only replay the fix.

State work/storage expectations for changed owners. Share producer/invocation
relationships rather than copying histories or expanding paths. Check width,
depth, warm reuse, interruption and release for the changed mechanism. Retain
the self-lint threshold below 69 seconds for `npm run lint`; the target is 50
seconds or less. This is measured separately and does not impose a time budget
on `npm run check`. Do not infer a whole-analyzer memory bound from a few samples.

Every repair is developed and validated in isolation. Freeze the final bytes;
run Node 22.13.0, normal heap, no NODE_OPTIONS: npm run check, then
npm run check:fp-ts -- --offline with no competing tests. Preserve the corpus;
require 1818 matching cases, 123 actual module loads per variant, zero post-fix
errors and exactly 30 accepted prefer-async-await warnings. Retain receipts/output,
check for concurrent edits, promote exact validated bytes and revalidate the
applied workspace. Never rerun a historical promotion script.

"Complete" means the agreed dialect obligations have no known unresolved defect
and have passed bundle E. It does not mean all JavaScript results are inferable. Report
which obligation was closed, what consumer behavior changed, which unknowns
remain legitimate, and what evidence supports the result. Passing totals alone
are not that report. Codex owns discovery and verification; user-found examples
are additional input, not the acceptance process.

## Explicitly outside this completion plan

General recursive result solving; generator/async-generator execution; arbitrary
this/arguments or constructor semantics; exhaustive switch/loop interpretation;
complete native-library models; general heap/alias solving; runtime external-data
validation; framework invocation inference; and cross-edit incremental sessions.
A narrowly required fact about one of these forms may be added for a named dialect
rule, without adopting its general execution model.

Direct TS/TSX ESLint remains outside the prior user-defined scope. Compiler
lowering is a separate product surface; shared analyzer repairs still preserve its
required acceptance. Policy-restricted classes and optional chaining need their
existing syntax findings, not complete value interpretation. None of these
exclusions permits weakening an already promised or demonstrated dialect contract.
