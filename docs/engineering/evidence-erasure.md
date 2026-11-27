# Evidence erasure: accountability report

## Current accountability and pickup: 2026-11-24

This section supersedes earlier proposals in this report wherever they assume
prototype monkey-patching is an analyzer requirement. The user stated:
"Prototype monkey patches were never in scope." Do not infer prototype changes
from an ambient read, an unknown call, a constructor reference, or publication.
Ordinary owned-value mutation, own-method replacement, authored custom
prototypes, static native replacement, and actual execution/completion remain
separate questions; this scope decision does not make them harmless.

### What the assistant got wrong

The assistant responded to that scope decision with a broad candidate that
removed native-family invalidation across acquisition, model, and demand, and
changed or removed many tests. It did not establish that each removed premise
was solely about prototype monkey patches. That exceeded the request and
endangered other supported contracts. The candidate failed the dialect gate and
was stopped; none of its analyzer, test, or documentation changes was promoted.
Do not copy it, patch it forward, or treat its focused passes as acceptance.

The assistant also said the user's selected `loadCount` example was unrelated
without inspecting it. That was wrong: it is an existing, explicitly documented
promise-ownership gap. The following observations were made afterward on the
active tree, not on the stopped candidate.

### The selected dropped-promise example

The user selected the `loadCount` block under `no-unhandled-promise-chain` in
[bad.js](../../tests/fixtures/bad.js). With the repository ESLint configuration,
the complete saved fixture produced **no diagnostics on the selected block**.
The three unowned forms are a conditional expression, a short-circuit expression,
and a discarded array produced by `map` whose callback returns promises. The
last result is an array, not itself a promise; its elements still need an owner.

Read-only isolated controls using that same configuration showed:

| Source form | `no-unhandled-promise-chain` findings |
| --- | --- |
| `loadCount()` as a statement, with `loadCount` known async | one |
| `enabled ? loadCount() : 0`, with `enabled` true | none |
| `enabled && loadCount()`, with `enabled` true | none |
| `[1].map(() => loadCount())` discarded | none |
| `await loadCount()` or `await Promise.all([1].map(() => loadCount()))` | none |

The public analyzer gives two different observations, not one proved root cause.
[promise-ownership.js](../../analysis/analyzer/promise-ownership.js) acquires
one use per expression statement and marks only call/new forms (or an optional
call) eligible for the demand query. The conditional and logical controls return
`outside-call-boundary` from [analysis.js](../../analysis/analyzer/analysis.js).
The discarded `map` call is eligible, but its result is classified
`non-promise-result`; the public query does not establish ownership of its
promise-valued elements. Trace the producer, reached branch, carrier and final
consumer before proposing a shared repair.

The repair must report known unowned work when its path is reached while
retaining explicit `await`, return, handling, intentional `void`, and consumed
`Promise.all` cases. An async `map` callback is not itself an error: an
observed aggregate can own its results. Do not invent a promise from unknown
data, report work on an unreachable branch, change completion order, or confuse
this case with the separate async-`forEach` policy. Use the existing public
promise ownership harness and meaningful valid neighbors; no new matrix or
per-example suite.

### Failed candidate and unverified acceptance

- The stopped candidate's standalone `npm run lint` emitted five errors:
  one in [typescript-project.js](../../integrations/typescript-project.js),
  one in [typescript-directive-contracts.test.js](../../tests/typescript-directive-contracts.test.js),
  two in [typescript-value-contracts.test.js](../../tests/typescript-value-contracts.test.js),
  and one in [source-analysis.js](../../transforms/typescript/understand/source-analysis.js).
  They have not all been classified. In particular, the `include.some` and
  `parameters.map` findings need their preceding guards examined; do not
  dismiss or suppress the remaining findings to make a gate pass.
- The lint script reported 69,354.7 ms and the outer elapsed time was 70.36 s:
  both exceed the strict under-69-second standalone limit. This observation
  does not by itself identify a performance cause.
- The candidate received neither a passing `npm run check` nor the required
  fp-ts run. The earlier uncommitted reflection changes also have no recorded
  final-tree fp-ts acceptance. Do not claim transformer acceptance.
- The earlier editor report that `count.trim()` was not marked is unresolved.
  The current configured CLI reports the numeric operation in the saved
  ambient canary both with and without `void [globalThis]`. That does not prove
  the editor delivered the finding or that an editor restart fixed it.

