# Scaling Resilient

This document records the product, audience, and AI-adoption conclusions for
Resilient. It is a strategy document, not a promise that every idea below is
already implemented.

The dialect semantics are defined separately in
[`docs/semantics.md`](semantics.md); this document explains why the product is
shaped that way and where it may go.

## Executive conclusion

Resilient should become a recognizable JavaScript engineering discipline with
an ESLint implementation, not merely another collection of syntactic rules.

The central promise is:

> Resilient makes JavaScript contracts visible in executable code and reports
> contradictions without pretending that unknown values are known.

The audience is experienced JavaScript and Node.js developers who want stronger
guarantees but do not want to introduce a second type language, a runtime
framework, or a large architectural doctrine.

The most valuable future adjacency is AI-assisted development. Resilient can
give coding agents a constitution to follow and a deterministic verifier to
run after they generate or modify code.

## Strategic decisions

### 1. Piggyback on `eslint-plugin-functional`?

Yes at the ecosystem and messaging level. No as a runtime dependency or
product identity.

[`eslint-plugin-functional`](https://www.npmjs.com/package/eslint-plugin-functional)
already occupies the functional-style space with strict, recommended, and lite
presets. It is the closest adjacent project and proves that an opinionated
ESLint discipline can attract a meaningful audience.

Resilient should therefore:

- remain installable and useful without `eslint-plugin-functional`;
- avoid duplicating rules whose only purpose is functional purity;
- treat functional forms as one means to make contracts inspectable,
  not as the end goal.

There is no current integration work to do. Do not add the package, a
compatibility preset, or a migration guide unless real users demonstrate that
the absence of one is blocking adoption.

The distinction should stay explicit:

| Functional style | Resilient |
| --- | --- |
| Reduce mutation and imperative forms | Make boundaries and value expectations visible |
| Prefer expressions and composition | Detect known contradictions in those expressions |
| Enforce a programming paradigm | Preserve unknown values and evidence boundaries |

#### Mutation deserves a Resilient opinion

Transformation safety is part of the dialect. The current rule prefers new
object and array values by default and uses explicit exceptions for mutable
boundaries. It remains a syntactic policy; the analyzer may model a rejected
update so later facts remain accurate. See [the transformation semantics](semantics.md#transformation-and-ownership-contracts).

### 2. What to learn from Flow

Flow is both a useful model and a warning. It demonstrates the value of:

- local inference rather than requiring every expression to be annotated;
- flow-sensitive narrowing;
- stronger checking at function and module boundaries;
- editor feedback as part of the product rather than an afterthought;
- a migration path for existing JavaScript.

Flow's documentation makes the boundary tradeoff visible: it tries to infer
locally, while annotations are important at boundaries and exports for parallel
checks. See [Flow's annotation requirements](https://flow.org/en/docs/lang/annotation-requirement/)
and [types and expressions](https://flow.org/en/docs/lang/types-and-expressions/).

Resilient should learn from that architecture without becoming a typed dialect:

- no annotation language in application source;
- no requirement that developers maintain a parallel type model;
- no claim that unknown external data has become safe merely because a
  signature expects a shape;
- no attempt to compete with a full type checker on completeness.

The useful Resilient position is narrower and more honest:

> Read the evidence already present in JavaScript. Report proven contradictions.
> Preserve uncertainty until runtime validation or another source of evidence
> resolves it.

### 3. What to learn from Unicorn

[`eslint-plugin-unicorn`](https://github.com/sindresorhus/eslint-plugin-unicorn)
shows how to grow a trusted ESLint project: strong naming, concise rule
documentation, polished presets, dogfooding, careful tests, and a large surface
of immediately understandable improvements.

Borrow:

- a memorable name and clear one-line promise;
- rules that are independently useful and easy to demonstrate;
- high-quality README and rule pages;
- before-and-after examples;
- dogfooding on real code;
- tests for accepted exceptions and false positives;
- predictable scaffolding for new rules;
- a release cadence that gives users confidence.

Do not borrow breadth for its own sake. Resilient should not become a general
JavaScript best-practices catalogue. Borrow Unicorn's operating discipline, not
its scope.

### Loops are exceptions

The loop decision is part of the control-flow dialect, not a general ban on
iteration. The rule reports ordinary collection loops and permits meaningful
sequential or control-flow loops. The exact exceptions are defined in
[`semantics.md`](semantics.md#control-flow-contracts) and the rule page. Any
future strict preset must not encourage agents to rewrite sequential work into
incorrect `Promise.all` calls.

### Exceptions and async failure are allowed

Resilient allows `throw`, `try`, `catch`, and `finally`. The product decision is
to enforce failure ownership, rejection visibility, error context, and cleanup
rather than blanket exception bans. The safety preset implements the first
layer; the complete async semantics are in
[`semantics.md`](semantics.md#async-and-failure-contracts).

### 4. Should Resilient have an opinion about schema?

Yes, but the opinion should be about the boundary between static evidence and
runtime truth—not about owning a schema language.

Resilient should say:

- external data is unknown until validated, normalized, or otherwise evidenced;
- a function signature can provide runtime defaults but does not validate
  arbitrary input;
- schema validation belongs at the boundary where untrusted data enters the
  application;
- once data is normalized, ordinary JavaScript should make the resulting
  contract visible;
- static diagnostics and runtime validation solve different problems and should
  compose.

Resilient should not:

- create a competing Zod-like schema API;
- infer that a signature default validates external data;
- require a schema library in every project;
- turn every unknown value into a warning;
- make framework-specific request or response schemas part of the core.

Schema adapters may be useful later. They should enrich the contract graph with
evidence from an existing validator, not replace the JavaScript-native model.

## Audience strategy

### Primary audience

Senior JavaScript and Node.js developers who deliberately keep some or all of a
codebase in JavaScript, maintain libraries or applications with many data
boundaries, and want stronger guarantees without a second language or runtime
framework.

### Secondary audience

- teams migrating gradually from untyped JavaScript;
- educators teaching practical static analysis and code design;
- maintainers of ESLint plugins and language tooling;
- developers building AI coding workflows;
- teams layering project-specific rules over a portable core.

Do not target “all JavaScript developers.” The first audience should recognize
the problem immediately: they want JavaScript's runtime and low ceremony, but
they do not want to surrender explicit contracts.

### Audience-building narrative

Resilient needs vocabulary people can repeat:

- executable contracts;
- evidence over certainty;
- unknown is not an error;
- boundary-first JavaScript;
- runtime-faithful static analysis;
- code that can explain what it expects.

The most effective content will be concrete:

1. A small JavaScript bug that Resilient catches without TypeScript.
2. A case where Resilient correctly stays silent because the value is unknown.
3. A runtime default that creates a useful contract.
4. Generated code where an AI agent creates a contract contradiction.
5. A comparison of Resilient, TypeScript/JSDoc, runtime schemas, and ordinary
   ESLint on the same example.
6. A false-positive case showing why the analyzer refuses to invent certainty.

### Adoption ladder

```text
read a bug story
      -> try a five-line example
      -> run the recommended preset
      -> enable contract diagnostics
      -> add the GitHub/CI check
      -> use editor or agent integration
      -> contribute rules, cases, or adapters
```

The first-run experience should eventually support `npx resilient init`, a
copyable configuration, and a small example repository. The user should see a
useful finding before learning the entire discipline.

## AI adoption

### Immediate goal: guide agents in repositories

The repository instruction file is the first AI product surface. Agents should
not be asked merely to “write resilient code.” They should be given observable
principles and a verification loop.

The canonical instructions live in `AGENTS.md`. They should also be easy to
adapt into editor-specific files, CI review prompts, and project handbooks.

### The Resilient agent loop

```text
inspect the repository and relevant boundary
      -> list contract evidence
      -> separate known facts from unknowns
      -> identify contradictions
      -> propose the smallest change
      -> run Resilient diagnostics
      -> run tests
      -> report facts, unknowns, changes, and verification
```

### AI constitution

1. Treat signatures, defaults, operations, and return paths as contract
   evidence.
2. Report known contradictions.
3. Preserve unknown values; do not turn missing evidence into certainty.
4. Keep runtime defaults aligned with the value family they represent.
5. Validate or normalize external data at the boundary where it enters.
6. Prefer clear boundaries, `const`, early returns, and expressive native
   methods when they make intent clearer.
7. Do not mechanically flatten control flow when it hides a real decision.
8. Verify generated changes with Resilient and tests before declaring success.

### Longer-term model adoption

If Resilient is meant to influence models beyond repository prompts, create a
public evaluation and training corpus:

- good/bad JavaScript pairs;
- known contradiction cases;
- legitimate boundary exceptions and unknown-value cases;
- examples where unknown must remain unknown;
- critique-and-revision examples;
- tool traces showing diagnostics followed by a minimal repair;
- human-reviewed false positives.

This follows the general lesson of constitutional approaches to AI: principles
become more useful when paired with examples, critique, revision, and evaluation.
See [Anthropic's Constitutional AI overview](https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback)
and [Collective Constitutional AI](https://arxiv.org/abs/2406.07814).

## Product direction

### Near term

- Keep the current core independent from ESLint.
- Improve README and rule pages around outcomes and examples.
- Add a benchmark of real bugs and intentional non-findings.
- Make `inspect:stack` and diagnostics useful to agents in machine-readable
  form.
- Add `AGENTS.md` and maintain it as a first-class project artifact.

### Medium term

- Provide a polished editor adapter or language-server integration.
- Improve project-scale module resolution without changing the inference model.
- Add a GitHub Action and review-oriented diagnostic output.
- Publish an AI coding guide and reusable prompt/constitution examples.
- Evaluate mutation false positives and the ergonomics of explicit boundary
  exceptions against real code before adding the safety preset to the default.
- Explore schema evidence adapters only after the core boundary is stable.

### Long term

- Build a Resilient evaluation suite that other coding agents can run.
- Support richer project graphs and editor navigation.
- Develop a community of rule authors and benchmark contributors.

## What not to do

- Do not make Resilient a general-purpose catalogue of unrelated conventions.
- Do not make `eslint-plugin-functional` a required dependency.
- Do not introduce annotations merely to improve analyzer coverage.
- Do not build a schema runtime into the core.
- Do not claim to validate external data statically.
- Do not optimize for AI compliance by weakening human readability.

## One-sentence test

Before adding a feature, ask:

> Does this help JavaScript expose executable contract evidence, detect a known
> contradiction, preserve honest uncertainty, or make that evidence more useful
> to humans and AI agents?

If not, it probably belongs in an adjacent plugin or consuming project.
