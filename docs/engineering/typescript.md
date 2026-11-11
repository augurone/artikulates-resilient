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
publication. The lowerer does not produce declarations, source maps or package
metadata. [Admission and emission](../../integrations/typescript-project.js).

## Selection, resolution and configuration

TypeScript owns `extends`, source inclusion and compiler options. The Program's
checker inputs may exceed the selected emit scope. Repeat `--emit 'src/entry.ts'`
to select roots; their runtime dependency closure is included. Type-only imports
do not create runtime edges. Every selected source must belong to the Program.

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
[executable project proofs](../../tests/typescript-project-completion.test.js).

## Requirements and actual evidence

`createTypeScriptTransformer` is exported by `eslint-plugin-resilient/typescript`.
Supply its owning real Program for checker-backed requirements and declaration
identity. The programless API retains its syntax-only policy boundary; it does
not provide equivalent checker evidence. Supplied text must match the original
Program source at acquisition boundaries; matching spans in another AST do not
establish source identity.

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

Acquisition supports synchronous declarations/arrows/function expressions,
identifier and flat array formals without defaults/rest, initialized local const
aliases, returned callable invocation, branches, returns/throws, literals, plain
static records and member calls. Bounded collection execution requires established
native identity, owned slots and appropriate effect/callback evidence. General
captured values/mutation, dynamic lexical execution, async execution and unacquired
dependencies remain boundaries. Unsupported execution stays incomplete; operational
failure remains failure. These acquisition limits do not define emitter support.
[Acquisition owner](../../transforms/typescript/understand/source-analysis.js),
[bridge contract tests](../../tests/compiler-bridge-contract.test.js).

Lowering preserves binding-time Get/receiver/effect order and native tuple
initialization/iterator failure. Required tuple boundaries do not authorize empty
fallbacks. Namespace type resolvers retain bound qualified identity and helper
dependencies; empty runtime namespace imports retain their module effect boundary.
Source-proved arity selection can retain callable-versus-value overload returns,
including structural array/intersection families; unrelated mixed returns cannot
borrow that exception. Optional-value normalization is intentional target policy
and must be distinguished from native equivalence in behavior expectations.
[Output contracts](../../tests/typescript-output-contracts.test.js),
[compiler output](../../tests/compiler-output.test.js),
[arity behavior](../../tests/typescript-dynamic-arguments.test.js).

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
compatibility POCs remain ignored artifacts; fp-ts is not a product dependency,
maintained harness or special case. There are no campaign journals, public
verify/resume commands or automatic test rewrites.