### Active workspace and next action

Before this documentation update, the active tree had uncommitted changes in
[native-members.js](../../analysis/analyzer/native-members.js),
[architecture.md](architecture.md), [bad.js](../../tests/fixtures/bad.js), and
[rule-canary.json](../../tests/fixtures/rule-canary.json). Preserve them and
recheck the live tree; do not restore an older manifest over concurrent edits.
Previously requested O1/O2 opacity, X3-X8 exposure, switch-return, and
returned-rest work remains open. O3 had an earlier computed-key repair; verify
its scope on the current bytes rather than assuming this candidate closed it.

The active public canary currently fails at `operator-placement`: the fixture's
`+ 2` no longer matches the old invalid anchor. After that mismatch was
reconciled in an isolated copy, two reflection canary markers were also missing
from the fixture although their entries remain in `rule-canary.json`. The user
explicitly authorized restoring those two reflection examples, without changing
other fixture edits; this has not yet been done in the active tree. Keep
meaningful binary-operator behavior covered in an existing test rather than
weakening assertions or overwriting the user's edit.

For the next implementation, start with the selected promise ownership case and
the public rule outcome. Treat prototype-patch cleanup as a separately scoped
change, not a license to remove general evidence or test controls. State the
ownership invariant, affected owners and expected work/storage cost before
editing. Follow the guarded handoff in
[analyzer-completion.md](analyzer-completion.md): develop in a fresh isolated
candidate, stop on a failed semantic or resource pathway, and promote only
verified bytes while preserving concurrent edits.

Use Node 22.13.0 and the local corpus. For shared-analysis or lowering changes,
measure standalone `npm run lint` below 69 seconds, run `npm run check`, then
run `npm run check:fp-ts -- --offline` serially. The fp-ts receipt must show
1,818 matching cases, 123 physical module loads per variant, zero post-fix
errors, and only the accepted 30 `resilient/prefer-async-await` warnings.
Retain the output directory and receipt; never refresh corpus inputs or
diagnostic baselines merely to pass.

## Earlier investigation baseline

Status: open; reflection and ambient lookup repairs do not close every case.
Baseline: commit `32bda6e`. Unless identified as a later outcome,
measurements, line numbers and reproduction results below were taken on those
exact bytes (`tests/fixtures/bad.js` SHA-256
`505e756ac112e1d7575cad2891ae26c0aed08e6e8ab19f1d13689b6c7a0b559b`).
An agent working on this report cites findings against `32bda6e` and states the
commit its own results were taken on. Before editing, re-read each cited line at
the working commit; if one has moved, update the citation in the same change.

## The defect

