# Engineering documentation

The maintained engineering guides describe the current package and the contracts
that future changes must preserve.

| Question | Guide |
| --- | --- |
| Which layer owns evidence, execution, policy and delivery? | [Architecture and analysis contracts](architecture.md) |
| What does TypeScript lowering support and preserve? | [TypeScript project lowering](typescript.md) |
| Which predecessor capabilities survived, changed or remain missing? | [Feature review](feature-review.md) |

The [language references](../reference/README.md), [rule pages](../rules/), and
[writing guide](../ai/writing-resilient.md) govern language and policy choices.
[Essays](../blogs/README.md) explain the design intent; they do not establish
implementation coverage.

## Verification

The npm scripts and direct `node scripts/...` paths documented here are for
development and CI in the Resilient repository. Consumers use the installed
commands against their own configuration; installing this package does not add
these npm scripts to their project. The
[consumer measurement guide](../guide/diagnostic-explanations.md#measure-a-project-and-inventory-exceptions)
shows how to measure a consuming project's fluency. These are development tools,
not application runtime features.

Use Node matching `package.json`'s `engines.node` and npm on PATH. From the
repository root:

```sh
npm ci
npm run check
```

GitHub Actions selects Node from `package.json` and runs `npm ci` followed by
`npm run check` on pushes and pull requests. Generated `.artifacts/` contents
are disposable; commands recreate their output directories as needed.

The gate runs dialect lint and the exception audit, internal tests in the
workspace, and public tests through a normal isolated package installation.
Every maintained top-level suite runs in one environment. Installed host checks
exercise package delivery, consumer configuration, diagnostics and lowering.
`npm test` runs the workspace suites for development; `npm run check:package`
runs the complete test/install gate without lint.

Reporting-owner tests exercise real configured measurement and inspection in the
workspace; installed command tests retain argument, output, discovery and exit
contracts. Configuration changes are also exercised successively in one process
to expose leaked policy or analysis state.

## Release preparation

The repository's [release command](../../scripts/release.js) retains the
`release` and `release:check` workflow. `npm run release:check` validates version
consistency and the changelog before running `npm run check` and
`git diff --check`.

Use `npm run release -- patch --dry-run` to preview a new patch from generic
`## Unreleased` notes, or select `minor`, `major` or an explicit version. Remove
`--dry-run` to prepare and verify. A named `## X.Y.Z — Unreleased` entry must
match the requested version; explicitly selecting the current package version
can finalize that entry without a second increment.

Preparation owns package.json, package-lock.json, both plugin metadata files and
CHANGELOG.md. It preserves earlier release history and restores prior bytes if
verification fails, reporting concurrent changes rather than overwriting them.
The script remains repository tooling; commits, tags and publication are manual.

## Functional checks

Keep tests that demonstrate a semantic requirement, contradiction, failure,
revision, ownership boundary or meaningful work bound. Use independent oracles
where they establish those properties. Integration and pipeline jobs should
exercise the actual parser, analyzer, compiler, rules or installed commands.
Historical source replay, incidental counts and formatting snapshots do not
replace that evidence.

The local `tests/fixtures/bad.js` canary has executable negative anchors for all
exported rules. Its public integration test also checks explanations and valid
controls. Editors and direct ESLint expose the canary's findings; the default
`npm run lint` excludes test fixtures from package verification. Pass a fixture
path explicitly to that command to see its findings. Fixtures remain visible
to development linting.

### Repository lint command usage

Use npm's `--` separator to pass arguments to `scripts/lint.js`:

```sh
npm run lint
npm run lint -- analysis/agreement/estree.js
npm run lint -- 'analysis/**/*.js' 'transforms/**/*.js'
npm run lint -- --concurrency 3 'analysis/**/*.js'
npm run lint -- --concurrency off
npm run lint -- --concurrency auto
npm run lint -- --report --stats 'analysis/**/*.js'
npm run lint:report -- --stats 'analysis/**/*.js'
npm run lint -- --help
```

The wrapper fixes its cwd and configuration to this repository. Quote globs;
multiple paths and patterns are supported. The default batch excludes test
fixtures; explicit paths retain development access to the canary. Concurrency
defaults to six workers. `--report` saves `.artifacts/lint-results.json`, and
`--stats` adds per-file rule timings to that report. `lint:report` already supplies
`--report`; arguments after `--` are appended to it.

This wrapper does not accept arbitrary ESLint flags, including `--fix`, `--config`
or `--json`. To apply configured fixes in the checkout after an exception audit:

```sh
node scripts/check-eslint.js --fix 'analysis/**/*.js' 'transforms/**/*.js'
```

The checker applies available rule fixes, including `import/order`. Inspect the
diff and verify affected behavior. Consumers invoke `resilient-check --fix` from
their own project rather than using a checkout-relative script path.

## Lowering acceptance

For a transformation change, establish the authored native result first, then
execute raw and fixed JavaScript. Check evaluation and failure order, receiver
and provided-value identity, callbacks, iteration and cleanup where relevant.
Assert failure identity within each variant before serializing observations.
Record the actual modules executed; tests silently falling back to original
TypeScript do not prove the emitted program.

Behavioral parity, complete lint reporting and dialect cleanliness are separate
results. Keep active findings, suppressions, configuration identity and all
measured files visible. An exception needs an exact rule, boundary and semantic
reason; unknown data and a passing test do not authorize blanket suppression.

External projects are consumer POCs outside the mandatory gate. The fp-ts POC
remains under ignored `.artifacts/`; it is not a package dependency or a generic
customer proof command. Further projects should exercise different boundaries
rather than duplicate its cases. See the [feature review](feature-review.md)
before claiming direct TS/TSX linting or automatic external test discovery.

## Measurements and delivery

Use `resilient-measure [--project directory] [--config file] [--report file]`
with selected file/glob patterns for consumer reporting. `resilient-audit
--inventory [--unused]` is a view of the same reporting owner; the legacy
`node scripts/audit-eslint-exceptions.js --inventory` path also works.
Inventory reuses ESLint's parsed SourceCode synchronously and retains only
plain report data afterward. Complete report status is separate from lint or
exception enforcement; `resilient-check` and default audit mode enforce policy.

Schema 3 fingerprints selected physical configuration files observed after lint,
effective directive policy, measured source and the package's owned tool files.
It also fingerprints resolved package manifests/versions and the nearest consumer
manifest/lockfiles; missing declared dependencies remain visible. The environment
fingerprint includes Node, tool and project-input identity. It does not hash every
third-party implementation byte, validate the install against the lockfile, or
fingerprint transitive executable configuration imports. Identity inputs are
snapshotted once per measurement and checked again before reporting completion.
Package traversal is bounded by unique observed manifests, declared edges and
Node's ancestor package-search paths. The records do not certify external runtime
behavior. An explicit `--unused` run labels its reporting
profile and preserves `noInlineConfig`; normal measurement keeps consumer policy.

`check:package` reports command timings separately for internal tests, public
tests, installed-host tests, packing, installation and dependency inspection,
plus orchestration outside those commands. Lint prints its analysis and exception
audit timings separately. Test execution and installation time do not establish
analyzer throughput.

Run a measurement to answer a stated correctness, fluency or cost question.
Report its workload, configuration, runtime and concurrency. Self-lint timing
does not establish every analyzer or lowering workload's performance. Shared
indices and completed facts need explicit work/storage bounds under composition.

```sh
npm run lint -- --report --stats
npm run lint -- --concurrency off 'analysis/**/*.js'
```

Reports and disposable installations belong in `.artifacts/`. Package checks
compare shipped workspace and installed bytes and reject imports outside the
consumer. Dependency versions, policy and frozen references must not be silently
changed to obtain a passing result.

## Documentation maintenance

Update these guides when an interface or semantic boundary changes. Keep
investigations, chronological handoffs and run-specific evidence out of the
active guides. Earlier engineering records were collected with byte manifests
for export and removal. Active guides, tests and commands do not require that
historical archive.
