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

## Evidence and query ownership

Source acquisition owns stable facts and reusable relationships. It records a
literal's family, lexical identity, formal/return links and potential hazards;
the presence of a default or deferred operation does not establish its execution.
The query owns its requested facet. The call site owns actual input selection,
ordered completion and effects. The local functional consumer owns agreement
between the surviving producer facts and its independent requirement.

Establish a decision at the earliest owner with sufficient premises. A value's
family, a record field's association with that value, an alias relationship and
an operation's requirement are separate facts. Mutation can retire the field
association without changing an already acquired primitive. Transport shares
references rather than copying proofs or reconstructing execution histories.
Unknown external inputs require normalization at their owning boundary; opaque
payloads may travel until a consumer needs them. Unsupported analysis remains
explicit and cannot erase independent known or contradictory evidence.

Reuse retains source identity, requested facet and the premises actually needed
for validity. Invocation-dependent evidence also retains its owning invocation,
captures and reached effects. Revisions invalidate dependent proofs; unchanged
owners remain reusable. Agreement revisions do not imply incremental source-edit
sessions: the analyzer still acquires a new snapshot for edited JavaScript.
The source-boundary cache also retains its filtered context view while the
model's context-set size is unchanged. Contexts and boundary IDs are immutable,
and the set only grows; a new context therefore invalidates that view before
reuse. First discovery order stays unchanged. Selection costs O(C) for C current
contexts after membership changes and O(1) on a warm view, with one additional
O(C) reference array per model in the existing cache. Invocation values remain
owned by their tasks; a standalone frame does not become source permission.

Unknown diagnostic metadata composes in the existing agreement joins. The family
reason is the lexical minimum nonempty reason from incomplete inputs. Causes
retain the eight smallest existing source keys (code, range, line and column),
with a lexical reason tie-break for the same key. Selection and output order are
independent of traversal order, including across shared cycles and truncation.
Reason selection is linear in the inputs; cause sorting touches at most nine
keys, retaining at most eight causes. Metadata never changes agreement or
introduces analyzer work, a cache or an unbounded cause history.

