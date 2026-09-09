# eslint-plugin-resilient

Resilient is a disciplined dialect of standard JavaScript, with a static
analyzer exposed through ESLint. The code is the contract: signatures define
boundaries, defaults give absence a usable meaning, operations express demands,
and return paths carry agreements forward.

The analyzer follows those agreements through local code and modules, reports
known contradictions, and preserves unknowns. Runtime validation belongs to
the boundary receiving external data. The rules make optional behavior,
mutation, and failure ownership explicit during development and in CI.

Necessary exceptions name their rules, scope, and reasons. Project measurement
counts active findings, suppressed findings, and directive sites separately,
so recurring justified exceptions can inform how the dialect evolves.

Read the essays behind the approach on [DEV — @augurone](https://dev.to/augurone).

## Install

```bash
npm install --save-dev eslint eslint-plugin-resilient
```

Version `0.7.x` requires ESLint `^10.9.1`, Node.js `^22.13.0 || >=24`,
and ESLint flat config.

## Configure

Add to `eslint.config.js`:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts
];
```

| Preset | Checks |
| --- | --- |
| `recommended` | Native-JavaScript discipline and formatting. |
| `contracts` | Value, shape, return, call-site, and local-module agreements. |
| `imports` | Generic import checks through `eslint-plugin-import-x`. |
| `safety` | Mutation, failure handling, optional callback guards, and promise ownership. |

Add `resilient.configs.imports` and `resilient.configs.safety` to the array
when the project wants those policies.

### Project conventions

Relative `.js`, `.jsx`, `.mjs`, `.cjs`, and `index.js` imports work by default.
For aliases or additional entry conventions, configure `resilient.imports`:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.imports,
    resilient.imports({
        aliases: { '@': 'src' },
        root: 'src/app',
        entryFiles: ['page'],
        ancestorFiles: ['layout'],
        inferredFiles: ['error', 'loading', 'not-found']
    })
];
```

`resilient.imports({...})` shares resolution between the contract graph and
`import-x`; `resilient.configs.imports` enables import diagnostics.

| Option | Purpose / default |
| --- | --- |
| `cwd` | Project directory; current working directory. |
| `aliases` | Project-relative targets, such as `{ '@': 'src' }`. |
| `extensions` | Candidate extensions; `.js`, `.jsx`, `.mjs`, `.cjs`. |
| `root` | Optional boundary for ancestor and inferred files. |
| `entryFiles` | Entry filenames; `['index']`. |
| `ancestorFiles` | Files discovered beside entries and in ancestor directories. |
| `inferredFiles` | Additional files discovered beside entries. |

