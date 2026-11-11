# Understanding a Resilient finding

Begin with the reported rule, location, and message. Syntax-policy findings say
which form the dialect requires; contract findings identify an established
disagreement. They do not claim to have executed external data. Use the
[rule page](../rules/) and [migration playbook](migration-playbook.md) to choose a
repair that preserves the intended boundary.

## Use the configured lint result

Keep the project's ESLint flat configuration and choose the JavaScript presets
that match its policy. For example:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended,
    resilient.configs.contracts,
    resilient.configs.safety
];
```

`configs.imports` separately enables import checks. `resilient.imports({ aliases,
cwd })` configures shared alias resolution. The packaged `production` configuration
also composes the full Node JavaScript profile. These are JavaScript configurations;
direct TS/TSX source linting is outside this project's required scope.

Run ordinary ESLint from the consumer project's directory:

```sh
npx --no-install eslint 'src/**/*.js'
npx --no-install eslint --config ./eslint.config.js src/page.js
```

With this package installed, `resilient-check` runs configured ESLint and audits
the selected source's exceptions. It reports ordinary terminal diagnostics by
default. Request JSON when a tool needs the complete result:

```sh
npx --no-install resilient-check src/page.js
npx --no-install resilient-check --json 'src/**/*.js' > lint-results.json
```

The JSON contains `results`, `exceptions`, and `exitCode`. Each ESLint result
retains its file path, active `messages`, `suppressedMessages`, and severity
counts. Exception-audit problems are separate entries. Active errors, fatal
errors, or audit problems produce a failing status; warnings alone do not.
The CLI accepts `--fix`, `--json`, and file/glob patterns. Use ordinary ESLint
for its additional flags, including explicit config selection.

`--fix` audits the selected source before applying configured fixes. Review the
source diff and affected behavior afterward. An autofix establishes neither the
intended product contract nor behavioral equivalence.

An active finding, a finding ESLint suppressed, and a directive occurrence are
different observations. One directive can suppress several findings or none.
The checker enforces unused directives as errors. A recorded reason explains
what the author claims; review and behavior establish whether that claim holds.
This JSON is a lint/audit result, not a certificate of complete configuration,
external-input, or implementation identity.

## Measure a project and inventory exceptions

Use `resilient-measure` for read-only adoption reporting under the consumer's
ESLint configuration. Install the package and a compatible ESLint as development
dependencies, then create your own flat configuration. For a Node JavaScript
project with `"type": "module"`, `eslint.config.js` can contain:

```javascript
import production from 'eslint-plugin-resilient/production';

export default production({ aliases: { '@': 'src' } });
```

The production factory enables all four presets with Node globals. Compose
appropriate globals and presets for other environments. From the consumer's root:

```sh
mkdir -p reports/resilient
npx --no-install resilient-measure --config eslint.config.js --report reports/resilient/before.json 'src/**/*.js'
```

The command prints JSON and saves the report without fixing source or using
result caching. Paths and globs select your project's JavaScript. To measure
another project, pass `--project ../application`; patterns, configuration and
report paths are relative to that project root. The report parent must exist.

Read `complete` and each file's `complete`/`problems` first. Then review:

- `summary.active`: measured file count, violations, errors, warnings and counts by rule.
- `summary.suppressed`: the findings hidden by configured directives, also grouped by rule.
- `summary.exceptions`: exception sites, directives and audit-problem counts.
- `active`, `suppressed`, `exceptions`, `auditProblems`: locations, operation text and authored reasons for individual findings or boundaries.
- `identity`: source selection, observed configuration identities and tool fingerprints needed to interpret comparisons.

For a compact terminal view of the saved report:

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

const { complete, summary, identity: { environmentSha256 } }
    = JSON.parse(readFileSync('reports/resilient/before.json', 'utf8'));
console.log(JSON.stringify({ complete, environmentSha256, summary }, null, 2));
JS
```

Repair findings while preserving the intended application behavior, review
exception boundaries, and save a second measurement with the same profile:

```sh
npx --no-install resilient-measure --config eslint.config.js --report reports/resilient/after.json 'src/**/*.js'
npx --no-install resilient-audit --inventory 'src/**/*.js'
npx --no-install resilient-audit --inventory --unused 'src/**/*.js'
```

