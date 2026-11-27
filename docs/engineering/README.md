# Engineering documentation

The maintained engineering guides describe the current package and the contracts
that future changes must preserve.

| Question | Guide |
| --- | --- |
| Which layer owns evidence, execution, policy and delivery? | [Architecture and analysis contracts](architecture.md) |
| Which dialect rules work end to end, and what bounded repairs remain? | [Dialect analyzer capability map and completion plan](analyzer-completion.md) |
| How does another agent continue a guarded repair or recover from failure? | [Analyzer handoff checklist](analyzer-completion.md#guarded-handoff) |
| Where do built-in exposure and local opacity erase known findings? | [Evidence erasure accountability report](evidence-erasure.md) |
| What does TypeScript lowering support and preserve? | [TypeScript project lowering](typescript.md) |
| Which predecessor capabilities survived, changed or remain missing? | [Feature review](feature-review.md) |

The [language references](../reference/README.md), [rule pages](../rules/), and
[writing guide](../ai/writing-resilient.md) govern language and policy choices.
[Essays](../blogs/README.md) explain the design intent; they do not establish
implementation coverage.

## Verification

Work in an isolated candidate while the active workspace retains its last verified
checkpoint. Validate the final candidate with the required gates before promotion;
promote exact verified bytes and record matching hashes. Reopen acceptance after
any subsequent source change. Preserve concurrent user edits. Review seeks real
supported-contract failures, not a required number of findings; P0–P3 defects
remain blockers. Functional forms, destructured boundaries, prototype collection
methods and arrow function expressions are acceptance requirements throughout.
The recommended and repository configs use core ESLint `no-restricted-syntax`
to reject authored traditional function expressions, including property-valued,
async and generator forms. Object protocol methods and accessors remain distinct;
the analyzer still understands traditional functions in source inputs. Necessary
native/source-oracle test exceptions name that exact rule and their concrete
semantic reason. The frozen language references are unchanged.

Every loop remains a `prefer-prototype-methods` finding unless its owning source
has an exact-rule, concrete-reason exception. Async work and synchronous I/O do not
silently waive this policy. Conversely, an async `forEach` callback is not a valid
substitute: `forEach` does not own its returned promise.

Async protocol verification includes native counterexamples for escaped promise
envelopes, escaped nonpromise thenables, borrowed aliases and closures, opaque
`Promise.resolve` identity, and abrupt aggregate acquisition. The checks in
[async protocol lifetimes](../../tests/promise-contracts-public.test.js) distinguish
those failures from intact-envelope observations and already completed adoption.
They also execute nested carrier returns, awaited nonpromise aliases, publication
inside one declaration, rejection carriers and guarded native resolve alternatives.
Later observations must retain identity after pure native forwarding. Lifetime
permission ends when a consumer publishes its result; array nesting does not count
as recursive adoption. Repeated-call width and publication depth have explicit
retained-model and demand bounds.
Native constructor lookup failure is checked as synchronous completion separately
from a plain thenable's rejection. Discarding or testing an awaited result still
executes its protocol; inert awaits must retain established field evidence.
[Selected member lifetimes](../../tests/promise-contracts-public.test.js) cross
record and array fields, BigInt keys, aliases, copies, rest, coercion and conditional
uses. A literal carrier acquires its selected value before publication retires the
source snapshot. Primitive transfers and inert observations retain their evidence.
Closed captures retain their property reads; selected return values use the
existing return boundary, with mutable return counterexamples checked alongside.
Successive constructor lookups and independently varied carrier width/field depth
have retained-storage, demand and warm-reuse assertions, with deliberate faults
that must fail semantic assertions.
Shallow-copy checks preserve primitive siblings while retiring copied child payloads
and protocols. Earlier selected aliases, nested destructuring, closure creation
order, conditional publication, equivalent property keys and already acquired
primitives have paired native controls. Missing-property diagnostics belong to
the original lookup, including when its value has a publication wrapper.
[Copy retirement laws](../../tests/copy-retirement-laws.test.js) bound shared
projection graphs and descendant publication histories, with interrupted retry,
warm reuse and deliberately duplicated-history controls.
[Protocol graph laws](../../tests/promise-contracts-local.test.js) check payload
retirement and lifetime selection separately, shared width/depth bounds, warm reuse
and interrupted retry.
The identity composition fixtures use fresh envelopes; an opaque native resolve
result is not a valid untouched-protocol control.

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

The under-69-second limit (target: 50 seconds or less) applies only to the
separately measured self-lint command, `npm run lint`. There is no current
elapsed-time budget or timeout for `npm run check`; its total duration includes
the tests and isolated package installation as well as lint.

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

Readable code counterexamples belong under the owning rule in
`tests/fixtures/bad.js`, with the expected finding, a fluent valid neighbor where
useful, and a stable comment ID. Existing public harnesses consume those examples;
do not create another suite for each failure. A runtime failure or artificial
stress specimen alone does not establish a required dialect workflow. Distinguish
product obligations, adversarial controls and legitimate unknown boundaries.

Remove tests that only mirror implementation, duplicate an existing assertion or
treat labels, file existence and incidental counts as proof of behavior. Review
one semantic family at a time. Before removing a behavioral example, move its
canonical source to bad.js and identify the retained executable check. Do not
turn an unverified expected finding into a passing acceptance claim.

Prefer a small number of decisive validations of composed public contracts.
Suites follow durable semantic owners rather than individual repairs. Consolidate
duplicate harnesses and equivalent cases; concatenating their files is not
sufficient. Illustrative unit examples and spelling variants may remain ordinary
comments in bad.js without executable overhead or documentation-test tooling.
The [entry contracts](../../tests/entry-contracts.test.js) join native observations,
public admission/completion, configured findings and retained-value resource
bounds under one owner. Each executable check needs a distinct useful property.
Calls and completion, absence and signatures, shapes and lifetimes, promises and
modules follow the same ownership rule. Compiler evidence, collection/value
lowering, directives, project delivery and emission retain composed observations
under their respective owners. Keep workspace evidence checks separate from
installed-package contracts; sharing a filename must not weaken that boundary.

Keep checks that establish semantic properties, failure identity, revisions,
query-order independence, ownership, delivery or a meaningful work/storage bound.
Generated width/depth inputs may remain in those checks when generation is needed
to establish the named property; they are not a separate feature backlog. Use
independent oracles where they establish those properties. Integration jobs must
exercise the real parser, analyzer, compiler, rules or installed commands.
Historical source replay and formatting snapshots do not replace that evidence.
The [handoff](analyzer-completion.md#guarded-handoff) owns cleanup progress and
bundle stopping rules; receipts and inventories belong in ignored .artifacts.

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

### Analysis guarantees and their verification

The analysis feature set is verified at three connected levels: source laws,
caller relationships, and configured consumer findings. The table identifies
the maintained evidence for each capability; an isolated rule test alone does
not establish a shared mechanism's correctness. Unsupported inputs must keep
their documented uncertainty, while admitted known evidence must not silently
become unknown. The [architecture](architecture.md) owns the premises and
work/storage bounds; these suites exercise those bounds on stated families.

| Capability and guarantee | Shared owners | Maintained evidence | Shared laws |
| --- | --- | --- | --- |
| Independent requirements share facts while preserving known, contradictory and unknown contributions | Agreement requirements, obligations and judgments | [Composition](../../tests/composition.test.js), [obligation results](../../tests/obligation-results.test.js) | evidence, consumer, storage |
| Field presence, absence, nonempty content and family remain distinct | Agreement evidence, field projections and facts | [Agreement](../../tests/agreement.test.js), [family reads](../../tests/agreement-projections.test.js), [optional fields](../../tests/agreement-projections.test.js) | evidence, selection |
| Revisions invalidate dependent proofs before observation; cycles require grounded evidence | Agreement dependencies, source owners and validity | [Invalidation](../../tests/invalidation.test.js), [composition](../../tests/composition.test.js), [record copies](../../tests/shape-contracts-public.test.js) | revision, identity |
| Callers control judgment and projection lifetime; retained history stays immutable | Agreement judgments and weak validity/presence links | [Lifetimes](../../tests/lifetimes.test.js), [obligation results](../../tests/obligation-results.test.js) | storage, revision |
| Acquired evidence is independent of later host AST edits and does not retain host metadata | Source acquisition, model and session | [Source ownership](../../tests/source-ownership.test.js), [source acquisition](../../tests/source-acquisition.test.js), [analyzer retention](../../tests/retention-contracts-local.test.js) | identity, storage |
| Boolean identity, complement, selection and projection preserve alternatives and resource failures | Decisions and value conditions | [Decision identities](../../tests/decision-identities.test.js), [flow adversaries](../../tests/completion-contracts.test.js) | selection, completion, storage |
| Primitive operations, coercion completion, truth and defaults preserve supplied values | Primitive expressions, values and demand | [Primitive evidence](../../tests/call-contracts.test.js), [flow adversaries](../../tests/completion-contracts.test.js), [call defaults](../../tests/entry-contracts.test.js) | evidence, completion |
| Ordered record writes, rest exclusions and discriminator/payload conditions survive forwarding | Agreement record evidence, record fields and model | [Record copies](../../tests/shape-contracts-public.test.js), [field forwarding](../../tests/consumer-contracts-public.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | selection, lifetime |
| Admitted array positions, holes, spreads and iterator completion retain their meanings | Patterns, argument positions and array transfers | [Array slots](../../tests/shape-contracts-public.test.js), [array completion](../../tests/shape-contracts-public.test.js), [use selections](../../tests/use-selections.test.js) | selection, completion |
| Call arity, defaults, nested requirements and native call/apply preserve actual boundary obligations | Signatures, calls and invocation contexts | [Calls](../../tests/call-contracts.test.js), [call adversaries](../../tests/call-contracts.test.js), [outcome obligations](../../tests/completion-contracts.test.js) | consumer, identity, completion |
| Source-wide contracts remain independent of actual callers and query order | Analysis session, source queries and demand | [Source-query composition](../../tests/source-query-composition.test.js), [invocation sharing](../../tests/call-contracts.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | consumer, identity |
| Captures retain creation identity and cannot replay initializers or borrow another invocation's values | Environments, bindings and capture demand | [Captured values](../../tests/lifetime-contracts.test.js), [binding lifetimes](../../tests/lifetime-contracts.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | identity, lifetime, storage |
| Presence/callability guards and returned consumer roles remain local to their uses | Capabilities, declarations, forwarding targets and uses | [Defaults](../../tests/signature-policy.test.js), [use roles](../../tests/consumer-contracts-public.test.js), [forwarding](../../tests/forwarding-audit.test.js), [signature placement](../../tests/signature-policy.test.js) | consumer, lifetime |
| Normalizers establish only the tested facet, including the open meaning of empty fallbacks | Guard evidence, values and shape selection | [Normalization](../../tests/call-contracts.test.js), [guard evidence](../../tests/call-contracts.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | evidence, selection |
| Return, throw, catch, finally and admitted loop completion preserve their owner and reachability | Flow, outcomes and demand | [Completions](../../tests/completion-contracts.test.js), [outcomes](../../tests/completion-contracts.test.js), [outcome adversaries](../../tests/completion-contracts.test.js) | completion, identity |
| Native collection callbacks preserve position, early completion, effects and result ownership | Operation descriptors, member boundaries and collection demand | [Evidence closure](../../tests/evidence-closure.test.js), [native evidence](../../tests/call-contracts.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | selection, completion, lifetime |
| Async adoption and aggregate shapes preserve fulfillment, rejection and status/payload correlation | Promise ownership, settlements and outcomes | [Async aggregate shapes](../../tests/promise-contracts-public.test.js), [promise ownership](../../tests/promise-contracts-public.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | completion, selection, lifetime |
| Aliases share receiver lifetime; harmless observation preserves it and real exposure retires it | Member boundaries, model and lifetime demand | [Caller lifetimes](../../tests/lifetime-contracts.test.js), [lifetime observations](../../tests/lifetime-contracts.test.js), [member composition](../../tests/lifetime-contracts.test.js) | lifetime, identity |
| Known computed keys and native/prototype identity remain separate from spelling policy | Property-name interpretation and native/member boundaries | [Property keys](../../tests/property-key-evidence.test.js), [native evidence](../../tests/call-contracts.test.js), [falsifiable keys](../../tests/rule-contracts.test.js) | identity, evidence |
| ESM identity, reexports, configured roots and initialization do not transfer unrelated return provenance | Module acquisition, declarations and module demand | [Module signatures](../../tests/module-contracts-public.test.js), [configured roots](../../tests/module-contracts-public.test.js), [composition oracle](../../tests/analysis-composition-contracts.test.js) | identity, completion |
| Operational failures propagate; interrupted work cannot publish completed proofs | Acquisition, demand, decisions and observer delivery | [Analyzer API](../../tests/source-acquisition.test.js), [query interactions](../../tests/query-interactions.test.js), [decision identities](../../tests/decision-identities.test.js) | revision, consumer |
| Configured diagnostics preserve exact ownership and accept fluent valid neighbors | ESLint adapters, rules and production configuration | [Semantic obligations](../../tests/semantic-obligations.test.js), [product workflows](../../tests/product-workflows.test.js), [rule inventory](../../tests/rule-canary.test.js), [installed configuration](../../tests/installed/production-configuration.test.js) | consumer, evidence |

The shared law names describe existing owners, not another runtime layer. Each
feature above must preserve its applicable laws at the acquisition, transfer and
consumer boundaries. The bounded verification obligations are:

| Law | Independent expectation and relevant transitions | Failure detector and resource evidence |
| --- | --- | --- |
| evidence | Supplied, missing, unresolved and contradictory contributions stay distinct; unknown cannot hide an independent conflict. | The existing finite field-state matrix in [composition](../../tests/composition.test.js); the unknown-over-conflict fault; shared-requirement and field-contribution bounds in that suite. |
| selection | Reached branches, ordered writers, exclusions and positions keep their corresponding values. | Native execution in the composition oracle, record-copy expectations and the lost-guard, wrong-writer and wrong-position faults; [successive copy selection](../../tests/promise-contracts-public.test.js) and Boolean bounds in [decision identities](../../tests/decision-identities.test.js). |
| identity | A capture belongs to its creation, module initialization has its own completion, and known source keys retain their evidence independently of spelling policy. | Creation-instance, ESM provenance and computed-key tests with corresponding faults; [capture work](../../tests/lifetime-contracts.test.js), acquisition and host-retention checks. |
| lifetime | Observation preserves a receiver; actual exposure or mutation retires the relevant premise. | Valid, contradictory and exposed neighbors in [caller lifetimes](../../tests/lifetime-contracts.test.js), with callable and truth-test faults; source-use growth and warm-reuse assertions. |
| completion | Return, throw and finalization retain their owner; settlement status selects its payload; competing rejections do not acquire a positional winner. | Runtime return/throw observations, two executable rejection orders and unique-rejection controls; finalizer, settlement-condition and rejection-order faults; aggregate-position work bounds. |
| consumer | Each requirement gets its own judgment; supplied caller values cannot rewrite a generic source contract. | Each synchronous supplied result is checked against seven contrary requirements using its runtime observation. A fixed-requirement fault must fail. Query-order and warm-demand checks retain their existing resource expectations. |
| revision | Source replacement invalidates dependencies, historical evidence stays historical, and interrupted work remains retryable. | Existing revision tests plus late interruptions at observed semantic stages, followed by a contrary consumer, generic query and original retry; the stale-evidence fault and bounded diamond invalidation. |
| storage | Callers own relationships and output lifetime; shared source structure does not retain discarded callers or expand into path lists. | One caller collects while another remains live and receives revision invalidation; strong-projection and unnecessary-direct-call-edge faults; [retention](../../tests/lifetimes.test.js), unchanged model-size and shared-diamond work bounds. |

The composition oracle reuses the same closed programs through direct bodies,
forwarding, captures, imports and reexports. It compares generic result families,
completeness, normal completion and return findings with native execution. The
same runtime observations independently check each synchronous supplied call
against every call-result requirement already queried. Async invocation and
awaited fulfillment remain separate questions; no raw promise-family evidence
is invented to make an assertion pass. Module variants execute actual ESM files.
Generic parameters in these fixtures are used only where the finite runtime
inputs cover the promised result alternatives; a default never restricts every
possible supplied value.

[Record carrier compositions](../../tests/record-carrier-compositions.test.js)
cross six producers, twelve carriers, five consumers and three literal key forms,
using native execution for result families and supplied-call requirements.
[Settlement identity compositions](../../tests/async-identity-compositions.test.js)
cross conditional/repeated slots, forwarding forms and copied statuses. Their
runtime witnesses include both primitive payloads and objects whose later `then`
reads differ, so opaque async readoption cannot inherit a primitive-only oracle.
[Record field laws](../../tests/record-field-laws.test.js) compare 3,000 finite
graphs with a flat reference model in both query orders and after source revision;
they also inspect retained contributions with independently varied width/depth.
That private graph inspection runs in the workspace; the installed gate still
runs the public record-copy and source-composition suites.

The field-law suite also crosses 12,000 larger graphs with aliases, exclusions,
explicit writes and retirement. Its three consumer judgments preserve grounded
absence and known families even when equivalent uncertainty representations differ.
[Rejection contribution laws](../../tests/promise-contracts-local.test.js) check
guarded identity, unknown failures, finalizers, interruption recovery and shared
graph bounds. Public async tests compare repeated/conditional rejection sources
and escaped rejection payloads with native execution and configured diagnostics.

Every public query group is interleaved in independent sessions with contrary
requirements and warm repeats. Eight direct compositions additionally interrupt
the last observed occurrence of each applicable function-context, flow,
establishment or aggregate stage. A different requirement and a generic query
use the interrupted session before the original query retries. This bounds
schedules by shared state transitions rather than all query permutations.

[Proof controls](../../tests/analysis-proof-controls.test.js) establish a passing
baseline in disposable copies, introduce one explicit semantic fault, and require
an assertion failure. The fault inventory accounts for every law above. That
inventory check establishes bookkeeping; the passing baseline and failing fault
establish sensitivity. Import failures, syntax failures and timeouts do not count
as detection. Fixtures and fault descriptions are test inputs, not production hooks.

Work/storage obligations belong to their existing mechanisms. The added diamond
check bounds establishment and invalidation by its 3D + 1 owned nodes and 4D
edges, including warm contrary requirements, repeated dirty revisions and retained
history. Caller collection must preserve the other caller's usable evidence and
subsequent invalidation. These checks supplement existing wide/successive joins,
Boolean limits and source-use bounds; they make no universal linearity or
whole-language soundness claim. Exact observations do not establish arbitrary
external data or an unspecified promise reaction order.

Every transformer change requires `npm run check:fp-ts` on the final tree, in
addition to `npm run check`. Shared analyzer, policy and delivery changes that
affect lowering require the same run. Run both commands sequentially.
The full fp-ts run is the main transformer acceptance test. Its pinned
adversarial input stays local and ignored in `tests/fixtures/fp-ts`; do not check
the corpus into version control. The maintained runner is
`scripts/check-fp-ts.js`. Neither is a shipped runtime dependency. Use
`npm run check:fp-ts -- --offline` when the local npm cache is already populated.

The runner packs and installs the current workspace, verifies installed bytes,
then executes all 1,818 upstream cases against native, raw lowered and fixed
JavaScript. It rejects source fallback, wrong variants, missing module loads,
changed input bytes, mismatched cases and emitted errors. All 123 emitted
modules must load in each variant. The 30 existing `prefer-async-await` warnings
are accepted; other post-fix diagnostics fail. Preserve the corpus's five
documented non-asserting property bodies as an explicit coverage limitation.
The isolated input copy declares ESM package scope; source and test bytes remain
pinned. See `input-manifest.json` for provenance and hashes.

Each run prints and retains `.artifacts/fp-ts-poc/runs/run-*`, including
`acceptance.json`, `consumer/fluency.json`, `consumer/manifest.json`, load/test
receipts, `consumer/output/src` (published fixed JavaScript), and
`consumer/output.resilient-artifacts/{raw,fixed}/src`. A failed run remains
available for inspection. Do not substitute a small lowering fixture for this
gate or silently change its accepted diagnostics. Every emitted error blocks
acceptance and must be traced to a newly exposed lint or a regression. A checkout
without the private corpus cannot establish transformer acceptance; an ordinary
CI pass is insufficient.

Other external projects remain consumer POCs. Further projects should exercise different boundaries
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
