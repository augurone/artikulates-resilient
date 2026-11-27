# TypeScript transformation and project lowering

**Lowering is experimental. Use at your own risk.** It remains under validation
and is outside the supported 0.7.6 feature set.

The transformer emits JavaScript in the Resilient dialect. Compiler acquisition
connects original TypeScript syntax to shared analysis; it does not make type
annotations evidence of actual values. Language requirements remain in
[grammar](../reference/grammar.md), [policy](../reference/policy.md) and
[semantics](../reference/semantics.md).
The [lowering contracts](../reference/typescript-lowering-algebra.md) explain
preservation and normalization obligations. The [pattern taxonomy](../reference/typescript-lowering-patterns.md)
maps bounded recipes to their current owners and functional evidence.

Guarded-return lowering preserves authored block scopes, including shadowed
bindings, captured bindings and temporal dead zones. Only a synthetic block
created to expand one return statement can be spliced into its enclosing
statement sequence. Guarded-return and ordered-decision lowering scan flat
statement sequences with prototype methods; statement width does not create
recursive suffix copies. For N statements and M emitted expansion statements,
these sequence rewrites use O(N + M) work and temporary references without a
persistent cache. Each authored block takes one lowering path; preserving its
scope must not revisit its descendants through the synthetic expansion path.
[Nested block work checks](../../tests/typescript-emission-contracts-local.test.js)
vary depth and width and compare native execution alongside actual visit counts.
Ordered-decision inversion requires a suffix without direct
runtime declarations: termination alone does not permit moving lexical bindings,
hoisted functions or temporal dead zones into another scope. Syntax-depth
traversal remains distinct from statement width.
[Executable block and width contracts](../../tests/lowering-block-ownership.test.js)
compare native Program.emit with direct, emitted and ESLint-fixed output.

## Lower an existing project

Use an installed build of this checkout with its ESLint peer; TypeScript 6.0.3
is included as a package dependency. The experimental support boundary is
recorded in the [feature review](feature-review.md). Keep the project's source
and tsconfig. A generated-code ESLint profile can use the packaged configuration:

```js
import production from 'eslint-plugin-resilient/production';
export default production();
```

From the consumer project root:

```sh
npx resilient-lower --project . --outDir ./dist/resilient --inspect
npx resilient-lower --project . --outDir ./dist/resilient \
  --eslint-config ./eslint.config.js --fix \
  --report ./resilient-fluency.json --manifest ./resilient-manifest.json
```

Inspection resolves the plan without publishing. Lowering writes a separate
output tree; `--fix` changes generated JavaScript. Source and configuration files
are not rewritten. Keep the project's normal typecheck: the lower command's
compiler syntax checks do not constitute a full semantic typecheck.

`--project` accepts a directory or exact tsconfig. A directory selects its
executable `tsconfig.json`; ambiguous workspace configurations require an exact
path. The same project model owns inspection and execution.

Both standalone transformation and project lowering require **ES2016 or newer**.
The project lowerer admits these compiler combinations:

| Module | Resolution | Output |
| --- | --- | --- |
| `NodeNext` | `NodeNext` | ESM |
| `ESNext` or `ES2022` | `Bundler` | ESM |

Source and output must belong to packages with `"type": "module"`. Executable
sources use `.ts`/`.tsx` and emit `.js`; alternate module extensions and CommonJS
compiler output are unsupported. No package-mode conversion or `require()` hooks
are installed. Executable configs, providers and local standard-helper bindings
also use `.js` in ESM package scopes. Older targets, JSX runtime lowering,
declaration-only emit, other module combinations,
import-equals/export-equals and nonliteral dynamic imports reject before
publication. Resource declarations (`using` and `await using`, including loop bindings) reject
at source admission: disposal lowering is not implemented, and ordinary binding
rewrites must not erase cleanup or change the resource being disposed.
The lowerer does not produce declarations, source maps or package
metadata. [Admission and emission](../../integrations/typescript-project.js).

## Selection, resolution and configuration