A known, reached contradiction must report unless a *legitimate* premise makes
it unknown ([semantics](../reference/semantics.md), and
[architecture](architecture.md#meaning-of-a-result)). Today, a single construct
anywhere in a module (or in a module it imports) turns every property and
operation contradiction in that module into unknown. That includes reads
sequenced *before* the construct and reads in unrelated function bodies. Most of
these constructs write nothing. That is fabricated unknown: lost evidence, not a
conservative boundary.

### Current directed repair bundle

This is the earlier bundle; the current scope and pickup are stated above.

The subsequent user-directed bundle removes the unbound ambient-name exposure
entirely, uses core ESLint to reject traditional authored function expressions,
and joins computed key selection, native `split` and synchronous `forEach`
requirements to existing shared evidence. It does not implement a general heap,
prototype-override interpreter, or the deferred switch-return inference.
The six canonical cases under their rules in [bad.js](../../tests/fixtures/bad.js)
are consumed by the existing public canary with fluent valid neighbors; native
TypeErrors are required for the five operation cases. The async callback case is
a dialect completion-ownership violation, not a JavaScript syntax error.

Computed key normalization belongs to
[estree-properties.js](../../analysis/estree-properties.js) line 3;
guarded acquisition and memoization belong to
[demand.js](../../analysis/analyzer/demand.js) lines 639 and 666, with pattern order owned by
[patterns.js](../../analysis/analyzer/patterns.js) line 158 and
[flow.js](../../analysis/analyzer/flow.js). This reuses constants and absence in
the existing value graph instead of replaying aliases. Normalization has
O(C + K + G) work/storage for contributing records C, distinct names K and shared
decision-operator work G; a selection adds K guarded consumers and the existing
field solver's work. These bounds do not establish whole-lint speed.
The key owner's composed checks preserve shared/successive selections, independent
joins, unknown alternatives, query order, warm results and source revisions.
Unproved object coercion, custom splitters and ambiguous rest exclusion sets
remain explicit unknown boundaries, not manufactured defaults.

A separate pre-existing source-rest carrier gap reproduced in both the active
baseline and candidate without computed keys: returning `{ selected, rest }`,
then aliasing/reading the returned `rest`, can erase a known primitive sibling.
Its readable specimen is retained beside the operation gaps in
[bad.js](../../tests/fixtures/bad.js). It is not accepted as correct and this
bundle must not be described as foundation completion.

All loops still require an exact-rule concrete exception; async/I/O is not an
automatic waiver. `filter(Boolean)` is valid Boolean coercion. Object content is
a different predicate, provided by the existing public `hasContent` utility.
Final gates and exact promoted hashes belong to the acceptance receipt; earlier
passes below are not acceptance for these new bytes. The separately measured
self-lint must stay strictly below 69 seconds; `check` has no elapsed-time budget.

[analyzer-completion.md](analyzer-completion.md) already states the contract:
"Reflective lookup must not become unconditional global exposure."
[architecture.md](architecture.md) admits "General conditional native-exposure
sequencing remains conservative." This report separates the part of that which
has a reason from the part which does not.

## Measured scope

Method: append (and separately prepend) one known-bad probe per finding kind to
an unmodified module, lint it with the repository config, and check whether each
probe's owning rule still reports. A control module reports all probes.

| Population | Modules losing at least one finding | Detail |
|---|---|---|
| `analysis/`, `transforms/`, `scripts/`, `index.js` (4 probe kinds) | 121 of 198 | boolean operation 118, number operation 85, property 28, string operation 28 |
| `analysis/` (11 probe kinds) | 52 of 106 | Among those probes, only property and operation findings are lost. |

This does not bound effects on composed programs. Appending a lookup of a
fresh record's own data property to the complete `bad.js` fixture also erased
existing call-site, destructuring and return-consistency findings, alongside
property and operation findings.

- Prepending and appending lose exactly the same findings in every module, so
  order is ignored.
- Every loss traced to an exposure or opacity event below. No loss was
  unexplained.
- Attribution, counted per module and cause: boolean exposure from an import 121,
  number exposure from an import 68, own boolean exposure 59, unconditional
  `all` exposure from an import 21, own unconditional `all` exposure 9.

Not measured: losses confined within one function body, and populations outside
this package. The claim is exhaustive only for module-level property and
operation findings in this package, over the constructs probed (about 60 legal
constructs, listed under [Constructs verified harmless](#constructs-verified-harmless)).

## Two root mechanisms

**M1. Native exposure is recorded without kind, scope or order.**
[native-boundaries.js](../../analysis/analyzer/native-boundaries.js) `expose`
(line 25) writes into one map per analysis, `exposedIntrinsics` (line 17).
`call = false` there means *unconditional*. The demand query `invalid`
([demand.js](../../analysis/analyzer/demand.js) lines 2504–2520) retires a
family's conflicts (line 2527) when any of these hold:

- the exposure is unconditional (line 2508);
- it sits in an `externalExecutions` member (line 2513);
- its contexts share a boundary with the read. Line 2503 adds *every* module
  root's boundary, so any module matches.

No path asks whether the exposure can write, whether it can run before the read,
or which module owns it.

**M2. Local opacity propagates to every enclosing execution.**
In [bindings.js](../../analysis/analyzer/bindings.js), every opaque execution
becomes an opaque capability (line 547). The loop at lines 576–580 then
propagates capabilities up through `executionParents` to the module root. An
opaque module root is `supported: false`
([model.js](../../analysis/analyzer/model.js) line 796), so its findings are
dropped. The comment at line 562 gives the legitimate reason: dynamic lookup can
introduce an enclosing binding. Only `eval` and `with` (`observeDynamic`,
line 207) can do that.

## Cases

Each case lists the measured trigger and loss, a hypothesis backed by the cited
code, the legitimate part to preserve, and the proposed repair. The
[`bad.js`](../../tests/fixtures/bad.js) comment block records the
cases. Cases that would erase the file's own canary findings remain comments;
the reflective-lookup case also has an executable fixture assertion.

Loss columns: **mod** = module-level reads before and after; **fn** = reads inside
an unrelated function body.

### X1. Ambient read

- **Trigger:** `void [globalThis.flag];` (also `window.x` or `global.x`).
- **Loss:** property and operation, mod and fn.
- **Hypothesis:** `native-boundaries.js` line 96 calls
  `expose(name, false, …)` for any unbound ambient name. `globalThis` has no
  family in `intrinsicFamilies` ([native-members.js](../../analysis/analyzer/native-members.js)
  line 25), so line 26 assigns `'all'` with `call = false`, which is
  unconditional for every family.
- **Legitimate part:** an ambient read can execute a getter or yield unknown
  data. An actual write or publication of an owned value retains its own
  boundary; an unknown call does not prove a native prototype was overridden.
- **Repair:** classify the lookup and any actual affected value separately.
  Do not retire unrelated native families merely because unknown code runs.
- **Later outcome:** the ambient-name exposure branch has been removed. The
  canonical numeric `trim` beside `globalThis` reports; changing only its producer
  to text is accepted. Actual tracked writes/publication keep their boundaries.

### X2. Reflective lookup

- **Trigger:** `Reflect.get(r, 'a')`, `Object.getPrototypeOf(r)`,
  `Object.getOwnPropertyDescriptor(s)(r)`.
- **Loss:** property and operation, mod and fn.
- **Hypothesis:** `reflectiveMembers` (native-members.js line 21) marks these as
  exposing. `native-boundaries.js` line 104 exposes the namespace
  unconditionally. `Reflect` and `Object` have no family, so the exposure falls
  to `'all'`. The repository's own `Reflect.get(node, 'value')` reads cause
  most of the 30 unconditional `all` attributions (demand.js, values.js,
  outcomes.js, record-fields.js and others). Their syntax alone does not prove
  that their receivers are plain data records.
- **Legitimate part:** an unknown receiver can invoke a getter or proxy trap,
  even for a known non-prototype key. Its result and completion remain unknown
  unless supported evidence establishes them.
- **Dialect premise:** native prototype operations require the receiver family
  defined by the dialect. An unrelated unknown call or a reflective lookup is
  not evidence that a built-in prototype has been deliberately overridden.
  `(42).trim()` is a contradiction even after `configure()`.
- **Repair hypothesis:** selecting or invoking a reflective method does not
  itself expose every intrinsic. Preserve actual acquired native references,
  tracked writes and publication boundaries independently; do not infer a
  reflective result or an external object's fields from its spelling.
- **Later outcome:** [native-boundaries.js](../../analysis/analyzer/native-boundaries.js)
  now distinguishes reflective selections, including aliases, computed keys and
  destructuring, from namespace exposure. In the complete configured `bad.js`,
  all 268 prior findings remained and the numeric conflict added one finding.
  A packed callback also retains its known noncallable contradiction beside an
  unknown reflective result; its guarded neighbor remains valid. Unknown results,
  ordinary object mutations and custom prototypes retain their own boundaries.
- **Still open:** known array and boolean results of several reflective calls are
  not acquired, so their invalid consumers remain unreported. Counterexamples
  are recorded under `signature-contract-operation` in
  [bad.js](../../tests/fixtures/bad.js). Native factory failures also require
  attention: a known throwing call must not establish an unreachable consumer.

### X3. Prototype access member

- **Trigger:** `value.constructor === Object` or `x.__proto__`.
- **Loss:** property and operation, mod and fn. If the reading function is never
  called, nothing is lost: dormant executions are already scoped (line 29).
- **Hypothesis:** `native-boundaries.js` line 48 exposes every
  `prototypeAccessMembers` (native-members.js line 20) read unconditionally,
  with family `'all'`.
- **Scope correction:** prototype monkey patches are not a supported reason
  for retiring unrelated evidence. Ordinary owned-value effects and authored
  custom protocols remain separate.
- **Repair question:** remove the unowned blanket exposure at its source while
  retaining those separately supported boundaries.

### X4. `Object` or `Symbol` used as a value

- **Trigger:** `[{}].map(Object.freeze)`, `Object.keys` as a value, or
  `Symbol.iterator`.
- **Loss:** property and operation, mod and fn. `Symbol(…)` and `Symbol.for(…)`
  calls lose nothing.
- **Hypothesis:** both are in the `intrinsics` set (line 12) but missing from
  `intrinsicFamilies`. Any non-invoking use reaches line 130, and the missing
  family becomes `'all'` at line 26. Reading a well-known symbol or passing a
  pure function as a callback cannot write.
- **Repair:**
  - Give `Object` an `object` family, whose writes affect property findings.
  - `Symbol` needs no prototype premise for these rules.
  - Treat native callbacks on a known array receiver as calls, not escapes
    (see X6).

### X5. Tagged template with an intrinsic tag

- **Trigger:** `` String.raw`a` ``.
- **Loss:** string operations, mod and fn.
- **Hypothesis:** `native-boundaries.js` line 114 recognises only
  `CallExpression` and `NewExpression` as invoking. A tag is therefore treated as
  an escape of `String` at line 130. Elsewhere,
  [argument-positions.js](../../analysis/analyzer/argument-positions.js) line 131
  already treats `TaggedTemplateExpression` as a direct call.
- **Repair:** add tag position to `invoking`. Share one call-shape predicate
  with argument-positions.js; see U1.

### X6. Intrinsic callback inside an exported function

- **Trigger:** `export const keep = (items = []) => items.filter(Boolean);` (also
  `.map(String)` and `.every(Number.isSafeInteger)`).
- **Loss:** that family's operations, mod. The module's own exposure accounts
  for 59 boolean attributions.
- **Hypothesis:**
  - Line 130 records the exposure with `call` set to the enclosing call.
  - The exported function is in `externalExecutions`
    ([callables.js](../../analysis/analyzer/callables.js) line 97, expanded
    through callees at model.js lines 862–869).
  - demand.js line 2513 then returns `true` regardless of where or when the
    read runs.
  - Module-level reads run during module evaluation, before any external caller
    can invoke the export. Calls to native collection methods on a known array
    receiver do not hand the callback to unknown code.
- **Legitimate part:**
  - The receiver is an unknown parameter, so an exotic `filter` could write
    through `Boolean`.
  - That only matters inside executions the export reaches *after* it is
    called. It also matters if the module calls the export itself at module
    level, which `invocationSources` already records.
- **Repair:**
  - Scope the exposure to executions reached from the export's invocation,
    which is the existing `callees` traversal.
  - Treat a native method call on a known array family as a call.
  - Check circular imports: a cycle can call an export before its module
    finishes evaluating.

### X7. Exposure crosses an import

- **Trigger:** `import { keep } from './keeper.js';` where the provider is X2 or
  X6. This happens even when the import is never called.
- **Loss:** the importer's property and operation findings (boolean imported 121,
  number 68, `all` 21).
- **Hypothesis:** imported providers join the same analysis as additional module
  roots (model.js line 794). Their exposures go into the same
  `exposedIntrinsics` map, and demand.js line 2503 adds every module root's
  boundary to every member query. A provider's exported-function body therefore
  matches an importer read, though nothing in the importer reaches it.
- **Legitimate part:** a provider's *module-level* write runs before the
  importer's body (in evaluation order) and should still apply.
- **Repair:**
  - Key exposures by owning module root.
  - An importer read is affected only by provider module-evaluation exposures,
    or by exposures in executions the importer actually invokes. Use the
    invocation edges in `invocationSources`.

### X8. Order of a historical exposure is ignored

- **Trigger:** `globalThis.configure();` or `Object.prototype.x = 1;` placed
  after a read. (The prototype write is itself reported by
  prefer-safe-transformations.)
- **Loss:** property and operation, mod (before *and* after) and fn.
- **Hypothesis:** `exposureFor` (model.js line 871) and demand.js `invalid`
  carry `ordered` and `repeated`, but module-level reads compare only boundaries.
  No check asks whether the read precedes the exposure in the module-evaluation
  prefix (`statementPrefixes` and `capabilityPrefixes`, model.js lines 825–853).
- **Scope correction:** a reached effect on an owned or published ordinary
  value can retire that value's evidence after the effect. Unknown code is not
  evidence of a native prototype override; prototype monkey patches are outside
  the dialect.
- **Repair question:** do not build a prototype-patch ordering interpreter.
  Any ordering work must instead establish a specific supported owned-value
  effect and preserve its completion conditions.

### O1. `arguments` other than `.length`

- **Trigger:** `const first = function () { return arguments[0]; };`, even if it
  is never called.
- **Loss:** property and operation, mod. Unrelated function bodies are kept.
- **Hypothesis:**
  - bindings.js line 509 makes the owning execution opaque.
  - Line 547 turns that into a capability.
  - Lines 576–580 lift it to the module root, which is then unsupported.
  - ES modules are strict, so `arguments` cannot alias enclosing bindings.
  - An arrow's `arguments` belongs to its argument owner (line 312), not to the
    module.
- **Repair:** opacity stays in the argument-owning execution. Only `eval` and
  `with` lift.

### O2. Destructured `catch` parameter

- **Trigger:** `catch ({ message = '' })` in any function, called or not.
- **Loss:** property and operation, mod.
- **Hypothesis:** bindings.js line 341 marks the enclosing execution opaque for
  any destructured catch parameter. Lines 547 and 576–580 lift that to the root.
  Pattern defaults and getters affect only the handler's own completion.
- **Repair:** limit opacity to the catch clause's execution slice. At most,
  extend it to its function. Never lift it.

### O3. Computed key in a parameter pattern

- **Trigger:** `({ [key]: picked = '' } = {}) => picked`.
- **Loss:** property and operation, mod.
- **Hypothesis:** `opaquePatterns` (bindings.js line 28) marks the function opaque
  (line 314), and propagation lifts it. Line 17 (duplicate parameter names) is a
  syntax error in strict ES modules, so it is unreachable for this dialect.
- **Repair:** same as O2. The computed key belongs to the function's own entry.

### Excluded: classes

Classes are illegal in authored Resilient (policy, `no-restricted-syntax`). They
come only from externals normalized at the edges. The class opacity at
bindings.js line 381 is not a defect. Do not add class cases.

## Proposed utilities

These are hypotheses, not approved mechanisms or established work bounds.
Any retained utility must give a repeated mechanism one focused owner within an
existing module. None justifies a new layer.

| Id | Utility | Owner | Replaces | Contract | Work and storage |
|---|---|---|---|---|---|
| U1 | `intrinsicUseKind(node)` returning `lookup`, `invoke`, `write` or `escape` | native-boundaries.js | the inline decisions at lines 48, 96, 104 and 114–130 | Selecting or invoking a reflective method does not itself mutate every intrinsic. Unknown receivers, getters and results remain unknown; tracked native writes and publication retain their own boundaries. | Receiver, lifetime and effect proof costs are not yet established. |
| U2 | Complete the `intrinsicFamilies` table (`Object` → `object`; `Symbol`, `Reflect` and ambient objects get no blanket `'all'`) | native-members.js line 25 | the `'all'` fallback at native-boundaries.js line 26 | Family-specific handling must preserve uncertainty from unknown effects; a missing family is not evidence that an effect is harmless. | Table storage is constant; effect tracking costs are not yet established. |
| U3 | `exposureScope(exposure)` returning the owning module root plus the reaching executions | model.js, next to `exposureFor` (line 871) | the module-wide boundary set at demand.js line 2503 and the unconditional `externalExecutions` hit at line 2513 | An exposure affects a read only if the read's execution is reached after the exposing execution runs. Provider module evaluation precedes the importer; export bodies do not, unless invoked. | Per-exposure graph traversal can require O(H(V+E)) work and O(HV) stored reachability for H exposures, V executions and E edges; a shared bound is unproven. |
| U4 | `lexicalOpacity` kept separate from local opacity | bindings.js lines 547 and 576–580 | upward lifting of every opaque capability | Only `dynamicExecutions` (`eval` and `with`) lift. `arguments`, catch patterns and computed parameter keys stay local. | less work than today |
| U5 | `precedesExposure(read, exposure)` | model.js, over `statementPrefixes` and `capabilityPrefixes` | the missing order test in demand.js `invalid` | A module-level read whose prefix completes before the exposure keeps its premise. Conditional exposures stay possible. | Naive caching can require O(RH) work and storage for R reads and H exposures; preserving path correlation needs a separately justified bound. |

## Revised order and gates

The report's earlier U4-first order is superseded by the active
[analyzer completion plan](analyzer-completion.md#pattern-register). Follow its
shared ownership contract and canonical `native-reflection-control` case; do
not implement the proposed U1–U5 utilities as a preapproved sequence.

1. **Establish the baseline.** On the exact current candidate, run
   `npm run check`, then `npm run check:fp-ts -- --offline` sequentially. The
   latter is required because the affected work changes shared analysis and
   lowering inputs. Require all 1,818 cases, 123 load receipts, zero post-fix
   errors, and only the accepted 30 `prefer-async-await` warnings. If either
   gate fails, stop and investigate before feature work.
2. **Repair the canonical native-reflection case first.** Preserve known
   findings across ordinary lookup, while retaining uncertainty after a real,
   applicable exposure. Use the existing public harness and an adversarial
   neighbor; do not create a suite for each case or spelling.
3. **Revisit opacity separately.** Test O1–O3 against the same ownership
   contract. Keep opacity local unless a demonstrated enclosing-scope dependency
   requires lifting it. Only then decide whether a shared mechanism is needed.
4. **Expand exposure scope by evidence.** For X1–X7, reuse existing ownership
   and invocation evidence where it answers applicability. Treat X8's ordering
   as a later slice; if completion correlation cannot be preserved, stop rather
   than approximate. Re-run the module sweep after a coherent repair and trace
   every remaining or newly exposed loss to a premise.
5. **Validate and promote exact bytes.** Follow the guarded handoff in
   [analyzer-completion.md](analyzer-completion.md). Keep the candidate
   isolated, preserve concurrent edits, retain gate receipts, and promote only
   verified bytes. Triage newly surfaced diagnostics; never suppress them or
   refresh baselines/corpus inputs to pass.

The strict under-69-second threshold (target: 50 seconds or less) applies only
to self-lint, measured with `npm run lint`. Report that timing separately.
`npm run check` has no current elapsed-time budget or timeout; let it complete.
Do not treat the combined check duration as self-lint performance.

Do not:

- claim any case fixed without the restored finding *and* its adversarial
  neighbour in executable bad.js;
- replace sequencing with blanket opacity, a fixed point or an interpreter;
- treat stack safety, cached-fact counts, lint passing or isolated examples as
  acceptance.

## Reproduction

```js
// Run from the repository root with node --input-type=module.
const { ESLint } = await import('./node_modules/eslint/lib/api.js');
const engine = new ESLint({ cwd: process.cwd() });
const probe = "const r = { name: '' };\nvoid [r.nmae];\nconst c = { total: 42 };\nc.total.trim();\n";
for (const trigger of ['', 'void [globalThis.flag];', "void [Reflect.get({ a: 1 }, 'a')];"]) {
    const [result] = await engine.lintText(`${probe}${trigger}\n`, { filePath: `${process.cwd()}/analysis/probe.js` });
    console.log(JSON.stringify(trigger), result.messages.filter(({ ruleId = '' }) => ruleId.includes('contract')).length);
}
// Baseline 32bda6e: 2, 0, 0. Current: 2, 0, 2.
// Expected after the remaining ambient-lookup repair: 2, 2, 2.
```

Swap in any trigger above, or prepend it before the probe, to test order. For
module sweeps, append the probe block to a module's text and lint it under that
module's path, so imports resolve. Keep runners outside `scripts/`; their
output belongs in `.artifacts`.

## Constructs verified harmless

No loss was observed for any of these:

- local calls, unknown bare calls and imported calls with plain providers;
- `Object.keys`, `Object.assign`, `Object.freeze` and
  `Object.defineProperty` on local objects, called directly;
- `Array.prototype` reads and `String.prototype.trim.call`;
- local and exported intrinsic aliases;
- `Number.isNaN`, `Promise.resolve`, `Symbol(…)` and `BigInt(…)`;
- `JSON.parse`, `structuredClone`, `Array.from` and `Object.fromEntries`;
- `new Map`, `WeakMap`, generators, dynamic `import()`, `import.meta`,
  `process.env`, `console`, `setTimeout`;
- tagged local templates, spread calls, `for…in`, labels and getters;
- `typeof`, `instanceof` and `in`;
- computed reads and writes, and local mutation;
- nested defaults with native or local calls;
- `bind` and `apply` calls.

## Related local evidence loss

The other `// Not yet reported` blocks in bad.js (lines 420, 579, 661, 847, 1153
and 1274) record losses that stay local to a construct, such as switch, loops,
optional or computed access, reassignment and callbacks. They are a separate
mechanism. The leading hypothesis is the unsupported-parent list in
[use-contexts.js](../../analysis/analyzer/use-contexts.js) line 21. They are
outside this report's acceptance.
