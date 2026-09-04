# Agent-learning evaluation

This document defines how to use coding agents as unfamiliar adopters of the
Resilient dialect.

The goal is not to measure which model is smartest, or to prove that Resilient
will be popular. The goal is to measure whether the Resilient system—native
ECMAScript, diagnostics, standards, rule pages, and migration playbook—can be
learned and applied by an engineer who did not design it.

## Existing material is the evaluation system's source material

Resilient already has the important pieces:

- [`AGENTS.md`](../../AGENTS.md) defines the working contract for an agent;
- [`docs/reference/semantics.md`](../reference/semantics.md) defines the dialect;
- [`docs/ai/CODING_STANDARDS.md`](CODING_STANDARDS.md) gives the short version;
- [`docs/guide/migration-playbook.md`](../guide/migration-playbook.md) explains how to repair
  findings;
- [`docs/rules/`](../rules/) explains rule-specific behavior and exceptions;
- [`tests/fixtures/bad.js`](../../tests/fixtures/bad.js) contains one labeled
  diagnostic example for every public rule;
- [`tests/fixtures/manifest.json`](../../tests/fixtures/manifest.json) defines
  the expected fixture diagnostics;
- the rule tests and integration fixtures provide boundary cases.

The layers and current test classifications are described in
[`docs/engineering/diagnostic-corpus.md`](../engineering/diagnostic-corpus.md).

This evaluation does not replace those documents and does not create a second
dialect. It tests whether the existing material is sufficient.

`bad.js` remains intentionally invalid. Never ask an agent to repair the
original file or make it pass. Create an isolated task from one labeled
section, or copy the relevant example into a temporary task file.

## What to evaluate

Use five kinds of tasks.

### Diagnose

Give the agent one unfamiliar example and ask:

- What is the contradiction or smell?
- Which rule owns it?
- What is known, unknown, or boundary-owned?
- Why is the finding located here?

The agent should explain the existing contract rather than invent a type or
guess runtime behavior.

### Repair

Ask the agent to make the smallest behavior-preserving repair. The repair must:

- pass the targeted Resilient rule;
- preserve the intended behavior;
- pass the relevant test;
- avoid an unjustified `eslint-disable`;
- remain within native ECMAScript.

### Exception

Give the agent a legitimate boundary such as a callback signature, cache,
DOM object, ref, draft reducer, external API, or meaningful sequential loop.
The agent should preserve the exception and document it narrowly when the
project rules require an explanation.

### Unknown boundary

Give the agent dynamic or external behavior that static analysis cannot prove.
The correct result may be to preserve unknown, identify the external-data
owner, or add a test—not to manufacture a contract or a runtime dependency.

### Authoring

Ask the agent to write a small new function in the dialect from a plain-English
requirement. This measures whether the system changes future code, not only
whether it repairs RED after the fact.

## Start with a small task set

Do not begin by presenting all 22 highlighted sections at once. That measures
whether the agent is overwhelmed by a large report, not whether it can learn a
rule.

Start with 12 tasks:

- four ordinary rule repairs;
- two contract contradictions;
- two valid boundary exceptions;
- two unknown/runtime-owned cases;
- two authoring tasks.

Choose the repair examples from `bad.js`, the rule tests, and the integration
fixtures. Keep the original source files unchanged. Each task should have a
small starter file, one prompt, and one verification command.

A task can be represented as:

```text
task-id/
  prompt.md
  starter.js
  expected.md
  verify.md
```

`expected.md` is evaluator material, not context given to the agent. It should
state the owning rule, expected result, allowed boundary interpretation, and
behavior that must be preserved.

## Run in context tiers

Run the same task in three tiers.

### Cold

Give only the task prompt and the repository's normal test/lint command.

This measures first-contact friction. A failure here is not automatically a
Resilient defect; the dialect is intentionally specialized.

### Standards

Give the agent `AGENTS.md`, `docs/reference/semantics.md`, and
`docs/ai/CODING_STANDARDS.md`.

This measures whether the normative dialect can be learned.

### Playbook

Give the agent the standards plus the relevant rule page and
`docs/guide/migration-playbook.md`.

This measures the complete adopter experience: understand the rule, choose the
repair, and handle the exception boundary.

The important comparison is not whether cold agents fail. It is whether the
standards and playbook produce a large, repeatable improvement without causing
unsafe repairs or blanket suppressions.

## Record outcomes

For every run, save:

- model or agent name;
- context tier;
- task ID;
- original prompt;
- resulting diff;
- lint result;
- test result;
- number of repair iterations;
- suppressions added;
- evaluator classification;
- short explanation of the failure, if any.

Use these outcome classes:

```text
correct repair
correct non-finding
correct unknown
correct boundary exception
incorrect diagnosis
unsafe repair
unjustified suppression
unclear playbook path
analyzer defect
```

The distinction between `unclear playbook path` and `analyzer defect` matters.
If the diagnostic is correct but the agent cannot find the repair, improve the
playbook or rule page. If the rule reports a contradiction that the evidence
does not support, improve the analyzer or its tests.

## Useful measures

Track these measures per context tier:

- first-pass lint success;
- behavior-preserving repair success;
- test-preserving repair success;
- correct explanation of known versus unknown;
- unjustified suppression rate;
- average repair iterations;
- authoring success on holdout tasks.

Do not use the number of RED diagnostics as the success metric. A strict
dialect may correctly produce more RED. The useful question is whether the
agent can turn each justified diagnostic into a correct, explainable decision.

An initial success target could be:

- no unjustified suppressions in the seeded tier;
- all repairs pass the targeted lint and test command;
- most seeded tasks reach a correct result without human intervention;
- unknown and runtime-owned cases are not converted into invented facts.

Set numeric thresholds after the first baseline. The first run is for finding
where the system is difficult, not for manufacturing a flattering score.

## Hold out tasks

Do not use every task to rewrite the playbook. Keep a holdout set that the
agent and documentation author have not used during iteration.

The cycle is:

```text
run task → classify failure → change rule/docs/test → rerun training tasks
                                             ↓
                                  evaluate holdout tasks
```

If the seeded agent succeeds only on examples copied directly from the
playbook, the system has memorized examples rather than learned the dialect.

## The first practical experiment

1. Select one section from `bad.js` for a rule with a clear repair.
2. Copy it into a temporary starter file.
3. Run one agent with only the prompt.
4. Run the same task with the standards and playbook.
5. Compare the diffs and run the targeted ESLint command and tests.
6. Record whether the agent repaired, suppressed, misunderstood, or correctly
   preserved the boundary.
7. Repeat with one contract rule and one intentional exception.

After twelve tasks, you will know whether the next investment belongs in the
diagnostic, the playbook, the rule test, or the agent context.

## What this proves

A successful evaluation supports a precise claim:

> An unfamiliar coding agent can learn Resilient's native-ECMAScript contract
> discipline from the provided standards and playbook, apply it to unseen
> tasks, preserve legitimate boundaries, and repair justified findings without
> hiding them.

That is meaningful evidence for future human adopters. It is not evidence that
AI usage equals human adoption, and it is not a substitute for real user
feedback.
