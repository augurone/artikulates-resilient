# Resilient

Resilient is an ESLint dialect and JavaScript analyzer. The
`eslint-plugin-resilient` package owns the agreement engine, 23 ESLint rules,
project resolution, and lint/fix, measurement, inventory and inspection commands.
Implementation, tests and required tooling are self-contained in this repository.

Use Node **22.13.0**. [CHANGELOG.md](CHANGELOG.md) records upcoming changes,
including API breaks, and preserves the earlier release history.

**Lowering is experimental. Use at your own risk.**

## Use in a JavaScript project

Pack this build from the repository root with Node 22.13.0 and npm available:

```sh
mkdir -p .artifacts
npm pack --ignore-scripts --pack-destination .artifacts
```

In the consumer project, install the generated tarball and ESLint. Replace
`VERSION` with the version printed by `npm pack`:

```sh
npm install --save-dev eslint@10.12.0 /path/to/eslint-plugin-resilient-VERSION.tgz
```

Resilient uses ES modules end to end. Use `"type": "module"` in the consumer
package.json and create `eslint.config.js`:

```js
import production from 'eslint-plugin-resilient/production';

export default production({
    aliases: { '@': 'src' },
    entryFiles: ['page'],
    ancestorFiles: ['layout', 'route'],
    inferredFiles: [
        'error', 'global-error', 'loading', 'not-found', 'template', 'default'
    ]
});
```

All project options are optional; `production()` uses the defaults. This factory
returns a flat configuration combining all four presets with Node globals and
import checks. Its default file pattern is `**/*.js`; pass `files` to select
other JavaScript extensions. For browser policy, compose the presets with the
appropriate globals.

In this example, `@` resolves to `src`. For each `page` file, the configured
ancestor and inferred filenames are selected along its ancestor chain, from the
project cwd through the page's directory. Set `root: 'src'` to stop at `src`.
Both lists use that same search, ordered outermost to innermost. Selected files
contribute authored imports and calls to analysis; findings remain owned by the
linted file. File selection does not infer framework invocation or props.
Default resolver extensions are `.js` and `.jsx`.