TypeScript owns `extends`, source inclusion and compiler options. The Program's
checker inputs may exceed the selected emit scope. Repeat `--emit 'src/entry.ts'`
to select roots; their runtime dependency closure is included. Whole-declaration type-only imports and exports
do not create runtime edges. With `verbatimModuleSyntax`, empty requests and
requests containing only inline type specifiers still evaluate their modules.
Provider discovery, selected-source closure and sibling routing share the same
compiler-option-aware decision in the resolution owner; erasing a binding must
not omit a retained module request. Classification scans each named specifier at
most once, adds no source traversal or persistent cache, and uses O(1) extra
storage. [Project boundary tests](../../tests/module-project-boundaries.test.js)
compare native emission, direct transformation, inspection and published raw/fixed
execution under every admitted module configuration. Every selected source must belong to the Program.

An optional top-level `resilient` node in the selected tsconfig supplies `emit`
and `standard` helper bindings. This node does not merge through `extends`.
An optional `resilient.project.json` beside that config can override these fields:

```json
{ "schemaVersion": 2, "emit": ["src/**/*.ts"] }
```

CLI emit selection wins over this file, which wins over the selected tsconfig's
Resilient fields. `--outDir` wins over an `outDir` authored directly in that
config, then defaults to `.resilient` in the invocation directory. Inherited
`outDir` does not select publication. CLI paths resolve from the invocation
directory; relative helper/provider/config bindings resolve beside the tsconfig.
Portable helpers default to `eslint-plugin-resilient/standard/{object,array,function}`.

Resolution supports relative/index imports, TypeScript paths/baseUrl, package
imports/exports and `#` imports. Local runtime imports/re-exports/literal dynamic
imports become routes between emitted siblings. Bare external packages remain
external. Use standard ES module imports and exports.

Use `--resolver-config` or schema-2 `resolution.eslintConfig` to reuse an explicit
ESLint alias/resolver configuration. `--eslint-config` separately selects output
linting. Use `--provider` or schema-2 `provider` for an explicitly selected
executable resolution provider. Providers supply source identity or an external
runtime route with owner/reason, never emitted text. Resolver disagreement,
ambiguous targets, malformed results and thrown failures prevent publication.
Provider/config execution is isolated; loaded local inputs enter artifact hashes.
[Resolution owner](../../integrations/typescript-project-resolution.js),
[executable project proofs](../../tests/typescript-project-contracts.test.js).

## Requirements and actual evidence

`createTypeScriptTransformer` is exported by `eslint-plugin-resilient/typescript`.
Supply its owning real Program for checker-backed requirements and declaration
identity. The programless API retains its syntax-only policy boundary; it does
not provide equivalent checker evidence. Supplied text must match the original
Program source at acquisition boundaries; matching spans in another AST do not
establish source identity.

The Program-level `createTypeScriptEmitTransformer` companion prepares reports
before its `before` compiler callback. Callers must inspect preparation diagnostics;
the callback leaves rejected files with TypeScript's original source. Returned
reports belong to callers: editing their diagnostics or other fields cannot change
the cached emission decision. The private cache retains only emitted text and a
rejection flag per file, with O(1) decision work and storage beyond that text.
The callback marks its entire fresh JavaScript tree as synthesized compiler
syntax and recreates the remaining export statements. Runtime aliases have
already survived type erasure; generated nodes do not own the Program symbols
needed to classify them again. In particular, constant-value substitution must
not ask the original checker to bind generated callbacks below a property or
element access. This
preserves local/default aliases and re-exports through actual `Program.emit`,
including their emitted-text comment ranges, without changing the caller's tree
or compiler options. The pass visits V artifact nodes in O(V) work with a
syntax-depth traversal stack, uses O(S) temporary statement storage for S
top-level statements, and creates O(E) nodes for E export statements. It adds no
persistent cache. [Emitted syntax ownership](../../tests/emitted-syntax-ownership.test.js)
compares native, direct, emitted and fixed execution across callback compositions,
compiler options, repeated callbacks and caller-edited preparation reports.