Compare findings by rule alongside suppressed findings and exceptions. Record
changes in file selection, configuration, Node, ESLint or Resilient versions.
The report supplies evidence about expression of the configured dialect; it does
not assign a numeric fluency score. Complete capture and reduced finding counts
do not establish runtime correctness. Run your application's own tests as well.

These installed commands are consumer development/CI tooling. This repository's
`npm run lint`, `lint:report`, test, package-check and release scripts belong to
Resilient development and are not added to the consumer's `package.json`.

Both commands share one configured lint and parsed-source inventory. Schema 3
contains active and suppressed findings, every ESLint directive comment, audited
exception entries and policy problems, source/tool hashes, and the physical
configuration selected for each file. Discovery follows the installed ESLint
host; `--config` selects an explicit profile for the measurement.
Configuration identity covers the observed selected files and effective directive
policy; it excludes transitive executable imports and hidden closure state.
Schema 3 retains the schema-2 finding fields. `identity.tool.dependencies`
contains resolved package versions, manifest hashes, dependency edges and missing
packages for the tool's declared runtime/peer closure. `identity.projectInputs`
contains the nearest ancestor package manifest, its installed dependency closure
(including root development dependencies), and hashes of lockfiles in the nearest
ancestor lockfile directory. npm, pnpm, Yarn and Bun lockfiles are recognized.
`identity.environmentSha256` combines tool, Node and project-input identity.

These records describe observed metadata; they do not hash every dependency's
implementation bytes or prove that installed packages match a lockfile. Unavailable
declared packages remain listed as missing. Changes to observed metadata during
lint make the report incomplete. Reports cannot overwrite captured identity inputs.

Ordinary measurement preserves configured severities, `noInlineConfig` and
unused-directive settings. `--unused` explicitly selects an unused-directive
reporting profile while respecting disabled inline directives. Exception usage
distinguishes reported-unused, not-reported-unused, unavailable and ignored;
absence of an unused finding alone does not prove a directive was necessary.

Complete measurements and inventory views exit successfully even with findings
or policy problems. Missing capture, ignored/unconfigured selected source, parse,
scope, configuration and I/O failures fail explicitly. Default `resilient-audit`
without `--inventory` enforces exception policy. In the Resilient checkout,
contributors can also invoke `node scripts/audit-eslint-exceptions.js --inventory`;
consumers use the installed `resilient-audit` binary.

`--report` atomically replaces a JSON report in an existing parent directory.
It rejects selected source/configuration/tool paths and symlink destinations.
Source bytes are checked for changes during measurement. Capture retains plain
report records rather than each file's SourceCode and analyzer state.

## Consumer CI enforcement and report artifacts

