# Package and analysis architecture

Resilient is one package containing agreement, JavaScript analysis, ESLint policy,
and TypeScript lowering. Runtime imports resolve inside the package or through
declared dependencies. [Grammar](../reference/grammar.md),
[Policy](../reference/policy.md), [Semantics](../reference/semantics.md), and the
[coding standards](../ai/CODING_STANDARDS.md) govern its implementation.
The [agreement map](../reference/AGREEMENT_MAP.md) connects supporting laws and
proof obligations; the [contract reference](../reference/contracts.md) maps the
current public APIs and [source selection](../reference/tree-resolution.md)
defines the active module boundary.

## Four foundation principles

| Principle | Contract |
| --- | --- |
| Agreement | Compare producer evidence with independently owned consumer requirements. |
| Identity and ownership | Preserve source, binding, field, callable, and invocation identity; equal spelling or shape cannot transfer proof. |
| Demand | Establish the requested facet through shared source facts and ordered execution evidence. |
| Change | Track premise revisions, invalidate dependent knowledge, and rebuild only when demanded. |

Requirement constructors such as `family`, `field`, `content`, and `all` declare
what a consumer needs. They do not supply values or establish successful execution.
Evidence comes from owned syntax, explicit source relationships, and supported
execution. `fromESTree` snapshots the supported structure before returning;
subsequent caller edits cannot change that evidence. Reduced projections expose
only their admitted facets. An annotation or expected default never validates an
actual input.

## Meaning of a result

Known contributions, contradictions, and incomplete evidence remain visible
together. An unknown contribution cannot erase an independently known conflict.
An agreement answers the selected requirement under its owned premises; it does
not certify every dialect rule, external data, or successful runtime execution.

These boundaries stay distinct:

- **Unknown:** the requested evidence has not been established. Unsupported syntax
  and opaque operations retain uncertainty rather than invented values.
- **Contradiction:** established evidence conflicts with a requirement or with
  another contribution belonging to the same producer obligation.
- **Absence:** source-established omission, undefined, bare return, or fallthrough
  has its own meaning. Missing own fields and unknown field presence remain
  distinct. Authored defaults apply only to supported undefined alternatives.
- **No normal completion:** `normal: false` rules out a normal result in the owned
  model. It is separate from an unknown normal value and a normal undefined result.
  Completion summaries are possibilities, not termination or total-safety proofs.
- **Failure:** an analyzed throw is an execution outcome. Parser, filesystem,
  compiler, observer, and resource-limit failures propagate as operational errors;
  they never become successful unknown or empty reports.

## Queries, validity, and composition

The [agreement API](../../analysis/agreement/index.js) separates producer reads
(`readFamily`, `readField`) from consumer judgments (`request`). Producer facts
can be shared across requirements without storing a consumer-answer matrix.

The [analyzer API](../../analysis/analyzer/analysis.js) makes the same distinction
at callable boundaries. `checkFunction` reports established producer return
consistency and possible completion. `checkCall`, `checkCallResult`, and invocation
queries use their actual call boundaries and argument evidence. Caller-specific
facts cannot become a source-wide promise. Shared callable templates retain
separate invocation conditions, evaluation order, and reached obligations.
Catch and finally compose with those same completion owners.

Agreement owners support explicit revisions through `replaceEvidence` and
`replaceAll`. A batch validates its inputs before committing; dependent facts
become stale before observers run. `isCurrent` checks a registered judgment,
`inspect` exposes its historical outcome and validity, and reading a stale
judgment's status throws. Previously returned immutable facts remain historical
data; read the owner again for current evidence. JavaScript source edits require
a new analyzer session, which owns a new source snapshot and module closure.

Cyclic evidence retains reachable known contributions alongside unresolved cycle
evidence. A cycle cannot establish its own missing premise or hide a conflict.
Module initialization and recursive execution likewise require grounded evidence.
Memoization shares completed owned work; interrupted parent work is not published
as a completed answer. Work depends on acquired structure, demanded facets,
invocation contexts, and Boolean decisions; there is no whole-program linearity
or constant-time query guarantee.

Boolean composition memoizes completed operand pairs in session-owned numeric
rows. For N decision nodes and P completed pairs, its three operators retain at
most 3 × (N + 2) rows and P results, alongside the existing projection entries.
Unfinished pairs provide no cached answer; decision limits count the same
completed nodes, pairs and projections as before.

## Layer ownership and public surfaces