See the [contracts reference](docs/reference/contracts.md#module-graph) for
custom resolvers and [tree resolution](docs/reference/tree-resolution.md) for
analysis scope.

## See it work

This call contradicts the signature's string contract:

```javascript
const render = ({ title = '' } = {}) => title.trim();

render({ title: 42 }); // resilient/signature-contract-call-site
```

The intentionally invalid
[bad.js fixture](https://github.com/augurone/artikulates-resilient/blob/main/tests/fixtures/bad.js)
contains labeled examples for every rule, from individual tokens to effects
and cross-boundary contradictions. In a repository checkout, see its findings
and inspect the evidence at a source location:

```bash
npx eslint tests/fixtures/bad.js
npx resilient-inspect tests/fixtures/bad.js \
    --find "items.toUpperCase" --diagnostics --evidence
```

The inspector also accepts `--offset <number>`. It performs one-shot static
analysis of the selected file and its local relative imports.

For patterns and migrations, explore the [guides](docs/guide/):
[rule-by-rule repairs](docs/guide/migration-playbook.md) and
[diagnostic explanations](docs/guide/diagnostic-explanations.md).

## Measure a project

Run from the consuming project's root:

```sh
# Whole project
npx resilient-measure --report project.json

# Selected targets
npx resilient-measure --report targets.json 'src/**/*.{js,jsx,mjs,cjs}'
npx resilient-measure --report targets.json src/page.js src/providers

# Another project and configuration
npx resilient-measure --project ../my-app --config eslint.config.mjs \
    --report project.json 'src/**/*.js'
```

The command uses the project's ESLint configuration, parser, and ignores,
without fixing source. Target and option paths are relative to `--project`,
which defaults to the current directory. Omit `--report` to print full JSON;
with it, the command saves JSON and prints a summary. The report needs a `.json`
path distinct from measured source and an existing parent directory.

| Report field | Counts |
| --- | --- |
| `summary.active` | Visible findings, including configured unused-directive warnings. |
| `summary.suppressed` | Findings ESLint actually suppressed. |
| `summary.exceptions.sites` | Disable directive occurrences, including unused sites. |
| `summary.exceptions.ruleSites` | Named rule entries; a bare disable contributes one wildcard entry. |

Reports include finding locations, directive rules and reasons, source hashes,
configuration path/hash, and tool versions. Compare the same targets and
configuration. A directive may suppress several findings or none; its reason
still needs review.

Exit 0 means measurement completed, even with lint errors. Parse or
configuration failures return a failing status. Use ESLint as the CI lint gate.

## Migrating to 0.7.4

- Replace legacy `resilient-allow-loop` and `resilient-allow-promise-chain`
  comments with named ESLint directives and concrete reasons.
- Loops with `await` or direct control flow now receive loop findings;
  mutation is checked independently, including inside excepted loops.
- Update layout overrides and directives to `resilient/operator-linebreak`.
- Review return consistency: bare returns and reachable fallthrough contribute
  `undefined`, including guarded callback exits.
- Callback and destructuring checks follow lexical bindings. Signature
  suggestions remain manual to preserve getter and deferred-call timing.

See the [migration playbook](docs/guide/migration-playbook.md) for repairs and
[exception policy](docs/reference/policy.md#p-03-exceptions-and-precedence) for
named, reasoned directives scoped to one statement or declaration. Resilient's
repository audit checks directive syntax and scope separately from measurement.

## Optional runtime helpers

```javascript
import { isObject, hasContent, getObject, modelCheck } from 'eslint-plugin-resilient/standard/object';
import { isArray, hasArrayContent, validArray } from 'eslint-plugin-resilient/standard/array';
import { isFunction } from 'eslint-plugin-resilient/standard/function';
```

Predicates check runtime family or content. `getObject` and `validArray`
preserve accepted values and return `{}` or `[]` for other inputs.
`modelCheck` tests attribute membership, including falsey property values.
Application schema validation remains project-owned.

## Documentation

| Need | Start here |
| --- | --- |
| Patterns and migration | [Guides](docs/guide/) |
| Rule behavior and options | [Rule pages](docs/rules/) |
| Structured contracts, evidence, and diagnostics | [Contracts API](docs/reference/contracts.md) |
| Project resolution | [Tree resolution](docs/reference/tree-resolution.md) |
| Dialect specification | [Grammar](docs/reference/grammar.md), [Policy](docs/reference/policy.md), [Semantics](docs/reference/semantics.md) |
| Full documentation map | [Documentation index](docs/README.md) |
| Release changes | [Changelog](CHANGELOG.md) |

## Development

```bash
npm test
npm run fixtures:check
npm run lint
git diff --check
```

`npm run lint` audits source exceptions and excludes intentionally invalid
fixtures; `npm run fixtures:check` verifies their expected diagnostics.
Tests and repository linting include an 8 GB heap allowance.
Tests report module counts; lint reports each file and its elapsed time.
`npm run release:check` runs these checks, a fresh packed-package consumer check,
and a packaging dry run without changing the version.

See [AGENTS.md](https://github.com/augurone/artikulates-resilient/blob/main/AGENTS.md)
for maintainer requirements and the
[proof execution runbook](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/PROOF_EXECUTION.md)
for focused tests and verification workflows.

## License

MIT
