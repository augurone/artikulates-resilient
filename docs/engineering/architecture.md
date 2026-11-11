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

Repeated path queries at the same call occurrence share an invocation context
only for the same caller, callee identity, exact input records, native premises,
and prefix completion/effects. Collection iterations retain distinct occurrence
keys. The shared context is an execution identity, not an unfinished answer;
its function task must still complete before a result can be read. Each distinct
occurrence/input tuple adds O(A) lookup work and storage for A arguments. This
avoids multiplying invocation contexts when a returned alias is read under an
already established path condition, without merging separate source calls.
Completed pure-call evidence remains independently reusable; a completed hit
needs no local occurrence index. Waiting on a local execution does not prevent
its completed pure result from entering that cache.

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

Presence-owned absence is acquired from the existing lexical references.
Stable binding identities and selected branches establish only where absence
is consumed; the callable evidence and producer values remain separate. Every
reference must consume absence, be a stable alias, or be a presence-selected use. A guard
does not justify another unguarded reference, cross an execution boundary, or
survive a binding write. Destructuring-field optionality and signature placement
consume the same absence decision as the default rule.

Logical selection can return its left operand. Its result follows enclosing
logical/conditional selections to the actual consumer; selection alone cannot
discharge absence. Boolean tests and object spreads consume it, while iterable
spreads and exposed values retain their obligations. Local export references
and declarations are escapes, acquired separately from public export names
and re-export names. The cached result-context walk adds O(N) work and temporary
storage within the acquisition bounds below.

For R references, B bindings, and N acquired syntax nodes, presence acquisition
does O(R + P) work with O(R + P) temporary storage, where P counts visited
binding/node pairs in enclosing contexts and Boolean conditions (at most O(BN)).
Each completed pair is memoized, and traversal uses an explicit frontier rather
than the JavaScript call stack. Retained presence records use O(R) storage;
declaration results are cached per query index. This is not a whole-analyzer
linearity guarantee or a claim that truthiness validates the forwarded value.

Presence acquisition includes reads in parameter defaults and computed keys,
using the same reference classifier, parent edges, and lexical scopes as body
reads. Member writes in those expressions participate in receiver lookup.
Nested initializer functions retain their own executions. Initializers
are not executed by acquisition, and a later body guard cannot establish their
earlier reads. Import/export public names, namespace re-export names, property
suffixes, and meta-property names are syntax labels rather than local reads.

A callable admission checks every acquired invocation, callback, and data
escape at its own use. A parameter initializer retains its obligation when
completion demand cannot prove its call, even with a guarded call in the body.
Direct invocation diagnostics retain their separate safety-rule owner. These
per-use observations belong to expression templates, never cached binding
templates. Checking escapes is deferred until callable evidence exists. The
additional acquisition records and expression wrappers are O(R); demanded
proofs retain the existing expression/context/capability bounds. This does not
establish total runtime safety or model every initialization failure. Catch
patterns and unsupported computed boundaries retain their existing conservative
obligations, including when an individual expression could handle absence.