| Owner | Responsibility and public surface |
| --- | --- |
| [Agreement](../../analysis/agreement/index.js) | Evidence, requirements, judgments, revisions, and validity; `eslint-plugin-resilient/agreement`. |
| [Analyzer](../../analysis/analyzer/index.js) | Lexical acquisition, modules, callable models, ordered demand, and completion; `eslint-plugin-resilient/analyzer`. |
| [ESLint rules](../../analysis/eslint/index.js) | Syntax policy and projections of shared analysis; `eslint-plugin-resilient/eslint`. |
| [Plugin](../../index.js) and [production config](../../config/production.js) | Plugin identity, presets, import integration, and consumer configuration. |
| [Project adapter](../../integrations/project.js) | Consumer-relative resolution, aliases, and configured root selection utilities. |
| [TypeScript transformer](../../transforms/typescript/index.js) | Compiler source acquisition, policy, rewriting, and emission; `eslint-plugin-resilient/typescript`. Compiler analysis is exported separately at `eslint-plugin-resilient/analyzer/typescript`. |
| [Runtime helpers](../../analysis/host/) | Shared host utilities and emitted `eslint-plugin-resilient/standard/*` helpers. |
| [Check](../../scripts/check-eslint.js), [audit](../../scripts/audit-eslint-exceptions.js), and [lower](../../scripts/lower-typescript-project.js) | Configured lint/fix enforcement, narrow exception enforcement, and project lowering/reporting. |
| [Measurement](../../integrations/measurement.js) | One configured lint and parsed-source inventory for read-only consumer measurement and exception reporting. |

ESLint consumes the public analyzer; the analyzer consumes public agreement.
TypeScript acquisition feeds existing semantic owners and keeps requirements
separate from actual value evidence. Lowering owns deliberate normalization and
must preserve evaluation order, receiver and payload identity, iterator behavior,
and failure ownership. Policy exceptions name an exact rule and semantic boundary;
they provide no missing evidence. Tests, fixtures, documentation, and generated
artifacts are development inputs and do not become runtime dependencies.

Measurement consumes each ESLint SourceCode synchronously to acquire plain
directive/exception records. Its per-run capture map retains no SourceCode,
rule context or analyzer session; completed per-file AST state can be released.
Reports still retain finding records and operation text, and ESLint may retain
source strings. This is not a constant-memory guarantee. Existing AST containment
work in the exception auditor retains its own per-file costs.

Package identity uses one per-report metadata owner. It resolves each dependency
from its declaring package, records distinct nested versions and missing packages,
and snapshots the consumer manifest and nearest lockfile directory. Traversal
visits unique manifests and declared edges with Node's package-search paths;
completed reports retain plain identities, not filesystem loaders or buffers.
The tool hash includes its resolved dependency manifests; the environment hash
also includes Node and consumer inputs. These hashes are scoped metadata evidence,
not a byte census of third-party implementations or executable config imports.

Configured and standalone inspection use the same current analyzer session as
the selected rules. Standalone mode selects a fixed contract profile rather
than loading project configuration. It adds no second graph or analysis engine.

## Current source and module boundaries

`createAnalysis` parses JavaScript with Espree. `createProgramAnalysis` accepts a
valid supplied ESTree Program; ESLint passes its selected parser's actual root
tree into that boundary. This preserves parser ownership without promising full
TypeScript or TSX analysis. Unsupported typed expression wrappers remain unknown.

The [ESLint module host](../../analysis/eslint/support/modules.js) loads JavaScript
dependencies through relative or configured resolution. Dependency text is parsed
with Espree by the [module owner](../../analysis/analyzer/modules.js); the root's
custom parser is not propagated. TypeScript dependency parsing is unsupported.
The closure follows explicit import/export dependencies from the linted Program
and selected context files. Adapter ancestor/inferred-root selection and explicit
`settings.resilient.roots` activate those context files. Their actual calls can
contribute invocation evidence; selecting a filename does not invent a framework
call. Findings remain owned by the linted Program. A frozen session `files` list
records acquired identities. The [source-selection reference](../reference/tree-resolution.md)
defines ordering, unavailable candidates and failure behavior.

The compiler-AST transformer is a separate input route with bounded acquisition;
it does not make the JavaScript dependency parser TypeScript-aware. Fluency reports
account for actual lint coverage and active/suppressed findings. Behavioral
preservation requires representative native, raw, and fixed execution observations.
