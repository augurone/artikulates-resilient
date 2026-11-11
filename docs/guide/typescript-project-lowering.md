# Lower a TypeScript project

The installed `resilient-lower` command lowers a compatible project into a
separate JavaScript output tree. Keep the original TypeScript source, tsconfig,
normal typecheck and existing application tests. TypeScript 6.0.3 is included
in this package; the current build is private and not a release claim.

Use the packaged JavaScript configuration for generated-code linting:

```javascript
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

`--inspect` resolves the plan without publication. Pass an exact tsconfig when a
directory has ambiguous workspace configurations. Repeat `--emit 'src/entry.ts'`
to select roots; the supported runtime dependency closure is included.

The [engineering guide](../engineering/typescript.md) is the maintained source
for compiler/module modes, selection, aliases, provider boundaries, runtime
helpers, artifact identity, reports and safe publication. It also documents
admission limits: ES2016 or newer output is required; JSX runtime lowering,
declaration-only output and unsupported module forms reject before publication.
The lowerer does not produce declarations, source maps or package metadata.

## Check behavior and fluency separately

Execute the project's own tests against native output, raw lowered JavaScript
and fixed lowered JavaScript. Verify that the tests actually load each intended
artifact rather than falling back to original TypeScript. Preserve the tests and
check values, identities, effects, iteration, cleanup and failures relevant to
that application. Deliberate normalization needs a stated source-to-target
mapping; it cannot be described as unchanged behavior.

A fluency report records lint coverage and active/suppressed findings. A complete
report may contain findings; it does not establish application behavior or serve
as lint enforcement. Use configured ESLint or `resilient-check` for enforcement.
See the [diagnostic guide](diagnostic-explanations.md) for finding interpretation.

Use `resilient-prove --project . --outDir ./.resilient-tests/acceptance` to connect
an explicitly selected Node-test or consumer-installed Vitest suite. Configure
`proof.tests.include` and `proof.runner.kind` in `resilient.project.json` or a
selected provider hook. The [test connection guide](../engineering/typescript.md#run-an-existing-test-suite-against-emitted-output)
defines separate test directories, variant routing, actual case/load evidence,
timeouts and unsupported mount settings. Existing tests remain unchanged.
There are no public `--verify` or `--resume` campaigns. Direct TS/TSX ESLint
integration remains outside scope; successful lowering does not establish it.

The [lowering contracts](../reference/typescript-lowering-algebra.md) and
[pattern taxonomy](../reference/typescript-lowering-patterns.md) explain the
semantic obligations and bounded recipes behind the emitted forms.
