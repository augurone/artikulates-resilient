# Diagnostic corpus

The diagnostic corpus is the set of executable examples used to establish what
Resilient should report, what it should preserve as unknown, and how a finding
should be repaired.

This is not a collection of repositories to normalize. It is not a target for
making every report disappear. It is an evidence set for the analyzer and the
people or agents using it.

## Current corpus layers

### Rule contract layer

The public rule tests under [`tests/`](../../tests/) define each rule's direct
behavior:

- valid code that must not report;
- invalid code that must report;
- option and suggestion behavior where applicable;
- boundary cases and intentional exceptions.

These tests are the most precise specification of individual rule behavior.

### Agent diagnostic layer

[`tests/fixtures/bad.js`](../../tests/fixtures/bad.js) contains one labeled RED
section for every public Resilient rule. Its machine-checkable index is
[`tests/fixtures/manifest.json`](../../tests/fixtures/manifest.json).

This layer answers:

- does every public rule have a visible representative example?
- does the actual ESLint run report the owning rule in the labeled region?
- are rule additions and removals reflected in the agent-facing fixture?

This is also the first source for agent-learning tasks. A task should copy one
labeled section into an isolated starter file. The original `bad.js` must stay
invalid and must never be repaired in place.

### Integration boundary layer

The fixtures under [`tests/fixtures/integration/`](../../tests/fixtures/integration/)
exercise behavior across files and boundaries:

- caches and accumulators;
- API and external-data boundaries;
- refs and reducers;
- provider barrels and re-exports;
- resolved, missing, ambiguous, and unknown imports;
- argument, return, operation, async, and callback contracts.

The integration expectations are recorded in the manifest and checked by
[`scripts/check-fixtures.js`](../../scripts/check-fixtures.js).

### Contract-engine layer

The contract tests cover the direct API and shared analysis behavior:

- contract model and compatibility;
- diagnostic construction;
- contract documents and ranges;
- module graphs and import agreements;
- project-tree activation and invalidation;
- program and graph caches;
- ESLint agreement.

These tests establish the analyzer's internal evidence behavior independently
of the full recommended preset.

### Repair layer

[`docs/guide/migration-playbook.md`](../guide/migration-playbook.md), the rule pages, and the
standards documents define the repair and explanation path.

This layer is not tested by asking whether a diagnostic exists. It is tested by
giving an unfamiliar agent an isolated diagnostic and checking whether it can:

- identify the owning rule;
- explain the evidence;
- make the smallest behavior-preserving repair;
- preserve legitimate boundaries;
- leave unknown behavior to the external-data owner or test boundary;
- avoid hiding the finding with an unjustified suppression.

The procedure is defined in
[`docs/ai/agent-learning-evaluation.md`](../ai/agent-learning-evaluation.md).

## Classification of existing tests

The current test assets can be classified as follows:

| Class | Primary question | Existing evidence |
| --- | --- | --- |
| rule contract | Does this rule report exactly the intended syntax? | Individual RuleTester files |
| valid boundary | Does legitimate native or external behavior remain valid? | Rule valid cases and integration valid fixtures |
| contradiction | Does supported evidence produce the correct RED? | Rule invalid cases and `bad.js` |
| unknown preservation | Does unsupported or dynamic behavior remain unknown? | Graph, resolver, and boundary fixtures |
| cross-file agreement | Do imports, barrels, aliases, and returns preserve evidence? | Contract graph and integration fixtures |
| regression | Does a previously fixed behavior stay fixed? | Named tests and fixture manifest |
| no-crash | Does incomplete or unusual analysis remain safe? | AST boundary and incomplete-state tests |
| repair comprehension | Can a user or agent act on the result? | Migration playbook plus agent tasks |
| performance smoke | Does the shared analysis cache behave consistently? | Benchmark acceptance tests and benchmark script |

This classification is sufficient for the current stage. It does not justify a
new broad testing program by itself. New tests should be added when a new
semantic boundary, user failure, or analyzer regression requires them.

## Corpus maintenance rule

Every new corpus case should identify:

```text
source example
expected diagnostic or non-finding
known / unknown / contradictory state
boundary owner
repair or exception path
test or verification command
```

If the case comes from an agent run, also record the context supplied to the
agent and the resulting diff. Keep the case if it exposes a repeatable failure
in the diagnostic, playbook, or agent interaction.

Do not keep a case merely because an agent disliked the dialect. Discomfort is
useful feedback, but it is not by itself evidence that the rule or semantics
are wrong.

## Current exit condition

The corpus is ready for the next adoption experiment when:

- every public rule remains represented in `bad.js` and the manifest;
- integration fixtures cover valid boundaries as well as contradictions;
- unknown and ambiguous cases remain explicit;
- rule tests and fixture checks pass;
- a small set of isolated tasks can be given to agents using the existing
  standards and playbook.

At that point, an external repository is useful as a holdout or unfamiliar
workload, but it is not a prerequisite for the first evidence-backed adoption
strategy.