This is the existing ownership contract, not a claim that every handoff already
implements it. The [guarded handoff](analyzer-completion.md#guarded-handoff)
records the repair sequence. Each bundle returns here when a proposed pathway
fails, identifies the incorrect premise and chooses a revised mechanism before
continuing. Passing examples alone do not amend this contract.

Native boundaries acquire intrinsic identity from unshadowed lexical names and
stable aliases. Native argument layouts, member lifetimes and operation judgments
use the receiver's own evidence; an unrelated reference cannot invalidate a
native family. Callee lookup and invocation timing remain separate from identity.

Selecting or invoking a reflective method does not itself expose every intrinsic.
An unbound ambient name such as `globalThis`, `window` or `global` does not expose
every intrinsic either. Its unknown value and any actual acquired-object effects
stay local; merely mentioning the name cannot invalidate native agreement.
An unresolved reflective result, getter or proxy remains unknown at its own
boundary; it does not erase an independent native receiver contradiction. Standard
prototype operations follow the dialect's receiver-family contracts, not a
speculative override by unrelated code. Writes, publication and escape of
application-owned values retain their own boundaries.

Computed property evidence uses the existing guarded value graph, not an alias
interpreter. Inert syntax retains its existing key proof (including signed BigInt
keys); other keys use acquired primitive constants and natural undefined.
Normalization never executes object coercion or invents a symbol identity.
Members, local object patterns, flat ordered object parameters, construction and
rest exclusions share those names. Key evaluation follows the receiver/root and
precedes selection, defaults and later properties; a failed key produces no
normal selected result, including when the binding is unused. Unknown computed
construction keys retain opaque coercion effects before their value expression.

Each immutable key value memoizes its distinct guarded names. For C contributing
value records, K distinct names and G shared decision-operator work, normalization
costs O(C + K + G) work and at most that much storage. Aliases share their source
graph. Ordinary selections add K guarded consumers, not copied invocation
histories; their field-solving work remains owned by the shared field solver.
These are local bounds, not a whole-lint speed claim. Unknown/coercing keys stay
unknown; rest currently requires one established
excluded name per property rather than enumerating combinations of exclusions.
The composed key owner checks shared and successive selections, 16/32 independent
joins, unknown beside contradiction, reversed/warm queries, source replacement,
key effects and abrupt completion. It does not certify every returned rest-carrier
lifetime; the accountability report retains the independent existing gap.

Already-owned whole-value scalar constants and natural undefined can supply a
key without walking the contribution graph again, retaining their exact reach
gate. The intended saving is redundant demand work, with constant extra metadata;
joined values still use guarded contributions. Standalone self-lint measurement,
not this local work argument, decides the under-69-second acceptance requirement.

Native array/string `length` reads supply number on normal completion, using
the retained receiver family even when mutable contents have been retired. The
member-read owner acquires that data result before existing aliases, calls and
return consumers request agreement. Fully established native receivers share
one numeric family value; guarded alternatives use the existing source projection
so uncertainty cannot erase a known numeric contribution. A live fixed slot vector or literal
string also supplies its count and truth value; otherwise the count stays
unknown. Retirement withdraws the slot premise. No broader native protocol
catalog is introduced.

Native `split` supplies an array result for supported primitive separator/limit
arguments and unmodified native regexp separators; receiver agreement remains
string-like regardless of result length.
Custom splitters and unproved coercions do not acquire that array evidence.
Native reflection calls with invariant array or Boolean results preserve that
family on normal completion. Calls that throw contribute no normal result, and
reflection methods with input-dependent result shapes remain unknown.
The same native catalog supplies Array.from, Object.fromEntries, Number.parseInt,
numeric Math methods and Date.now results. Math, JSON and Reflect retain object
namespace identity; Date retains function identity. These result families do not
infer array slots or record fields. A resulting array still supplies G4's numeric
length through the existing member owner.
String slice uses the existing receiver permission and string-result callable;
array slice keeps its existing transfer. JSON.stringify admits string results
from string/number/boolean values, literal null or closed ordinary roots with an absent toJSON field,
and retains established undefined input as natural absence. Custom serializers,
replacers and unresolved roots remain unknown. Existing guarded source selection
preserves admitted contributions beside unknown alternatives. G4's existing
family gates retain primitive result permission across field retirement; retired
object fields do not establish a serialization protocol. Native lookup adds
constant work; JSON selection and field proof retain the existing guarded-value,
field-solving and Boolean costs. No execution context or history owner is added.
Native `forEach` requires a synchronous callback, including an acquired async
callable on an empty array and known promise results from executed callbacks.
Handling a rejection inside an async callback does not change this protocol.

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

Possible opaque failure reaches catch alongside explicit throws. A caught payload
is known only from its established thrown contribution; missing payloads remain
unknown. Admitting handler evidence does not establish successful continuation
through opaque try-side binding steps. Independent catch results and reached call
obligations survive beside unresolved completion. Finally retains its own
completion replacement.

Unsupported destructured catch entry is local to its CatchClause completion.
It does not make the enclosing function or module lexically opaque. Its leaf
values remain unknown until pattern entry has an owned completion; they cannot
borrow the whole thrown payload or assume an authored default ran. Acquisition
still records initializer scopes, captured writers and actual dynamic lookup.
Ordinary catch parameters retain their established payload transport.

Unsafe implicit `arguments` access keeps its referencing execution and lexical
ordinary-function owner opaque, including parameter aliases captured by arrows.
An inner ordinary function owns different arguments. This local barrier is
applied after lexical opacity propagation; independent enclosing/module evidence
survives. Direct eval, dynamic scope and captured writers retain their existing
barriers. Owned inert `arguments.length` observations retain their existing
arity boundary; other argument values are not inferred. Acquisition adds O(A)
work for A unsafe references and O(U) temporary storage for U affected executions,
using the existing lexical owner map without ancestor walks.

Repeated path queries at the same call occurrence share an invocation context
only for the same caller, callee identity, exact input records, native premises,
and prefix completion/effects. Collection iterations retain distinct occurrence
keys. The shared context is an execution identity, not an unfinished answer;
its function task must still complete before a result can be read. Each distinct
occurrence/input tuple adds O(A) lookup work and storage for A arguments. This
avoids multiplying invocation contexts when a returned alias is read under an
already established path condition, without merging separate source calls.
Completed pure-call evidence remains independently reusable where the execution
environment is stable; a completed hit needs no local occurrence index. Frames
with ordered formal publication, and their invoked or lexically created children,
retain occurrence/input reuse but withhold cross-occurrence pure-call reuse. A
captured formal can become available between those occurrences. One inherited
context flag records that dependency; no initialization history is copied.

A completed local declaration initializer owns its value in that execution context.
Later admitted binding and pattern-input reads restrict and refine that retained value; they do not
replay the initializer with argument records narrowed by a later guard. Replaying
it can create another invocation and independent conditions for the same runtime
event, multiplying the histories of otherwise independent stored results.
Publication happens after the initializer completes in the acquired statement
flow, never from a standalone exploratory query. Binding acquisition and use-site
ownership checks still govern writes, captures and native protocol retirement.
An enclosing execution must supply its own completed initialization; a child
cannot manufacture it. Missing paths retain unknown evidence beside reached
values. An already admitted immutable static-source read can keep its existing
no-frame proof, without publishing that observation as an initialization.
Distinct calls, callback executions and closure instances keep their own contexts.
Both source adapters publish declaration initialization through the shared statement
owner. Initializers add one retained value reference and one entry-reach condition
per initializer and context; they do not copy its contribution graph. Entry reach
distinguishes a skipped declaration from the initializer's abrupt completion.
Reusing a pattern's input
does not establish its separate field/getter/iterator proof. The
[stored initializer checks](../../tests/entry-contracts.test.js) exercise
native call counts, independent width, query order, interruption and warm reuse.

An ordinary unwritten `let` declaration without an initializer owns a distinct
absence expression. Its completed statement publishes known undefined through the
same retained-value mechanism in both syntax adapters. Parameters, iteration
headers, ambient declarations, writes, dynamic lookup and unreached lexical
initialization do not acquire that proof. Captures retain the owning execution;
no global no-initializer shortcut creates a value across TDZ or missing frames.
The production preset permits this documented grammar instead of inheriting
`no-unassigned-vars`; the existing absence, default, operation and call rules remain
active. [Natural absence checks](../../tests/absence-contracts.test.js) cover
actual production configuration and native outcomes.

Reached calls retain known noncallable callee and native collection-callback
contributions even without an acquired local signature. The call-site owner reports
them; native receiver conflicts retain their operation owner. Requirements are
stored per source call, execution context and reached task. Generic and actual
source contexts remain separate from policy-only standalone queries; a promise
inspection cannot make a skipped call reachable for a later call-contract query.
Known conflicts survive unknown alternatives. Storage is bounded by those reached
call tasks, with no new interpretation or invocation replay.

Dropped-work acquisition follows conditional, logical and literal-array
contributions, stopping at explicit ownership forms and call-argument handoffs.
It retains each selected producer and its statement boundary, rather than host
syntax. The promise query demands that boundary in the existing standalone
context and reads only the producer tasks reached there. Completed boundary
tasks are reused across contributions; these observations remain outside caller
and generic source proofs. A branch's assignment, await, catch or void does not
own an independent dropped branch.

The same query uses the existing value type-selection cache to inspect retained
standard array slots, including native map/flatMap results and nested arrays.
Guarded known and unknown contributions stay separate. Missing or retired slots
remain unproved; a root promise brand survives payload retirement. Acquisition
visits the selected expression edges once. Each contents projection visits at
most two ownership states per value, with O(V + E) graph work/storage plus the
existing Boolean costs for V retained values and E links. Requested promise
classes and statement/contributor queries retain their existing cache owners;
no callback replay, new context kind or retained history is introduced.

Known promise identity and dropped-work ownership are separate judgments. Native
envelopes retain one creation-origin record. Only known retained contents request
the ownership projection, scoped to the discarded boundary in the same type
selection cache. Existing invocation ancestry includes work created inside named
callbacks. An intact native container with an earlier owner stops that projection
before its contents; a fresh sibling still contributes its obligation. Missing
creation provenance or source ranges supplies no exemption. Each uncached scope
visits at most two states per reached value with O(V + E) graph work/storage plus
shared ancestry work; warm public queries reuse their existing completed result.
The existing promise tests retain opposite query order, native identity controls,
revisions and independently varied shared width/depth and repeated-query bounds.

Callable source-use admission also retains executable guard polarity separately
from ordinary presence tests. Immutable, unwritten bindings can preserve a guard
through selected branches and same-block terminating negative guards even when a
known absent value prunes the invocation. The same proof can admit a guarded
reference stored or forwarded before its consumer is known. It also survives
nested function-expression creation inside the guard for that immutable binding.
An unreached ancestor creation remains unknown when an intermediate body is
inspected generically; that hypothetical execution cannot establish a contradiction.
Every source use still needs its own
proof: dead unguarded calls, mutation, opaque predicates and unguarded sibling
consumers retain their obligations. Memoized condition and context records remain
bounded by the acquired binding/node pairs; actual callers never supply this
source contract.

Standalone source queries demand an acquired earlier lifetime operation before
reading its completed outcome. An absent cached call is not negative lifetime
evidence: querying a later receiver first must agree with source-order queries.
Execution-owned contexts still use reached sites, preserving skipped branches
and in-flight function boundaries. H linked lifetime predecessors add O(H)
demand edges and cached records beyond the operations' existing evaluation
costs; repeated observations reuse those completed tasks. The
[lifetime query-order checks](../../tests/lifetime-contracts.test.js) cross
local/imported callables, records, copies/rest, query permutations, real effects,
interrupted observers, and independently varied predecessor width and depth.

Logical and conditional expressions register their execution for the same
reached-site source queries as statement branches. A standalone later query
cannot demand a skipped child call as unconditional lifetime evidence. Actual
invocations retain their own branch inputs, independently of generic source
observations. Acquisition adds constant work per syntax node and one existing
control-set entry per execution. The first source observation can demand that
execution's acquired flow; its completed tasks are shared by later consumers.
Work remains charged to reached flow, invocation states and Boolean decisions.
The [expression selection checks](../../tests/lifetime-contracts.test.js)
cover short-circuit and conditional arms, nested selection, aliases/imports,
actual exposure, abrupt prefixes, interrupted retry, width/depth and collection.

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

Boolean composition stores canonical node columns and indexes their IDs in a
private 32-bit index. Index growth preserves IDs and compares all three node
columns on collisions. The iterative composition frontier holds one frame per
unresolved ancestor. Terminal and memoized children supply their IDs directly
to that frame. Terminal pairs allocate no memo entries. Two IDs below
2²⁶ pack exactly in a number. Larger IDs retain separate numeric row and column
keys. A source-site projection retains its requested result and uses temporary
entries for its child nodes. An encountered completed root in that same
namespace supplies its existing result to the scratch map; the walk does not
rediscover its descendants. The namespace owns a stable predicate and immutable
node IDs. Other namespaces keep their separate predicates. This adds one lookup
per uncached local frame and no retained cache entries; successive requests
extending a completed prefix visit only the new frontier. If a projection visits D nodes, its scratch
storage is O(D). Completed nodes, nonterminal pairs, and retained projections
remain charged to the decision limit. Between Boolean operations the store
clears its recomputation cache when it reaches 1,048,576 pairs. An operation
can retain additional pairs until it finishes. Canonical node identities and
projected results remain available across cache clears.

Captured immutable parameters and eligible local initializers refer to their
creating invocation. Only functions that need an enclosing frame attach it.
Each template/frame pair shares one callable. Captured locals publish their
already evaluated initializer value, and reads never replay the initializer.
Storage follows demanded frame/execution pairs and reached captured
initializers. Later writes, exposure, and unavailable initialization evidence
still retire the relevant proof.

Closed synchronous local readers can retain an unchanged borrowed record's
payload. Acquisition requires every reference to each reader or its aliases to
be a direct call in the owning execution; publication, writes, async readers and
unresolved uses withhold that permission. A captured native `call`/`apply` lookup
also requires a source-owned ordinary function and intact receiver/prototype
evidence at the particular captured read. Callable identity alone remains
insufficient. [Closed capture contracts](../../tests/lifetime-contracts.test.js)
pair these paths with alias, override, mutation and escape counterexamples.

Source-owned ordinary callables retain their receiver snapshot when selected into
stable local bindings. The existing immediate alias edges still carry later
writes and publication; storing into record/array carriers keeps its separate
ownership contract. Closed captured selections transport their completed value
from the creating invocation instead of replaying its conditional initializer.
A direct native call/apply receiver read can reuse that same closed protocol
proof across the reader's preceding calls. This does not make a foreign call
recoverable evidence for its parent's payload or admit a standalone child without
an initialized provider frame. Own-method/prototype writes, escape and unresolved
uses still withhold permission.
The checks reuse memoized source alternatives and receiver evidence, adding no
index, copied history or Boolean support. Capture records are bounded by demanded
binding/provider/execution pairs; lexical ancestor visits remain separately
charged and can grow with capture count times lexical depth. Existing alias/event
work and sorting costs remain. Native lifetime checks compose repeated captured
calls, actual branches, generic summaries, invalidation and bounded warm reuse.

Callable value reads use the same caller-owned receiver-lifetime relationships as
other values. A completed harmless call can preserve subsequent native protocol
lookup; callable identity alone does not establish that lookup. Model acquisition
shares the existing prior-call chain, and demand applies its completion/effect
conditions. An empty predecessor result can justify an ordered unused path only
inside that predecessor's execution. A child invocation cannot certify an earlier
parent escape merely because its own flow is executing. Direct callable invocation needs identity only, so dependency and
value acquisition omit property-lifetime edges for that use. Truth observation
in a conditional, including forwarded logical
operands, does not pass or store the receiver. Selected branches still own their
ordinary transfer and escape effects. These distinctions add source-use edges,
not producer-held consumer answers or a new retained index.

Presence-owned absence is acquired from the existing lexical references.
Stable binding identities and selected branches establish only where absence
is consumed; the callable evidence and producer values remain separate. Every
reference must consume absence, be a stable alias, or be a presence-selected use. A guard
does not justify another unguarded reference, cross an execution boundary, or
survive a binding write. Destructuring-field optionality and signature placement
consume the same absence decision as the default rule.

An immutable capture may additionally use a guard established before every call
of a closed local reader. Demand joins reach conditions per acquired call site
and caller context. It requires all acquired sites to be represented and the
parent completion to be resolved; a supported guarded prefix cannot hide a later
unmodeled use. Creation-owned proof remains available independently. Dead source
invocations retain their admission obligation under the every-reference policy.

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
Initializer-only execution opacity stays on the function whose entry is unmodeled.
Creating or returning that function does not execute its defaults, so an enclosing
record's independent fields, primitive exports and normal-return contracts remain
available. Preexisting lexical/capability opacity still propagates outward;
dynamic lookup and captured writes do not gain a proof from this distinction.
Root scalar parameter defaults use the existing expression and completion owners
in parameter order, including beside pattern parameters. Supplied defined values
skip the fallback; omitted alternatives retain fallback effects and throws.
Earlier parameters are available, while later parameters and body locals cannot
be borrowed before initialization. Generic summaries do not adopt a caller's
selected values. Calls authored inside initializers own their source obligations.

A direct identifier default from an earlier formal in the same execution can
retain the source record's member snapshot through the existing sole-transfer
proof. Acquisition requires exactly one outgoing source hazard and no source
capture, write or publication. It retains the hazard and escape events; only
the proved read keeps its snapshot. Parameter entry still selects that read on
the omitted branch, and a supplied override owns its separate value. Later
destination mutation and exposure retain their ordinary invalidation. Self,
later, body-local and unresolved references gain no permission. This adds a
constant metadata check per reference and at most one marker per admitted read
in the existing transfer set, with no new index, Boolean support, copied history
or invocation replay. Existing event sorting remains separately charged. The
[entry checks](../../tests/entry-contracts.test.js) retain native supplied/omitted
results, unknown alternatives, invocation separation, alias depth and warm reuse;
the lifetime checks compose source and destination invalidation with captures.

A synchronous frame containing flat object parameters with factory-call root or
lazy call-valued leaf defaults can replace that pattern barrier when every sibling
is a scalar identifier/default, identifier rest parameter or admitted flat object
pattern. Roots may be supplied, inert record defaults or factory calls. Object
fields have static own keys and identifier bindings with scalar inert or call-valued
defaults. A selected leaf default executes only on its undefined/missing branch;
supplied alternatives bypass its calls, effects and throws. Earlier formals and
earlier fields in that same object pattern read completed bindings. Source formal
and field ordinals withhold self, later and body-local reads before initialization. Entry
completes the root, checks the owned plain-object selection, then publishes each
field in source order. Every scalar sibling also publishes its completed binding
through the existing initializer store. Raw arguments and default producers are
not completed bindings. Body reads consume publication; an admitted capture reads
the owning frame directly and cannot replay a future default or cache a missing
parent binding task. A read before publication in an entered frame has native
abrupt completion with unknown error identity; an unentered hypothetical frame
retains unknown availability. This adds O(P + F) templates and retained value/reach
records per affected invocation for P formals and F selected fields, plus one
frame marker; it introduces no new Boolean support or copied histories.
Unknown or nonplain roots retain opaque completion. Nested/computed/rest object
patterns and other non-inert leaf expressions retain their existing barrier; signature
relocation still respects initializer opacity. [Entry contracts](../../tests/entry-contracts.test.js) exercise native and configured
outcomes, query order, abrupt prefixes and mutation.
Function consistency also retains unresolved completion: one surviving known
return family cannot establish agreement for an unmodeled execution. Independently
known incompatible returns still establish a contradiction. This reporting check
adds constant work and no retained state. An unmodeled entry does not prove an
abrupt prefix; independent later contradictions remain visible under incomplete
continuation. A modeled throw still excludes later operations.

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
consumer through that accumulator's return contract. The terminal position
requires evidence that the callback cannot change the receiver's slots. The
entry array still owns the unseeded initial value before the callback runs.
Unknown positions retain both possible consumers. Array family and external
data normalization supply no fixed position by themselves.
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
Source-owned synchronous closures also connect their captured returns to resolved
local calls and immutable callable aliases through shared result-consumer subjects.
Other closure publication keeps an unresolved edge. A guard can belong to the
producer or to the later result consumer. For guarded transported returns, positive
invocation evidence comes only from the capability's generic execution, and the
producer independently proves its guard; actual caller inputs cannot discharge a
declaration. Returning a value does not establish that its next consumer handles
absence. Unknown data forwarding therefore keeps the original absence obligation,
including when a separate guarded invocation exists. These paths are checked by
[callback result roles](../../tests/consumer-contracts-public.test.js) through native
execution, actual rules, query permutations, interruption, scaling and retention.
Successive local returned calls retain that consumer connection through one shared
subject per closure. Subjects are allocated before caller edges are linked, so
cycles stay graph edges and cannot certify their own guard. This continuation
belongs to captured returns; ordinary formal and packed/rest forwarding keep their
separate result roles and mutation obligations. Unary and binary observation roles
read the lexical index's acquired operator, never the caller AST again.

Opaque iterables widen position bounds.
Array literals carried into a spread by lexical initializers retain possible
callback uses, including through nested spreads and relayed rest arguments.
Receiver protocols use the effective argument positions for `.call` and for
array operands of `.apply`. A proved member replacement or owned record method
receives the original argument positions. Standard inherited native protocols
remain available, while independently proved own methods and ordered replacements
retain their precedence. A prior receiver escape retires
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
separate from conditional changes to owned values.
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
write from reaching another iteration. Captured writes and writes that can recur
retain uncertainty. Alias and selection edges merge these
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
Captured-return acquisition adds one pass over indexed functions, calls and
references. Each relevant closure shares one result-consumer subject and a single
caller list; each capture, call and publication contributes a bounded number of
edges. It does not copy caller lists per captured binding or return. Newly demanded
generic invocation work reuses the existing context/value graph and completed
queries; the current scaling checks are samples of those bounds, not a claim that
all analyzer work is linear.
Protocol-write propagation visits each acquired receiver/selection edge once per
protocol and retains one merged summary per receiver and protocol. Indexed parameter
headers remain shared; these walks do not reread function parameter syntax.
A proved guard at the
forwarding site discharges its edge before consumer traversal.
The consumer checks member reads, object spreads, and ordinary forwarding at
their actual uses. Member reads can use executable guard evidence from demand.
Ordinary calls, constructors, and tags all carry invocation roles. Tags and
unresolved spreads retain opaque invocation results after ordered evaluation.
Supported literal spreads use the shared effective argument layout for both
forward invocation and backward consumer demand.
Calls and observed uses share their acquired loop capability regions. Region
registration scans C indexed calls and U observed uses in O(C + U) work,
retaining at most one region per observed expression. Region proofs
remain local; they do not supply whole-loop completion or survive binding writes.

## Normalization and operation contracts

The JavaScript analyzer targets ESM functional JavaScript. Its semantic coverage
is narrower than the parser's accepted ECMAScript syntax. A recognized spelling,
an array family, or a declared parameter default alone cannot prove dispatch,
ownership, successful execution, or supplied field validity.

[Operation descriptors](../../analysis/operations.js) share receiver requirements,
normal result families, callback roles and evaluation categories between agreement
and the two analyzer directions. Those facets remain independent. For example,
`sort` and `toSorted` have callback roles and an array result family; their empty
evaluation category explicitly withholds positional callback execution. Overloaded
array data names do not impose an array receiver on every unrelated method with
the same name. The lexical, prototype, escape and lifetime owners still decide
whether a particular lookup is native.

| Facet | Admitted evidence | Boundary retained |
| --- | --- | --- |
| Record copy/rest | Ordered demanded field projections, known exclusions and final explicit writes. An unknown writer can replace a value without removing established presence. | Computed exclusions, getters, unknown writers and borrowed nested objects retain incomplete/effect evidence. Copying does not validate input or deep-clone it. |
| Arguments | One acquired layout per source call; nested literal spreads and sparse yielded absence; owned callable `.call` and native `.apply` with a known array layout or nullish list. | Unknown iterables, unowned array-like operands, protocol overrides and argument effects with unresolved layout remain opaque. |
| Collections | Native `map`, `flatMap`, `filter`, `reduce`, `reduceRight`, `some`, `every`, `find`, `findLast`, `findIndex`, `findLastIndex`, `forEach`; owned slots refine callbacks and result positions. | Callback effects retire later slot evidence. Unknown positions do not become a convenient example array. Comparator execution remains unmodeled. |
| Reduction family | A seed and every admitted generic callback's normal result independently establish the same single family; async callbacks use fulfillment and seed adoption. Empty input retains its seed. | Mixed families, unresolved/recursive callbacks and recurrence depending on a chosen accumulator stay unknown. This is a finite family check, not a general recurrence solver. |
| Array copies | Native iteration flattens known owned slots; holes yield undefined. A sole transfer into an owned aggregate preserves element evidence. | A surviving mutating/escaping source alias retires nested evidence. An unknown iterable can establish the resulting array family without establishing its contents. |
| Selected fields and slots | Plain record alternatives keep their source gates through field reads. Literal array positions and native `.at` with an inert integer select from owned slots. Inert constant templates, signed numeric keys and signed BigInt property keys share the ordinary property-name interpretation; this does not extend BigInt arithmetic evidence. | Unknown keys, effects in position operands, and invalidated receiver or ownership premises retain incomplete evidence. |
| Async settlement | Native owned aggregate slots retain fulfillment and rejection alternatives, including across guarded input arrays. A status test selects the matching settlement record through shallow copies. Unresolved settlement choices remain value conditions, keyed by input and caller adoption. Repeated native promises share their settlement. A simple catch binding can read the reached thrown payload. | Opaque thenables can behave differently at each adoption; sharing their object identity does not prove a shared outcome. Their payloads, unknown iterators and nested catch patterns retain their existing boundaries. Competing rejections leave the caught payload unresolved when reaction order is unknown. |
| Defaults and expressions | One inert-source interpretation covers signed numeric literals and constant string templates. Primitive arithmetic and sequential template substitutions retain normal family and coercion completion separately. | No arbitrary constant evaluator; BigInt arithmetic, unknown coercions and effectful defaults retain their boundaries. Defaults act on undefined, never supplied null or an incompatible supplied value. |
| ESM | Immutable unwritten export values, local functions, explicit reexports, namespace fields and star routes share the acquired source closure. Explicit names win; distinct bindings are ambiguous; a diamond to one binding is not. | Unresolved routes, mutable values, shared object fields and ungrounded cyclic initialization remain unknown. Star exports never forward default. Initialization failure cannot supply a normal imported value. |

A native promise envelope retains its completed settlement at its creating
invocation. When forgetting execution-only conditions would admit both outcomes,
the caller adds one persistent fulfillment/rejection choice and keeps the original
payload conditions. Forwarding reuses an already exclusive value choice; it does
not add a fresh decision at every identity-preserving observation. Unknown factories use the creation
site and caller context, independently of synchronous construction failure.
An envelope adds at most one own settlement decision and constant envelope
storage per invocation, plus input-adoption decisions and the existing Boolean
composition work. It adds no producer-held consumer
relationships. Native `Promise.resolve` of a native promise and `await` observe
that existing settlement when the envelope's constructor and adoption protocol
remain established. Returning a native promise from an async function
creates a different promise: its resolver readopts the fulfilled payload, whose
`then` property may have changed since the original fulfillment. Opaque payloads
therefore retain independent choices at those new resolutions. Returning an
awaited opaque value has the same readoption boundary. A stable primitive payload
does not acquire an invented rejection.

An async invocation publishes its own settlement condition after projecting
private callee settlement choices. Projection preserves external value conditions
and known payload alternatives, and removes redundant guard-only value layers.
This keeps repeated observers of the same invocation correlated across demand
gates. Successive native identity forwarding retains constant decision storage;
fresh opaque async resolutions have linear value/context, projection and decision
growth in the maintained forwarding family. Runtime late-thenable witnesses,
conditional-slot/copy compositions and deliberate faults distinguish those laws.

Rejection provenance is independent of payload ownership. Each native promise
creation has a stable rejection identity; native `Promise.resolve` preserves its
input's guarded identities when its protocol remains established. Completion restriction and joins retain shared
rejection contributions, including distinct unknown failures. `Promise.all`
projects those contributions once at the consumer: repeated observations of one
source do not create competing reasons, while different simultaneously reached
sources still leave the winner unresolved. A parent-before-child traversal
propagates each contribution edge once, with O(V + E) temporary work/storage plus
Boolean operations. Intermediate outcomes retain links rather than flattened
source lists. These bounds include shared diamonds and independently varied
width/depth. Payload retirement alone retires both fulfilled and rejected member
snapshots; primitive families survive. Repeated array aliases retain the existing
sole-transfer boundary for nested ownership.

An envelope's settled state is immutable; its `constructor` and `then` properties
are not. An escape can replace the value delivered by a later adoption, including
an earlier primitive payload. The same escape can add a thenable protocol to an
ordinary object, array, function or regexp. Adoption therefore projects protocol
retirement through value guards and shared inputs separately from payload
retirement. Each projection key visits at most two ownership states per value
node, retaining O(V + E) work/storage plus Boolean operations, with warm reuse
and interrupted-query retry. Shared-diamond tests vary width and depth independently.

Lexical protocol lifetimes distinguish immediate native adoption from storing
an envelope in an exposed carrier. Aggregates adopt their direct elements; an
array inside a slot remains a returned carrier. Awaiting a nonpromise can return
that same mutable receiver. Both its member snapshot and its protocol proof must
therefore account for the returned alias.
Discarding or testing the awaited result does not discard implicit protocol
effects. Lifetime acquisition retains the await itself and waives only the escape
of an unused result. An inert await preserves its receiver's established fields;
a conditional effect cannot erase the separately guarded untouched alternative.

A pure call can temporarily preserve its input protocol until adoption publishes
the call result. An additional lifetime event ends that permission at the consumer's
completion, including within one declaration and on rejection. Continuing the proof
requires primitive delivered values on both settlement sides, or the same established
native envelope. Native envelope identity survives value and completion projection;
an evidence wrapper's allocation identity is not that envelope's identity. Guarded
proofs preserve native alternatives beside exposed objects, and overlapping unsafe
contributions cannot establish a lifetime proof. Borrowed return bindings and captures
outside their provider invocation retire protocol evidence unless an established sole
transfer supplies ownership. Completed adoption keeps its result after a later override.

Lifetime events retain constant data per source use and are sorted once per acquisition;
parent-use walks are memoized and do not scan an array once per slot. Protocol and
primitive selection memoize guarded contribution edges, with at most two exposure
states per node. Tests independently vary repeated-call width and publication depth,
assert retained expression/value/context and demand bounds, and check warm reuse,
shared diamonds and interrupted retry.

Whole-source transfers keep their existing owner and sole-transfer rules. Plain
rest records establish harmless copy reads even without an exact native tag.
A selected shallow copy publishes its immediate field/slot values while retaining
the containing receiver. Primitive siblings survive beside mutable children;
child payload and adoption-protocol evidence retire together. Immutable whole,
selected and destructured aliases share canonical selection prefixes. Equivalent
property spellings share a prefix; different fields do not. Selected destructuring
uses the same acquisition boundary as root destructuring. A wrapper around a
selected value does not replace the member lookup used for diagnostics. A closed
absent lookup is inert only with an established standard prototype; unknown
prototypes and getter effects retain their existing boundary.

Copy publications are ordered at carrier completion. Reads from another execution
conservatively include that publication independent of closure creation order.
Previously acquired descendant aliases receive full retirement; direct member
paths project through their containing receiver. Primitive values acquired before
publication remain unchanged. Prefix subtrees have contiguous private ranges;
a balanced interval index shares publication records across descendant aliases.
For P acquired prefixes, E events and R reads, acquisition retains
O(P + (E + R) log(P + 1)) records, rather than copying E histories to R aliases.
This scratch index belongs to acquisition and is discarded afterwards. The model
retains shared lifetime links and at most O(log(P + 1)) links per affected read.
The field projection visits each value/edge once, with O(V + E) retained storage,
caller-owned caches, idempotence and interrupted retry. Copy-read safety preserves
separately guarded known alternatives and excludes overlapping unsafe evidence.
Tests independently vary alias width, publication depth and value-graph width/depth;
controls deliberately duplicate histories and remove payload/protocol retirement.

`Promise.resolve` of an opaque value can return an existing native promise whose
protocol was already replaced. Resolution keeps three guarded ownership cases:
an intact native input retains its envelope identity, a nonpromise creates a fresh
envelope, and an opaque input may return an exposed envelope. An unknown alternative
must not retire a separately established primitive or native alternative. Producer
locations preserve ownership of envelopes created inside a conditional argument.
An exposed native input can throw synchronously while `Promise.resolve` reads its
constructor. This call completion precedes settlement and remains separate from
a plain thenable's lookup failure, which rejects the newly created promise.
Primitive and intact-native alternatives do not acquire an invented constructor
failure. Each potentially exposed call adds constant completion structure; tests
bound successive calls and require warm demand reuse.
Maintained native witnesses exercise those cases; fresh promises separately test
repeated-observer identity and forwarding bounds. Creation publishes adoption
effects once; observing an intact envelope does not replay them. Aggregate input
acquisition also retains abrupt constructor/`then` lookup failures independently
from slot settlement: these can reject `Promise.allSettled` itself. A plain
thenable's rejection remains a slot result. Opaque catch execution retains its
existing uncertainty boundary.

Authored signature acquisition includes inert known computed property names and
nested array leaves. Call checking selects fields and slots through shared value
owners; applying a default registers its selected owner so later slot reads retain
conditional alternatives. Literal spread metadata supplies leaf locations without
inventing positions after an unknown spread. Array patterns do not authorize
arbitrary iterator execution. [Authored pattern contracts](../../tests/authored-pattern-contracts.test.js)
cover findings, native neighbors and invalidated ownership.

A lifetime predecessor is evaluated in its owning lexical invocation. Module
predecessors may use their standalone module context; a child frame cannot
certify an earlier escape. Same-execution immutable reads use their read point,
while captures retain creation-time initialization checks. This preserves an
unchanged primitive sibling after a shallow copy publishes a nested field,
without recovering the published child's evidence or admitting a TDZ read.

Native identity/exposure acquisition has a separate owner from record capture
and copy lifetimes. The extraction preserves the same indexes, passes, ordering
and results, with explicit lexical/export query dependencies; it adds no inference
or fallback path.

Acquisition adds reference/initializer indexes and descriptors proportional to the
acquired source. Closed callable eligibility is indexed once per selected binding
root, reusing function-alternative and hazard indexes; each captured read separately
checks inherited protocol evidence and initialization order. Scalar entry adds one shared step per scalar parameter only where
non-inert defaults require entry. Local guard proof retains one joined condition
per source call and caller context, without copying histories or enumerating paths.
Slot owners are cached per input and position. [Closure laws](../../tests/dialect-closure-laws.test.js)
exercise interrupted retry, warm evaluation and retained counts, width growth, and
host-syntax release. These bounds do not imply globally linear analysis.

Flat parameter destructuring is inert only when syntax defaults are inert and
the actual input proves the needed plain-record/native-array premises. This lets
later collection elements remain visible after a harmless normalization callback.
Getters, nested or computed patterns, effectful defaults and unavailable native
premises keep the existing initialization barrier. Generic callback summaries
never acquire the family of a selected convenient caller.

Public agreement `record({ fields, source, base, excluded, retire, open })` owns
registered source handles. Explicit fields override copied writers; exclusions
make a field absent unless explicitly restored. The copied source overwrites the
base only when it supplies the field. `retire` retains a copied field's family
while withholding its nested ownership. Source revisions invalidate dependent
projections and judgments. Cyclic overwrites without a grounded selected writer
are unresolved; they cannot union earlier values into a false surviving field.
An independently supplied producer alternative remains grounded beside a cyclic
copy. A copied cycle shares its version certificate, while each member retains
its own ordered field result. Three presence bits propagate through the demanded
component; each bit is added at most once per member. Present contributions use
shared complete/family-projected channels, with O(V + E) work and storage for
component members and edges, plus the demanded external field graph. An
unconditionally present final writer excludes its unused base dependency before
cycle classification. This does not establish a field from an ungrounded cycle.
Presence is grounded separately from the unresolved value: either copy input can
establish presence, while every producer input must establish it. Each grounded
member notifies its immediate edges once. Field-state joins accumulate incoming
bits instead of rescanning wide producer inputs after every change. A cyclic
record with a present base stays present through forwarding and unknown overlays,
without claiming that the base's value survived an overwrite.

Retirement is idempotent on immutable field contributions. A weak projection
cache maps each contribution to its family-only graph and recognizes projected
nodes themselves. Successive copies reuse those nodes and the original source
handles; they do not wrap projected owners or flatten alternatives again.
Filtering and joins retain established retirement, while ordered overlays link
present contributions and absence fallbacks without expanding each case. For W
alternatives through D otherwise unchanged retired copies, retained contributions
and projection work are O(W + D). Explicit caller reads may materialize their own
case arrays; those outputs remain weakly held by source facts. Mixed states,
revisions, cyclic forwarding and deliberate faulty implementations are checked
in the maintained record-copy and analysis-proof suites.
Opening a copied record projects absent contributions to unknown through another
weak shared graph projection. Already-open contributions are reused. Repeated
absence joins, opening and retirement therefore retain O(W + D) contributions
and cases for W alternatives and D layers; they do not flatten every prior layer.
The finite flat field oracle checks producer/copy equations across query order
and revisions independently of the graph solver and its bit representation.

A retired field case also retains its original `source` handle and `projection`.
The analyzer session uses that provenance to recover the supplied value's truth,
undefined/null distinction and callable identity. It applies retirement before
using the value, so provenance cannot restore a borrowed object's nested fields.
An owner without session value evidence receives unknown execution conditions;
it cannot manufacture a false truth test. Each demanded field recovery adds
constant lookup work and retains one projected value per copied owner.

Object copy acquisition gives known number, Boolean and nullish sources their
empty own-property view; a known empty string has the same view. Such a source
cannot overwrite an earlier field or introduce getter effects. This view is
shared by spread and rest, while nullish rest still completes abruptly. Unknown
sources remain possible writers. The view uses cached family evidence and does
not enumerate object fields or evaluate arbitrary coercions.
Agreement carries a separate copy-field facet through producer alternatives,
so an absent primitive writer beside a supplied record still retains the prior
field on that branch. Dependency traversal keys each owner/facet pair; a copy
read cannot reuse or overwrite an ordinary property read of the same source.
The traversal remains proportional to demanded pairs and edges. A record copy
introduces at most one additional view per source/field, including through joins
and cycles; it does not enumerate producer paths.

`analyzer/record-fields.js` selects fields for both destructuring and member
reads. Copied record layers retain their source and base value links for demanded
field selection. An opaque alternative cannot erase a known discriminator's
gate, and an unrelated conditional writer cannot disconnect it from its payload.
The same walk returns guarded field presence alongside the value. Property
findings consume that presence through successive and joined copies, rather than
consulting an owner whose alternatives have already been combined.
Literal comparisons exclude complete, incompatible family evidence even when
the contribution has no exact constant. Same-family and incomplete contributions
retain the unknown match condition; an exact value remains a separate premise.
Each field walk visits the reachable value/layer nodes once, stopping at explicit
writes and exclusions. Its temporary storage follows those visited nodes; it does
not form combinations of independent record alternatives. Borrowed source fields
keep their retirement boundary while the copied outer record is fresh.
Immutable aliases of initialized destructured bindings share the same receiver
lifetime as their source. This identity relationship supplies no callable or
field evidence; writes and escapes through either alias still retire the snapshot.
Selected member uses follow the same conditional/logical forwarding as whole
receiver uses. Await, coercion and publication of a mutable selected value can
retire its containing record. A literal record or array acquires the value before
publication at the carrier's completion; retiring it at the earlier member read
would erase the copied value's valid evidence. Primitive selected values, stable
aliases and inert observations retain their existing proofs. These events retain
constant data per selected use. Tests vary carrier width and field depth
independently, bound retained model and demand size by the acquired source paths,
and require unchanged work counts on warm queries.
Returning a selected field uses the existing return ownership boundary. It does
not introduce a lexical store that would retire a closed capture before its own
property read. Native checks cover both closed reads and mutable returned aliases.

Array spreads of call results retain the same element-consumer carriers as
lexical arrays. Returned-carrier links are acquired independently of immediate
use, including a local copy followed by a returned alias; only a demanded return
continuation activates those links. This adds constant carrier edges per
supported depth and callback formal, using the existing bounded selection graph.

Authored next-line exceptions on isolated object-binding fields carry their
original compiler-node identity into final emission layout. The layout owner
restores a physical field boundary only when each source field is retained once,
its static signature is unchanged, and exact comment multiplicities and printed
field signatures agree. It separates siblings and closing syntax without adding
an exception or changing values. Invalid source units and ambiguous occurrences
supply no permission. Raw and fixed output retain the authored suppression and
independent findings; standalone printed text cannot invent the source proof.
The original AST and each changed text share one syntax snapshot per invocation.
Indexing and retention use O(N + F + C) records and traversal work for syntax,
fields and comments; line-position queries retain compiler lookup costs and the
existing edit application sorts E edits in O(E log E). No per-field parse or
whole-formatter linear bound is claimed. The composed directive harness checks
payload behavior, invalid/unowned boundaries and parse reuse at increasing width.

Work and storage are charged by separate dimensions:

- Guarded callable and absence identities share immediate contribution links in
  caller-owned value evidence. Cached joins never retain flattened descendant
  case lists. Leaves retain their selected conditions; a consuming query visits
  each shared contribution node once and ORs conditions for repeated identities,
  preserving first-occurrence order and distinct closure contexts. For a cached
  contribution graph with V nodes and E links, retained structure and temporary
  traversal storage are O(V + E); enumeration additionally charges Boolean OR
  work. Its flat answer belongs to that consumer and is not cached at every
  prefix. Multiple consumers and distinct value/condition states remain separate
  work dimensions; this is not a whole-source linearity claim. Interruption and
  demand limits cannot publish a partial case answer.
- Argument layouts are cached by source call. Work is proportional to visited
  syntax and emitted effective positions, without enumerating unknown widths.
- Record copies retain source/base edges and memoize demanded owner/field facets
  with revision validity. They do not eagerly expand every descendant. Shared
  field contributions retain known contradiction beside uncertainty. Public reads
  may still walk the selected contribution set; warm reads are not a zero-work
  claim for all consumers.
- Exact collection execution charges invocation contexts and copied slots.
  Repeatedly growing a concrete accumulator can require quadratic total copied
  slots. Family summaries use existing generic callback tasks and a finite
  family comparison; no recursive fixed point or whole-project linear bound is
  claimed.
- Export resolution caches every completed module/name pair in the acquired
  closure. A summary distinguishes no binding, one binding and ambiguity, with
  unresolved routes retained separately. Cyclic members share a completed summary;
  a traversal back edge never publishes a partial answer. Two iterative graph
  passes require O(V + E) total work and scratch storage for demanded pairs/edges,
  plus O(Q) cache lookups, and retain O(V) constant-size summaries. Shared targets
  are compared by binding identity; histories and target sets are not flattened.
  Default expressions own distinct bindings even when their initializer values
  are identical. Live export aliases and named default function declarations
  retain their original binding; callable and value acquisition separately follow
  a default expression's initializer. An identifier default adds one constant-size
  binding record and one initializer edge within the acquired module closure.
  Each imported binding retains its direct provider's initialization requirement
  independently of its final export target. Aliases and namespace reads keep
  that requirement; a resolved foreign direct call demands its acquired callable
  before executing a result proof. Failed or unresolved initialization supplies
  no known result, while an independently known source signature still owns its
  argument obligations. Authored caller inputs still constrain consumers in an
  initialized defining module; an unresolved import route withholds the resulting
  value and excludes it from completed pure-call reuse. Access gating preserves
  value identity; actual module value transport retains its separate
  payload-retirement boundary. Acquisition
  adds O(I + C) records and edges for I imported bindings and C resolved foreign
  calls, reusing module demand and value caches. The module-initialization tests
  vary call width and default-relay depth independently and bound model records
  and demand on those families, with warm reuse, interrupted retry and collection.
  Namespace field-name discovery still walks its reachable star graph per namespace.
  Dependency acquisition is session-owned; separate ESLint roots can reacquire a
  shared closure. Export-resolution laws check independent reachability, query
  order, interrupted retry, and chain/diamond/cycle work and storage bounds.
- Callable guards inspect the preceding statement sequence and immutable closure
  creation prefixes. Later closure bodies do not enter an earlier guard proof.
  Binding writes retain their revision checks. Template coercion conditions are
  completion conditions, so discarded coercions do not accumulate as persistent
  value conditions.

Explicit decision/demand limits and observer interruption still fail operationally;
interrupted tasks cannot publish complete proofs. Those limits do not bound all
acquisition, module I/O or reverse-use work. A global host cancellation/latency
budget remains a separate product requirement.

[Product workflows](../../tests/product-workflows.test.js) run authored unsafe and
safe pairs through configured ESLint and Node, including a real ESM barrel and
successive file revisions. Their external-data control intentionally executes a
failure without a static finding: external data remains unknown. Ownership,
override and abrupt-completion controls protect that distinction.
[Record copy laws](../../tests/shape-contracts-public.test.js) cover overwrites, exclusions,
mixed unknown/conflicting evidence, cycles, revisions, interruption and shared
wide/successive projections. [Completion tests](../../tests/completion-contracts.test.js)
bound discarded-coercion work and creation-prefix work on their stated families.
These are acceptance contracts for admitted facets, not a claim to cover every
ECMAScript feature or guarantee safe external input from a clean lint report.

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