Use roles retain their independent requirements across execution boundaries.
Ordinary forwarding carries the acquired absence-safety decision; it does not
require callability merely because another use invokes the same binding.
Collection callback roles remain callable uses inside captures, including when
the call has trailing arguments. The currently recognized first-argument roles
are `every`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex`,
`flatMap`, `forEach`, `map`, `reduce`, `reduceRight`, `some`, `sort`, and `toSorted`.
Array receivers carry their elements to the corresponding callback formals:
the current element, reduction accumulator, comparator operands and callback
collection each retain their own roles. Index arguments do not become element
requirements. Callback effects remain active when a method result is discarded;
returned elements retain their later consumers. Unmodeled formal/result receiver
calls retain an unresolved element obligation. Native method availability uses
receiver escape evidence separately from changes to element positions. A pure
element identity callback preserves array positions without proving that a
general helper returning its argument cannot expose a receiver.
Initial reduction values carry the accumulator's effect and result consumers;
the count of present elements determines callback visits separately from array
length. A reduction with no callback visits retains its seed or sole unseeded
element as the direct scalar or packed result. Unseeded reductions use the
first or last present slot when its position is proved;
that slot is not also passed as the callback's current element.
Only a possible final callback result reaches the reduction's direct result
consumer. Earlier results reach future accumulator effects and retain a result
consumer only through that accumulator's return contract. A proved final
element does not acquire a nonexistent subsequent callback; unknown positions
retain both possible consumers.
Packed direct results remove the consumed carrier level and retain their inner
positions through local aliases and return relays. Array
insertions have their own positional transport, including replacement/removal
of receiver slots. Literal argument spreads share the acquired layout; unknown
indexes remain ranges. Scalar values inserted into returned arrays have a
separate return channel, acquired only for candidate insertion inputs and their
source callers. The reverse source-call walk shares existing function headers
and selection edges; allocating a channel does not establish a return contract.
Array inputs and literal elements join that return channel with their actual
use sites, so producer guards remain available. Native transport consumes data;
its later returned-element consumers retain the callable requirements. An
unknown argument spread cannot prove that a slice removes a position. Native
array transfer layouts are cached once per call, with linear work and storage
in their argument syntax, alongside the existing selected use-pair bounds.
Native overload selection uses the effective argument count: `toSpliced()`
copies its receiver, one supplied argument removes the suffix, and a supplied
delete count owns its own evidence. Empty literal spreads retain zero arguments.
Proved own methods and resolved namespace exports use their source formals.
Concrete lookup requires a known property name. An unresolved computed name
cannot select an empty-string method or export, preserve an owned receiver
snapshot as a proved method call, or establish a data-only consumer. Known
empty-string keys remain distinct in analyzer evidence even though the recommended
[key policy](../rules/no-falsifiable-property-key.md) rejects them in authored code.
An unresolved use reached from the first argument retains the callable
requirement. That requirement does not establish a callback role or admit a
direct dynamic call as guarded consumption. Lookup evidence can expire when a record escapes through an
export or carries a write across loop iterations. An allocation within the
loop body starts a fresh lifetime. A proved abrupt exit bounds recurrence to
the loops it leaves. Writes that can reach an enclosing iteration still retire
the snapshot there.
Argument positions use the effective sequence after native array spreads,
including nested spreads, sparse slots, and selected arrays. A value whose
position range includes zero retains the callback role. Resolved calls and
constructors link positions to each available formal independently. Selected
callees share a join whose consumer proof checks every alternative. A defaulted
formal or generator consumer can propagate a callable demand without supplying
downstream proof on its own. Rest carriers, resolved receiver protocols, async
consumers and ambiguous positions can use executable guards at each reached
consumer; transport does not itself prove callability. An ambiguous position
links to the formals in its possible range.
Presence suffices for guarded forwarding when all reachable consumers use data.
Indexed array consumers retain the selected positions through packed arguments,
rest arguments, aliases, spread prefixes, and returned carriers. A rest array's
own data reads are separate from its elements' requirements. Unknown spread
widths retain position ranges; object fields remain addressed by name.
Position filtering uses the existing receiver lifetime evidence. Mutation,
escape, or a recurring write widens the affected carrier's positions; an exit
after straight-line evaluation bounds recurrence without inventing a new slot.
Native array spreading consumes the carrier's current positions before retiring its snapshot.
Whole-carrier spreads and native apply operands use the same positional consumer
query as indexed spreads. Returning a rest array encloses each supplied value at
its rest position; its later consumer is separate from the producer's effects.
Native key enumeration and native array iteration with an acquired read-only
callback preserve an owned array's positions. Writes, earlier escapes, unknown
callbacks and exposed native methods retain their uncertainty.
Returned carrier channels preserve changes through further return relays and
local result aliases. Their position queries use the same acquired lifetime
events, excluding proven array observations and passing a data slot without its
receiver. Generic receiver proofs retain those events. A return consumer follows
the acquired slot changes before selecting its requirement; each subject, position
path and return-consumer combination is acquired once. Shared joins reuse that
state. Nested return relays retain the enclosing consumer, and equivalent
continuations share state by result targets, carrier depth, enclosing
continuation and originating capability. Actual return sites keep that stable
capability's guard evidence, including guards after data construction. Distinct
capabilities cannot borrow one another's proof. Discarded producer results do
not become returned-element requirements.
Selection acquisition shares each demanded subject and position path, visits
that subject's use edges once per path, and retains the existing bounded carrier
depth. A cycle retains its unresolved forwarding edge instead of enumerating
changing positions or inventing a fixed slot. No function body is rescanned and
parameter lists are still read only by the lexical index.
A callable requirement, an escape, or an unresolved consumer in that range
retains the obligation through each relay. Returned values have a separate
forwarding path so invoking a returned callback retains the demand and
discarding the result preserves data forwarding. Awaited fulfillment, stable local
result aliases, selected-value aliases and subsequent argument consumers retain
that separate path.
A result edge is activated only when the callee can return the supplied value;
another call to that callee cannot impose its result consumer on this call.
Discarding a result leaves the callee's other effects in force. A guard on a local
result binding owns its callable decision even when the value retains a producer
identity. Known runtime families still determine the guard's known alternatives.
Open field evidence supplies no callable guard.
An executable guard before returning the supplied value can establish its
callability for a later consumer. The proof can instead come from that consumer;
both routes retain the producer's other effects. Selected source consumers that
only observe or ignore the input add no callable requirement. Unresolved consumers
and ungrounded cycles still supply no proof.
An unused alternative supplies no positive consumption evidence. An otherwise
unused stored value or an unguarded field forwarded only to an effect-only
consumer retains its absence obligation.
An invocation requirement follows returned relays through every consumer proof
state. A presence check in an intermediate relay cannot downgrade that requirement
to data forwarding; a callable guard or a consumer that discards the value can.
Only evidence from a guarded callable use supports the optional declaration
when the direct invocation rule owns a separate contradictory call.

Opaque iterables and observable array prototype changes widen position bounds.
Array literals carried into a spread by lexical initializers retain possible
callback uses, including through nested spreads and relayed rest arguments.
Receiver protocols use the effective argument positions for `.call` and for
array operands of `.apply`. A proved member replacement or owned record method
receives the original argument positions. Function-prototype exposure retires
inherited native protocols without retiring independently proved own methods
or ordered replacements. A prior receiver escape retires
native protocol evidence across aliases and selected receivers. A local alias
propagates a later escape to each possible source. Proved read-only helpers,
ordinary key enumeration, and unrelated metadata writes on known functions
preserve protocol evidence. Helper facts use the indexed function headers
and are shared across call sites. Escape summaries share the lexical scan
and add constant work per reference and selection edge. Possible replacements
and unresolved protocol chains retain the obligation. Packed operands keep element evidence
separate from the array value. An unmodified direct rest spread preserves its
first two slots for native `.apply`, and aliased or mutable rest arrays retain
the possible packed positions. The native Promise executor requirement remains
possible across exposure and conditional writes. A single ordered global
replacement by a source constructor contributes that constructor's formals.
Aliases keep the constructor selected at their capture.
Tagged substitutions start at position one, after the template object.
An ordinary rest parameter owns a fresh array. Generic analysis knows that
array family while its slots remain unknown; an actual invocation collects the
remaining argument values, including an empty tail. The parameter value is cached
per invocation context, with O(A) work and storage for A collected arguments.
Element families and callback requirements remain separate from the carrier.
The carrier walk follows existing lexical identities and initializer edges.
General property storage, assignment-built carriers and dynamic callable lookup
remain outside this source model.

Direct protocol writes retain their source position, execution and loop recurrence.
A later write cannot invalidate an earlier lookup when a proved exit prevents the
write from reaching another iteration. Captured writes, unresolved prototype writes
and writes that can recur retain uncertainty. Alias and selection edges merge these
write summaries before lookup; they do not assume the replacement's value.

For N acquired syntax nodes and P visited callee/range pairs, width bounds,
layouts and callee selections use O(N + P) work and temporary storage. Each
callee selection owns at most two immediate alternatives. Shared signature
groups cost O(F) across F formals. Each ambiguous range uses O(log(F + 1))
work and edges to select the relevant groups. Packed array carriers add a
bounded number of entries per use. Reverse walks propagate returned, unresolved and
callable requirements in O(U + E) work and temporary storage for U use entries
and E forwarding edges. Result consumers add at most one activated edge per
forwarding use. Consumer proofs retain at most three states per subject, distinguishing
observed, discarded and invoked results. Each edge has at most two proof alternatives
(producer guard or consumer guard), and every state checks the same other effects.
Protocol-write propagation visits each acquired receiver/selection edge once per
protocol and retains one merged summary per receiver and protocol. Indexed parameter
headers remain shared; these walks do not reread function parameter syntax.
A proved guard at the
forwarding site discharges its edge before consumer traversal.
The consumer checks member reads, object spreads, and ordinary forwarding at
their actual uses. Member reads can use executable guard evidence from demand.
Ordinary calls, constructors, and tags all carry invocation roles. Tag and
spread-call demand evaluates callee and argument selections in source order
before the opaque invocation and result.
Calls and observed uses share their acquired loop capability regions. Region
registration scans C indexed calls and U observed uses in O(C + U) work,
retaining at most one region per observed expression. Region proofs
remain local; they do not supply whole-loop completion or survive binding writes.

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
