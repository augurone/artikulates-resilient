# Evidence model plan

This is the plan for the next meaningful Resilient feature. The existing
release-hardening, self-lint, packed-consumer, corpus, and documentation
changes remain unreleased groundwork. They should bundle with the first
contract-evidence implementation in 0.7.1.

The external-data boundary described here is not a new boundary in Resilient.
It has always been part of the product: source contracts are analyzed at build
time, while runtime data remains outside the analyzer. This feature only makes
that existing distinction and its source evidence inspectable.

## Product claim

Resilient should be able to explain:

    what fact is known
    where the fact came from
    which value or contract it applies to
    where the fact is valid
    what it depends on
    what invalidates the fact
    when the source leaves the fact unknown again

The existing semantic rule remains unchanged:

    known fact        -> may participate in contradiction checks
    unknown fact      -> remains unknown
    conflicting facts -> contradictory, with both sources inspectable

Evidence is not confidence. Resilient must not assign probabilities to source
facts or turn a weak guess into a known contract.

## Scope of 0.7.1

The first slice defines the evidence vocabulary and an inspectable source
evidence path. It does not evaluate runtime values, run runtime validators,
import runtime validation results, load projects from the filesystem, or add a
new configuration language.

The release has four parts:

1. A normalized evidence record.
2. Scoped attachment of evidence to existing contracts.
3. Evidence-aware contract and diagnostic inspection.
4. Source-contract divergence fixtures showing known contradictions versus
   unknown external data.

The first implementation establishes evidence only from source-level facts
already visible to the analyzer. External data remains unknown. A contract
declaration describes what authored code expects; it does not evaluate whether
runtime data satisfies that expectation.

## Evidence record

The internal representation should be a small immutable record. Exact property
names may change during implementation, but their meanings should not.

    {
        id: 'evidence-17',
        kind: 'syntax',
        fact: {
            subject: 'value#3',
            contract: {
                kind: 'array',
                state: 'known'
            }
        },
        source: {
            fileName: 'provider.js',
            range: [120, 138]
        },
        scope: {
            fileName: 'provider.js',
            functionName: 'getItems',
            path: 'normal'
        },
        derivesFrom: [],
        status: 'active'
    }

Required meanings:

- id is stable within an analysis snapshot;
- kind identifies the source of the fact;
- fact.subject identifies the value identity or boundary result;
- fact.contract uses the existing contract shape, not a new type language;
- source points to the syntax, call site, or declared external boundary;
- scope limits where the fact is valid;
- derivesFrom records the evidence chain;
- status records active or invalidated evidence.

The public shape must omit AST object references and use stable file/range data.
Evidence lists must be deterministically ordered.

This does not exclude AST findings. Diagnostics continue to point to the
relevant AST node and source range for ESLint and editor consumers. Only raw
AST object graphs are excluded from the serializable evidence registry because
they are parser-specific, cyclic, and unsuitable as public provenance data.

## Evidence kinds

### syntax

Facts directly expressed by native ECMAScript and already inferred by Resilient:

- literals;
- destructuring defaults;
- native guards such as Array.isArray(value);
- explicit returns and operations;
- resolved local signatures and module edges.

This is existing analyzer evidence made inspectable rather than carried only by
sourceNode.

### guard

A path-local fact established by a condition. It is active only on the path the
guard proves. It must not leak to the alternate path or survive a join where
the paths disagree.

### propagation

Evidence carried through a known alias, return, resolved local module edge, or
other source relationship already modeled by the analyzer. Propagation records
the source chain; it does not add evidence to an unknown external value.

## Scope and identity rules

The first implementation should support these scopes:

- expression result;
- function path;
- function return;
- module export/import edge;
- analysis invocation;
- analysis snapshot.

External data may be represented as a boundary marker, but that marker is not
known evidence. It records that a value entered from outside the statically
known source and identifies the owner of any data failure:

    {
        kind: 'boundary',
        origin: 'external-data',
        subject: 'value#3',
        expectedContract: { kind: 'array', state: 'known' },
        observedContract: { kind: 'unknown', state: 'unknown' },
        boundaryOwner: 'external-data',
        status: 'unknown'
    }

This is a static explanation of the expected boundary, not an observed failure
and not a runtime check. Resilient does not observe whether the data actually
failed. The authored declaration states the expected contract; the data owner
remains responsible for the runtime value.

Evidence follows value identity, not merely a variable name. Aliasing can carry
evidence when the analyzer already knows the alias relationship. Reassignment
creates a new value identity or invalidates the old fact.

Evidence must weaken or expire across:

- mutation that can change the established shape;
- an unknown call that may mutate or replace the value;
- an escaping reference whose behavior is not modeled;
- an invalidated module or project-tree dependency;
- the end of a path-local scope.

Evidence may cross a resolved local module edge only when the existing graph
has enough identity information to carry its source and scope. Unknown, missing,
and ambiguous module agreements remain unknown.

## Contract integration