`createTypeScriptAnalysis`, exported by `eslint-plugin-resilient/analyzer/typescript`,
acquires owned models for shared callable, value, demand and completion operations.
Its source identity binds compiler version, filename, source/Program revisions,
options and text digest. Published records retain no compiler AST, checker or
Program. Transformer `sourceEvidence` reports observations separately from policy
`agreements`; an unknown execution can retain a known annotation requirement.

`checkTuple` compares **returned tuple positions** against descriptor requirements;
it is not input validation. Use `checkCallResult` for an actual whole call result
and `checkFunction` for producer consistency and returned-parameter identity.
Annotations and contextual signatures never initialize actual parameter values.

When a required comparator is absent or not callable, an admitted `sort` guard
returns the receiver already acquired for that call, without sorting it. A
callable comparator still performs the source sort; receiver evaluation and
provider or comparator failures are not replaced with a fabricated array.
The checker identifies the array requirement, not runtime validation of the
receiver. This response does not apply to `reduce` or `toSorted`, whose results
do not have the same receiver-identity contract. Each guarded sort keeps one
receiver reference with constant runtime work and storage. Generated name
selection uses the existing function-name scan. When preferred names collide,
it examines O(N) candidate suffixes and uses O(N) temporary references for N
occupied names; it retains no additional persistent state.

Acquisition supports synchronous declarations/arrows/function expressions,
identifier and flat array formals without defaults/rest, initialized local const
aliases, returned callable invocation, branches, returns/throws, literals, plain
static records and member calls. Bounded collection execution requires established
native identity, owned slots and appropriate effect/callback evidence. General
captured values/mutation, dynamic lexical execution, async execution and unacquired
dependencies remain boundaries. Unsupported execution stays incomplete; operational
failure remains failure. These acquisition limits do not define emitter support.
An effectful argument does not invalidate native behavior in the called body.
The bridge retains a fresh outer argument's fields or slots while retiring
potentially shared children; other inputs may be retired when earlier evaluation
could change them. Unknown completion and earlier unacquired dependencies remain
separate barriers. This reuses the shared, memoized copy-retirement walk rather
than retaining native-family exposure state.
[Acquisition owner](../../transforms/typescript/understand/source-analysis.js),
[bridge contract tests](../../tests/compiler-evidence.test.js).

Exact `undefined` selection defaults preserve native absence under their own
R02 exception. Generated directives must survive the native emitter and production
fixes without covering authored sibling defaults; comments that split a declaration
require binding/initializer ownership rather than a first-line assumption. The
annotation pass retains source identity and the six nonenumerable compiler-owned
binding markers on fresh clones. Declared `undefined` does not select an object
fallback, and an optional scalar `undefined` parameter remains naturally omitted
so its function arity is unchanged. Authored defaults retain their own findings.
[Output contracts](../../tests/typescript-output-contracts.test.js) compare native,
raw and fixed behavior; [boundary controls](../../tests/typescript-emission-contracts-local.test.js)
check directive scopes, descriptor identity and repeated annotation.

Fresh record fields and tuple positions can preserve exact native absence through
an uninitialized lexical binding. This retains the property's presence, descriptor
and tuple position without an R02 exception, helper invocation or invented value.
Eligible slots have an authored `void` requirement, an unconstrained generic
context, or a contextual undefined slot. A generic slot establishes no supplied
runtime family: its unsafe consumers must still report. Assertions may expose the
underlying native identifier but never provide permission or runtime evidence.
Concrete incompatible families, `any`/`unknown`, assertion-only void declarations,
and unproved inferred contexts retain their findings. Prior same-key writes,
unknown earlier spreads/keys, prototype setters and tuple spreads cannot establish
a fresh slot. Parameter initializers and direct-eval source files are excluded.
Emission places one hygienic uninitialized `let` in the owning block or function,
keeping directive prologues, arity, receiver and evaluation order. Source-file
bindings are emitted only for modules: an indirect eval or Function constructor in
a script could otherwise observe or assign a new global lexical binding.