For an existing flat config, `resilient.imports(options)` on the default plugin
returns the alias/resolver/root settings block. Apply it alongside the desired
`resilient.configs.recommended`, `contracts`, `safety` and `imports` presets.
See [source selection and resolution](https://github.com/augurone/artikulates-resilient/blob/main/docs/reference/tree-resolution.md).

The installed commands are development and CI tools for the consumer's own
source and ESLint configuration. They do not run inside the application.
Installing Resilient does not add this repository's npm scripts to the consumer's
`package.json`. Run the installed commands from the consumer project:

```sh
npx --no-install resilient-check
npx --no-install resilient-check --fix
npx --no-install resilient-check --json
npx --no-install resilient-inspect src/page.js --find 'unique source text'
```

`resilient-check` enforces configured ESLint rules and exception policy;
`--fix` applies available fixes. Inspection reports findings and evidence without
modifying source. Ordinary ESLint CLI and editor integrations also use this config.

To inspect a file before configuring ESLint, select the built-in contract profile:

```sh
npx --no-install resilient-inspect src/page.js --standalone --find 'unique source text'
```

`--standalone` follows relative JavaScript imports and shares the current analyzer
with the contract rules. It does not load project configuration; `--config` and
`--standalone` are mutually exclusive. Configured inspection continues to use the
project's actual parser, policy and resolver.

Inspection accepts `--config <file>` for an explicit profile or `--offset <number>`
instead of `--find`. Its JSON separates findings, suppressions, model observations,
producer locations and unknown boundaries. It does not modify source or construct
a complete derivation graph. See the [diagnostic guide](https://github.com/augurone/artikulates-resilient/blob/main/docs/guide/diagnostic-explanations.md).

## Measure fluency in your own project

With Resilient installed as a development dependency and `eslint.config.js`
configured as above, run from your project's root:

```sh
mkdir -p reports/resilient
npx --no-install resilient-measure --config eslint.config.js --report reports/resilient/before.json 'src/**/*.js'
```

This measures the selected JavaScript under your configured rules, severities,
aliases and inline-directive policy. It leaves source unchanged and disables
result caching. The JSON is printed to the terminal and saved at the report path.
To print just its completion status and summaries:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

const { complete, summary, identity: { environmentSha256 } }
    = JSON.parse(readFileSync('reports/resilient/before.json', 'utf8'));
console.log(JSON.stringify({ complete, environmentSha256, summary }, null, 2));
JS
```

| Report field | How to use it |
| --- | --- |
| `complete`, `files[].complete`, `problems` | Establish that the selected inputs were captured; inspect per-file problems too. |
| `summary.active` | Review measured file count, violations, errors, warnings and counts by rule. |
| `summary.suppressed` | Review findings hidden by directives alongside active findings. |
| `summary.exceptions` | Review exception sites, raw directive count, rules and audit-problem count. |
| `active`, `suppressed`, `exceptions`, `auditProblems` | Inspect locations, operation text and authored exception reasons. |
| `identity` | Record measured patterns, selected configuration hashes and tool identity for comparison. |

Fluency here is evidence about how source expresses the selected dialect policy;
the tool does not assign a numeric fluency score. A complete report establishes
capture of the selected files, not behavioral correctness or coverage of rules
that were not enabled.

After repairing findings and reviewing exceptions, repeat the same measurement:

```sh
npx --no-install resilient-measure --config eslint.config.js --report reports/resilient/after.json 'src/**/*.js'
```

Compare counts by rule, suppressed findings and exception boundaries. Keep the
file selection, configuration and tool versions comparable, and record changes
to them alongside the results. Run your application's own tests to check behavior.

For another project, `--project` selects its root; patterns, `--config` and
`--report` paths then resolve from that root. Exception inventory is also available:

```sh
npx --no-install resilient-measure --project ../another-project --config eslint.config.js 'src/**/*.js'
npx --no-install resilient-audit --inventory 'src/**/*.js'
npx --no-install resilient-audit --inventory --unused 'src/**/*.js'
```

Measurement and exception inventory use the same reporting engine and parsed
source. The schema-3 JSON includes active/suppressed findings, every directive
comment, audited exception boundaries, source/tool hashes and each selected
physical configuration file. `identity.tool.dependencies` records resolved tool
package versions and manifest hashes, including nested dependencies and peers.
`identity.projectInputs` records the nearest ancestor package manifest, installed
declared dependencies and the nearest lockfile directory. It includes npm,
pnpm, Yarn and Bun lockfiles when present. Missing packages are listed explicitly.
`identity.environmentSha256` combines tool, Node and project-input identity.

Schema 3 retains the schema-2 finding fields and expands tool identity. These
hashes cover observed metadata and owned tool files; they do not hash every
third-party implementation byte, validate an installation against its lockfile,
or include transitive executable configuration imports. Changes to observed
identity inputs during a measurement make the report incomplete. Report output
cannot overwrite these inputs.

Complete measurement and inventory exit successfully even when findings exist.
Missing capture, parse, scope, configuration or I/O failures produce failure.
`resilient-audit` without `--inventory` enforces exception policy. `--unused`
explicitly requests unused-directive reporting and labels that audit profile;
ordinary measurement preserves the consumer's inline and unused-directive policy.
The report parent directory must exist, and reports cannot overwrite measured
source, selected configuration or tool inputs.

### Consumer CI: enforce policy and retain the measurement

After checkout, Node setup and `npm ci` in your consumer's CI job, add these
steps. This example uses a root `eslint.config.js` and the same source selection
for both commands:

```yaml
- name: Enforce configured lint and exception policy
  run: npx --no-install resilient-check 'src/**/*.js'

- name: Measure fluency
  if: ${{ !cancelled() }}
  run: |
    mkdir -p reports/resilient
    npx --no-install resilient-measure --config eslint.config.js --report reports/resilient/fluency.json 'src/**/*.js'

- name: Retain fluency report
  if: ${{ !cancelled() }}
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  with:
    name: resilient-fluency
    path: reports/resilient/fluency.json
    if-no-files-found: warn
```

`resilient-check` fails on active errors or rejected exceptions. Measurement can
succeed with findings, so its exit status establishes report completion rather
than policy acceptance. The explicit conditions let measurement and upload run
after enforcement fails; the failed enforcement step still fails the job. A
measurement failure also fails the job. No autofix runs in this CI example.
Keep your application's own tests as a separate CI step.

## Structure

| Path | Responsibility |
| --- | --- |
| `analysis/agreement/` | Source-owned evidence, requirements and judgments. |
| `analysis/analyzer/` | JavaScript acquisition, execution evidence and public analysis. |
| `analysis/eslint/` | The 23 rule implementations using that analyzer. |
| `analysis/host/` | Shared host utilities. |
| `index.js`, `integrations/`, `config/production.js` | Plugin, presets, project resolution and consumer configuration. |
| `scripts/check-eslint.js`, `scripts/audit-eslint-exceptions.js` | Shipped lint/fix command and exception enforcement. |
| `scripts/measure-project.js`, `integrations/measurement.js` | Shared consumer measurement and exception-inventory reporting. |
| `scripts/lint.js`, `scripts/check-package.js`, `scripts/io.js` | Required project verification and package installation checks. |
| `tests/` | Maintained behavior, policy, isolation and installation assertions. |
| `tests/support/` | Test counters, oracle collections, source inventory and GC harness. |
| `tests/fixtures/` | Assertion data; never shipped or executed as a legacy implementation. |
| `config/` | Production configuration and local verification policy. |
| `docs/engineering/` | Architecture, verification and feature review. |
| `docs/guide/` | Consumer migration patterns and diagnostic explanations. |
| `docs/reference/`, `docs/ai/`, `docs/rules/`, `docs/blogs/` | Language policy, rule documentation and design context. |
| `.artifacts/` | Ignored, generated check output and disposable package installations. |

Start with the [documentation index](https://github.com/augurone/artikulates-resilient/blob/main/docs/README.md).
The [migration playbook](https://github.com/augurone/artikulates-resilient/blob/main/docs/guide/migration-playbook.md) and
[diagnostic guide](https://github.com/augurone/artikulates-resilient/blob/main/docs/guide/diagnostic-explanations.md) cover consumer usage.
The detailed guides live in the repository; the npm tarball includes this README
and CHANGELOG but excludes `docs/`, tests, repository-only commands and generated output.
`.artifacts/` is disposable check output and can be removed when no longer needed;
commands create it automatically.

## Develop Resilient (repository only)

All npm scripts in this section are features for developing and verifying
Resilient itself. They do not apply to an installed consumer project. Direct
`node scripts/...` commands here also assume this checkout. The lint wrapper,
package verifier, release tooling and repository configuration are development
inputs; the installed consumer commands described above have their own interfaces.

Use Node 22.13.0, as specified in `package.json`'s `engines.node`, and npm on
PATH. From the repository root:

```sh
npm ci
npm run check
```

GitHub Actions installs the version specified in `package.json`, runs `npm ci`,
then runs the same `npm run check` gate for pushes and pull requests.

`npm run check` lints the project and runs every maintained suite once: internal
tests use the workspace; public tests and host/CLI checks use a normal isolated
package installation. `npm run check:package` runs that complete test gate without
lint. `npm test` runs the top-level workspace suites for development; installed
host suites run through `check:package`.

### Prepare a release

`npm run release:check` validates the package, lockfile, both plugin versions and
the matching changelog entry, then runs `npm run check` and `git diff --check`.

Preview and prepare a named entry such as `0.7.6 — Unreleased`:

```sh
npm run release -- 0.7.6 --dry-run
npm run release -- 0.7.6
```

An explicit version matching the package and named entry finalizes that release
without incrementing it again. With generic `## Unreleased` notes, no argument
or `patch` selects the next patch; `minor`, `major` and an explicit new version
are also supported. A named entry must match the requested version.

Preparation updates package/lock versions and both plugin metadata records,
dates the release notes in UTC and runs the acceptance gate. A failed check
restores the prior owned file contents; concurrent edits are preserved and
reported. `--dry-run` prints the plan without writes or verification. Git
commits, tags and publication remain manual.

### Lint and rule checks

The local rule canary is `tests/fixtures/bad.js`, with its providers beside it.
`tests/rule-canary.test.js` requires actual findings at executable negative
anchors for every exported Resilient rule, checks source explanations and valid
controls, and runs against the isolated installed package. Editors and direct
ESLint include `bad.js`; `npm run lint -- tests/fixtures/bad.js` shows its findings.
The default `npm run lint` excludes test fixtures so the package gate can pass.
Fixtures remain visible to development linting. Test inputs and
commands are self-contained in this package.

Lint uses ESLint's standard terminal formatter. `npm run lint:report` also writes
the detailed development report and source hashes under `.artifacts/`.
Pass arguments to the lint wrapper after npm's `--` separator. Quote globs so
ESLint receives the pattern. These commands always use this repository's root
and `eslint.config.js`:

```sh
npm run lint
npm run lint -- analysis/agreement/estree.js
npm run lint -- 'analysis/**/*.js' 'transforms/**/*.js'
npm run lint -- --concurrency 3 'analysis/**/*.js'
npm run lint -- --concurrency=off
npm run lint -- --concurrency auto
npm run lint -- --report --stats 'analysis/**/*.js'
npm run lint:report -- --stats 'analysis/**/*.js'
npm run lint -- --help
```

| Argument | Repository lint behavior |
| --- | --- |
| File paths or globs | Select files; omit them for the default batch check. |
| `--concurrency <N\|off\|auto>` | Use a positive worker count, serial execution or ESLint's heuristic; default is six workers. |
| `--report` | Write the detailed report to `.artifacts/lint-results.json`. |
| `--stats` | Collect per-file rule timings; pair with `--report` or `lint:report` to save them. |
| `--help` | Print usage without linting. |

The wrapper accepts these arguments only. It has no `--fix`, `--config` or
`--json` option. For configured autofixes in this checkout, use the audited
checker with explicit file selection:

```sh
node scripts/check-eslint.js --fix 'analysis/**/*.js' 'transforms/**/*.js'
```

That command audits authored exceptions before fixing and applies available
configured rule fixes, including the import plugin's `import/order` fixes.
Review its source diff and run the affected behavior checks afterward.

Without file arguments, lint checks the project excluding test fixtures and the
global ignores in `eslint.config.js`. The tuned default is
**6 workers** on the development machine; override it for other hardware or
workloads. `off` selects serial execution; `auto` uses ESLint's heuristic.
`--help` displays the default and available options. `--report` records the
requested settings, lint/audit timings, process CPU and peak RSS, source hashes,
findings and exceptions in `.artifacts/lint-results.json`; `--stats` adds per-file
rule timings. Result caching stays disabled so dependency changes remain visible.

The isolated package installation has no workspace links or imports reaching
outside its own directory. Package checks compare shipped bytes with the
workspace and exercise the installed exports and commands.

## Public entry points

```js
import plugin from 'eslint-plugin-resilient';
import { createOwner, request } from 'eslint-plugin-resilient/agreement';
import { createAnalysis } from 'eslint-plugin-resilient/analyzer';
import rulePlugin from 'eslint-plugin-resilient/eslint';
import production from 'eslint-plugin-resilient/production';
```

The analyzer and agreement exports are owned by this package. Rules use the
`resilient/*` namespace. The root plugin exposes four presets: `recommended`
for dialect/core rules, `contracts` for shared analysis findings, `safety` for
mutation/callback/promise policy, and `imports` for import validation.
`prefer-async-await` is a warning in the safety preset; its other enabled
Resilient rules are errors. See the [rule documentation](https://github.com/augurone/artikulates-resilient/tree/main/docs/rules/).