Do not replace the current kind, state, and shape fields. Add evidence as a
separate provenance layer:

    Contract
      existing kind/state/shape
      evidenceIds

    Analysis snapshot
      evidence registry

This keeps contracts compact and avoids recursive evidence objects. Serialized
contract shapes should include stable evidence summaries only where evidence
changes the public result. Raw source objects remain excluded.

The AST remains the source anchor for findings. The evidence registry stores a
stable location and derivation path; the diagnostic adapter may still retain
the live node needed to report the finding.

The first public inspection surface extends the contract document API with
`getEvidence()`, `getEvidenceAtOffset(offset)`, and
`getEvidenceForContract(contract)`. An adapter can ask why a value is known
without reaching into analyzer internals. A contract graph aggregates these
records with file-qualified IDs, and a project analysis snapshot exposes the
aggregate evidence list.

Diagnostics should expose an evidence path or evidence IDs. Existing ESLint
messages do not need to become longer. The inspector and structured API should
carry the explanation; ESLint can continue presenting the concise finding.

## Source and data-boundary semantics

The implementation must answer these cases before adding more inference:

### Contract declaration

    destructured signature/default
      -> authored source declares an expected contract
      -> the declaration is inspectable source evidence

The declaration does not evaluate incoming data. If a known local call supplies
an incompatible value, the source contains a contradiction and Resilient
reports it. If the value originates outside the known source, it remains
unknown.

### External data

    unknown input
      -> no source evidence establishes its shape
      -> value remains unknown
      -> runtime data failure is outside Resilient's analysis

The contract document may still identify the boundary as external-data-owned.
That notation tells a consumer where a possible failure belongs without adding
a runtime dependency or manufacturing a static finding.

### Guard join

    array path + unknown path
      -> joined value is not silently promoted to array

### Contradiction

    evidence says array
    evidence says string
      -> contradictory result
      -> both evidence paths remain inspectable

### Source contradiction

    source evidence says array
    source evidence says string
      -> contradictory result
      -> both source evidence paths remain inspectable

## Implementation phases

### Phase A: vocabulary and registry

- define evidence kinds, scopes, statuses, and stable serialization;
- add a registry owned by the analysis snapshot;
- attach existing static source facts to evidence records;
- preserve current contract equality and cache behavior;
- add direct API tests for creation, lookup, and deterministic order.

Exit condition: every known or contradictory contract exposed by the document
API can identify its source evidence without changing current findings.

### Phase B: path and identity behavior

- attach guard evidence to flow paths;
- carry evidence through known aliases, returns, and local module edges;
- invalidate evidence on reassignment, mutation, unknown calls, and graph
  invalidation;
- retain unknown when evidence cannot be carried safely;
- expose evidence paths from diagnostics and stack inspection.

Exit condition: evidence never leaks across a path or identity boundary that the
existing analyzer treats as unknown.

### Phase C: declaration and unknown-data behavior

- preserve source-declared contracts at authored boundaries;
- distinguish known local contradictions from unknown external data;
- invalidate evidence on source identity and flow changes;
- add source/data-boundary divergence fixtures;
- keep runtime data evaluation outside the core.

Exit condition: a source contract can be inspected and checked against known
local evidence while unsupported external data remains unknown.

### Phase D: explanation output

Expose the evidence path through the contract document, diagnostics, and stack
inspector without evaluating runtime data or importing validator results.

## Fixtures and tests

Use the existing fixture system as the first evidence corpus. Add focused cases
for:

- native syntax evidence;
- path-local guard evidence;
- source-declared contracts;
- unknown external data;
- evidence through aliases, returns, barrels, and imports;
- evidence invalidated by mutation or reassignment;
- evidence weakened by unknown calls and escaping references;
- conflicting evidence;
- known local contradiction versus unknown data.

Keep tests/fixtures/bad.js as the public-rule diagnostic fixture. Evidence
fixtures should be separate or clearly labeled integration cases; do not turn
the all-rules RED fixture into a runtime-boundary integration test.

## Release gate for 0.7.1

The release should claim only the implemented slice:

- current release-hardening checks remain green;
- packed-consumer verification remains green;
- existing rule diagnostics are unchanged unless a fixture documents the change;
- evidence records have stable serialized output;
- evidence lookup works through the direct contract API;
- at least one declaration, one guard, one contradiction, and one unknown-data
  boundary case have regression fixtures;
- no evidence crosses an explicit scope, identity, or path boundary;
- release notes name unsupported evidence sources honestly.

Not required for 0.7.1:

- runtime evaluation or validator integration;
- real-project performance research;
- editor or language-server support;
- Git tags as a source of truth;
- a large AI benchmark;
- broad governance work.

## Relationship to the AI harness

The AI harness belongs on the roadmap after the evidence vocabulary is stable.
It uses bad.js, rule tests, integration fixtures, standards, and the playbook
to test whether an unfamiliar agent can distinguish source-declared evidence,
contradictory source evidence, unknown data, and legitimate boundary
exceptions.

The harness is a consumer and evaluator of the evidence model, not a
prerequisite for inventing the model.