Lowering preserves binding-time Get/receiver/effect order and native tuple
initialization/iterator failure. Required tuple boundaries do not authorize empty
fallbacks. Namespace type resolvers retain bound qualified identity and helper
dependencies; empty runtime namespace imports retain their module effect boundary.
Authored imports and re-exports with module specifiers retain one ordered
dependency list after generated helper imports. Splitting that list changes
evaluation effects, failure order and cyclic initialization. Final transpilation
retains the owning Program's `verbatimModuleSyntax` option, including its empty
re-export effects; explicit type-only exports remain erased.
Unused default, namespace and named value imports also retain evaluation and
link-time validation under that option. Inferred type-only usage does not erase
them; explicit type-only clauses and specifiers retain the compiler's erasure.
The import rewrite uses a constant-time option branch without another source walk.
Namespace member snapshots retain their local bindings and source-time reads in
both Program-backed and programless lowering. They cannot become imports or
re-exports: those bind live exports, change dependency order, erase cyclic TDZ
reads, and merge distinct snapshot identities. The ordinary member lowering owns
snapshot syntax; module assembly retains the authored requests. Remaining direct
namespace snapshots become local destructuring with a field-defaults exception
confined to that pattern: native absence cannot acquire a fabricated fallback.
Namespace references reuse acquired binding identity. Programless acquisition
admits names only when no other declaration shadows them anywhere in the source.
Acquisition uses at most O(N log N + R) work and O(N + R) temporary storage for N
source nodes and R references. Placement walks the final tree once and reuses
the authored-rule scope policy to preserve existing directives: S snapshots and C
comments add at most O(SC) scope-query work. No persistent cache is retained.
Assembly classifies
S statements in O(S) work and storage without a new persistent cache.
[Module emission order](../../tests/module-emission-order.test.js) compares
native, raw and production-fixed execution, with paired failures, default cycles,
compiler-option controls and independently varied dependency width/relay depth.
Source-proved arity selection can retain callable-versus-value overload returns,
including structural array/intersection families; unrelated mixed returns cannot
borrow that exception. Completed source partitions retain one complete-entry
family and exact partial-constructor/continuation sites. Only a partial arrow
that directly forwards to the same overload carries its continuation boundary.
Owned conditional returns become guarded return sites; partial bodies are printed
separately so a constructor's line exception cannot suppress a nested return.
Exception permission requires concrete immutable source data or a literal
producer, with static namespace identity preserved. A fixed six-edge budget may
follow synchronous returned closures and unchanged local single-return wrappers;
it does not interpret callback inputs or arbitrary producer graphs. Temporary
memos bound that work/storage by inspected source plus existing compiler/reference
queries. Type hints alone supply no
runtime family or validation; unproved results keep their findings. Async/generator
partitions and continuations retain separate boundaries. Incorrect complete-entry mixtures keep their findings. Optional-value normalization is intentional target policy
and must be distinguished from native equivalence in behavior expectations.
[Output contracts](../../tests/typescript-output-contracts.test.js),
[compiler output](../../tests/compiler-delivery.test.js),
[arity behavior](../../tests/typescript-value-contracts.test.js).

A retained module-strict native function consuming its own arguments with zero
runtime formals exposes an explicit rest formal. Its native arguments object,
lexical arrow captures, receiver, construction/prototype and length 0 remain
intact. A TypeScript `this` formal is erased rather than counted as runtime input.
Observable eval, an own strict directive, generators and existing runtime formals
keep their boundaries. The new module scan and selected emission passes add
linear work/storage in their source nodes, return sites and acquired type parts;
each admitted invocation adds O(A) work and temporary storage for A arguments.
Analyzer maximum-arity and return-consistency policy are unchanged. Native
arguments objects are never replaced by rest arrays.

Callable capability acquisition and final function placement share one scope
scan. It follows genuine lexical references through arrows, excludes property,
binding and label names and erased type nodes, and visits a nested callable's
computed name in the enclosing scope before stopping at its parameters/body.
The shared traversal visits each admitted node once per scope request, with
linear temporary work/storage and no persistent cache or copied result prefixes.