Use the [consumer CI example](../../README.md#consumer-ci-enforce-policy-and-retain-the-measurement)
to run `resilient-check` as the policy gate and `resilient-measure` as a separate
reporting step over the same source selection and root configuration. Measurement
and artifact upload run after a failed policy check while preserving the job's
failure. A successful measurement with findings does not make enforcement pass.
Measurement failure remains a job failure too. Run the application's own tests
separately; these commands do not execute them or apply fixes in CI.

## Trace the responsible boundary

For a contract finding:

1. Identify the highlighted call, pattern, property, operation, or return.
2. Read the actual signature/default, argument, guard, alias, return, and module
   relationships that establish its value. Keep producer and consumer roles clear.
3. Identify which known contribution disagrees and which inputs remain unknown.
4. Repair the owner responsible for the intended behavior. Keep valid supplied
   falsey values, native failures, getters, receiver identity, and cleanup intact.
5. Check the repaired behavior and rerun the configured rule.

For example, an array-producing function followed by `.trim()` has a disagreeing
consumer. Changing that producer to return text could break its other callers.
If the desired job is to trim every item, the consumer needs the corresponding
collection operation and each element's own agreement.

An operation message can name an imported source producer when its location has
been established. Other findings expose the relevant location without a complete
derivation path. A missing hint is not evidence that the value is valid or that
the producer is external.

## Query the current analysis model

For a JavaScript source question, use the public analyzer:

```javascript
import { createAnalysis } from 'eslint-plugin-resilient/analyzer';

const source = 'const make = () => [];\nmake().trim();';
const analysis = createAnalysis({ source, filename: 'example.js' });
const operations = analysis.memberAccesses
    .filter(({ call = false } = {}) => call)
    .map(({ index = -1, location = {} } = {}) => ({
        location,
        result: analysis.checkMemberAccess({ index })
    }));
```

The descriptor supplies the source location and the index owned by this session.
`checkMemberAccess` returns established receiver conflicts, the expected family,
uncertainty, and available producer locations. It checks supported native identity
and evidence; a familiar method spelling alone does not prove native behavior.

Select descriptors for the question being asked:

| Descriptors | Query | Meaning |
| --- | --- | --- |
| `memberAccesses` | `checkMemberAccess` | Supported member lookup/invocation evidence, receiver conflicts, and producer locations. |
| `destructurings` | `checkDestructuring` | Known source family against the binding's expected container. |
| `destructuringFields` | `checkDestructuringField` | Named-field presence and evidence at the owned pattern boundary. |
| `calls` | `checkCall` | Requirements and actual arguments at a call, with reached obligations and available origins. |
| `calls` | `checkCallResult` | That call's result-family question and possible normal/thrown completion. |
| `functions` | `checkFunction` | Producer normal-return consistency, return locations, possible completion, and established returned-parameter identity. |

Pass `{ index }` from the corresponding descriptor collection. `checkCallResult`
requires an explicit consumer requirement, for example `{ index, required: 'array' }`. A
function-level answer is not a promise derived from one selected invocation.
An unknown normal value, normal undefined, and no normal completion are different
results. Parsing, source reads, observer failures, and exhausted limits throw;
they do not become successful empty findings.

The direct source API does not load an ESLint configuration or return configured
messages/severities. Its imports stay unresolved without a supplied source resolver.
`createProgramAnalysis` accepts an already parsed ESTree Program when the host owns
the parser. Use a new session after changing source, parser output, or dependencies;
previous results describe their original snapshot.

## Current inspection boundaries

Use `resilient-inspect` to select a source location under the project's actual
ESLint configuration:

```sh
npx --no-install resilient-inspect src/page.js --config ./eslint.config.js --find 'values.trim()'
npx --no-install resilient-inspect src/page.js --offset 120
npx --no-install resilient-inspect src/page.js --standalone --find 'values.trim()'
```

`--find` requires unique text; `--offset` is a UTF-16 source offset. The command
does not fix source. Its JSON separates active findings, suppressed findings,
current-model observations and unknown boundaries. It records acquired files,
the selected config file/hash, parser metadata and effective severities.
Configuration identity does not include every transitive executable input.

`--standalone` is an explicit config-free mode using the current five-contract-rule
profile, JavaScript parser and relative source closure. It reports that built-in
profile and mode rather than claiming project-configured policy. It can inspect
source outside the command's cwd. Project configuration is not loaded, and combining
`--standalone` with `--config` fails. Configured failures never trigger fallback.

The inspector uses the same configured parser and shared analyzer session as
the rules. Available observations identify producer locations, consumer
requirements, conflicts and incomplete evidence. Observations are not additional
configured findings: disabling a rule can leave model facts visible without
creating a diagnostic. A call-result query needs an authored consumer requirement;
the inspector does not invent one from the selected text.

There is no public graph/evidence-ID browser or shortest-path derivation API.
Ignored files, processor-backed sources without a physical mapping, parse
failures and invalid cursors fail explicitly. Operational failure does not
become a successful empty explanation.

Configured ESLint consumes its root parser's tree. JavaScript dependencies are
parsed with Espree; the root's custom parser is not propagated. Direct `.ts`/`.tsx`
dependency parsing remains outside scope. Explicit and adapter-selected context
roots contribute evidence through the same JavaScript module closure.
Do not infer TS/TSX project support from a supplied-root-AST test.

`resilient-lower --inspect` reports a TypeScript lowering plan. Its `--report` path
accounts for lint coverage and active/suppressed findings on generated JavaScript;
it is a separate workflow from inspecting a diagnostic's source derivation. See
the [TypeScript guide](../engineering/typescript.md) for compiler acquisition,
requirements, emitted artifacts, and intentional normalization.

## Share an actionable explanation

Include the source revision, command/configuration, rule ID, location, and actual
message. State the producer evidence, consumer requirement, known disagreement,
remaining unknown boundary, proposed repair, and representative behavior checked.
When an exception is necessary, name the exact rule and semantic reason under
[P-03](../reference/policy.md#p-03-exceptions-and-precedence). A clean lint result
and a behavior-preserving repair establish different properties.