Fixed rest-position selection emits computed numeric properties. This preserves
the source property Gets without acquiring an iterator and follows the array
property-extraction contract in [Semantics S-04](../reference/semantics.md#s-04-value-contracts).

## Publication and acceptance

The lowerer rejects input/output overlaps, escaping routes and destination
collisions. It stages complete sibling trees before lint/fix observation and
publication, preserving prior output/report/manifest on failure. A manifest saves
separate raw/fixed bytes, source/checker/config/compiler/helper/implementation
identities, agreements, diagnostics and bounded operation records. Internal
manifest validation and operation reuse exist; no user-facing verify/resume
command is connected. [Artifact owner](../../integrations/typescript-project-artifacts.js).

A **complete** fluency report means every expected output was analyzed under an
active profile. **Clean** means zero errors and warnings. Neither proves runtime
behavior; findings alone do not fail lowering publication. `resilient-check`
enforces lint and exception policy. `npm run check` additionally runs maintained
tests through local and isolated installed-package environments. Native/raw/fixed
application tests prove effects, identity, failure and owned-module execution.

## Run an existing test suite against emitted output

`resilient-prove` connects the project's existing Node-test or consumer-installed
Vitest runner. It first executes ordinary TypeScript reference output, then raw
and fixed lowered JavaScript. Tests keep their original source and cwd. Explicit
module routing selects the variant; source TypeScript cannot silently supply an
un-emitted application module.

Select application emit roots and separate test inputs in `resilient.project.json`:

```json
{
  "schemaVersion": 2,
  "emit": ["src/**/*.ts"],
  "proof": {
    "tests": { "include": ["test/**/*.test.js"] },
    "runner": { "kind": "node-test" }
  }
}
```

```sh
npx resilient-prove --project . --outDir ./.resilient-tests/acceptance --timeout 120000
```

An explicit `--outDir` must be fresh. Without it, each run gets a new directory
under `.resilient-tests/`. `--timeout` bounds each runner, lowering and provider
process; a failed or timed-out process yields an incomplete run. The command
prints its completion status and artifact directory. `results.json` retains
per-case outcomes, observed source/variant loads, test-helper hashes, selected
versus observed coverage, input hashes and fluency report locations.

Each variant needs passing cases and actual owned artifact loads. Cases,
outcomes, observed application source identities and authored helper bytes must
agree. A zero-test exit, unrelated successful tests, source fallback, changed
cases or changed inputs cannot establish completion. Unexercised emitted modules
remain visible in coverage; they are not claimed as behaviorally proved.

The Node-test ESM host retains query and fragment suffixes on routed module URLs
with native empty-suffix normalization.
Repeated imports of one URL reuse its instance; distinct suffixed URLs keep their
separate module initialization and identity. Physical artifact paths still own
the routing guards, source hashes and file-coverage records.

For Vitest, use `"runner": { "kind": "vitest" }` and optionally
`"vitestConfig": "vitest.config.js"`. Vitest and Vite come from the consumer's
installation, not this package. Existing config and worker options are retained
while routing guards enter each worker before setup/tests. Node-test and Vitest
are supported connections; arbitrary shell/npm commands are not case decoders.

Application emit selection must exclude tests. Keep tests and native test helpers
in separate directories from application sources. Test-only TypeScript receives
ordinary compiler erasure, never dialect lowering or autofixes. Existing project
resources/dependencies stay in place; resource/dependency mount settings are
explicitly unsupported. `proof.env` and optional `proof.inheritEnv` configure
runner environments; reports retain key names and hashes rather than values.
An explicit provider's `proof()` hook can supply supported test configuration;
authored `proof` settings take precedence.

This job proves the behavior exercised by that test suite under its artifact
mapping. It does not establish every runtime input or line of code. External
compatibility POC outputs remain ignored artifacts. The pinned fp-ts adversarial
corpus and `npm run check:fp-ts` are mandatory development acceptance whenever
the transformer changes, including shared changes that affect lowering. The
[engineering guide](README.md#lowering-acceptance) defines its runtime, module
load and diagnostic gates. fp-ts is not a product dependency or a special case
in the transformer. There are no campaign journals, public
verify/resume commands or automatic test rewrites.
