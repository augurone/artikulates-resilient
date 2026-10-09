# Tech Editor Notes — Breaking the Rules

## Position in the Corpus

This is essay six in a cumulative technical argument:

1. **The Code Is the Contract**
   - Application-owned executable source is the primary evidence for local contracts.
   - Signatures, defaults, operations, returns, callbacks, and resolvable module relationships expose agreement.
   - Report known contradictions.
   - Preserve unknowns.
   - Do not create a parallel description for facts already expressed executably.

2. **Software as an Agreement Engine**
   - Software is modeled as participants exchanging agreements.
   - Agree wherever evidence supports agreement.
   - Disagreement is useful information.
   - Unknown is not failure and must remain unknown until evidence establishes more.
   - Responsibility should remain attributable to a boundary/participant.

3. **The Fallacy of the Unknown Cliff**
   - External uncertainty does not destroy surrounding knowledge.
   - Unknown marks the boundary where a particular source of evidence ends.
   - Unknown is not contradiction.
   - An application-owned boundary may establish a narrower local agreement without pretending to prove the external value.
   - Integration checks test agreements between independently running systems.

4. **Let's Define Undefined**
   - Do not use `undefined` as the universal negative state of every value family.
   - When a contract has a usable empty/falsifiable form, preserve the established family:
     - `0`
     - `false`
     - `''`
     - `[]`
     - `{}`
   - A negative observation does not necessarily invalidate the value family.
   - The consumer owns interpretation of the negative condition.
   - `undefined` is narrowed to no contractual value having been supplied or produced.
   - Functions expose the limit: there is no falsy callable function, and a no-op function establishes a callable rather than representing absence.
   - Important distinctions:
     - falsifiable value ≠ undefined
     - undefined ≠ contradiction
     - unknown ≠ undefined
     - unknown ≠ contradiction

5. **Style Is Grammar**
   - Some things conventionally called "style" are actually restrictions on which forms may carry an agreement.
   - Resilient remains ordinary ECMAScript; it does not introduce another parser or language.
   - The dialect has vocabulary, grammar, characteristic expression, and remains mutually intelligible with ordinary JavaScript.
   - Distinguish:
     - grammar → which form is being used
     - semantics → what that form says about an agreement
     - policy → whether the project permits that form at this boundary
   - Grammar is compositional:
     `signature → default → operation → return → next use`
   - A collection of rules does not become grammar merely because the rules are enforced together. The important property is that evidence established by one form can be preserved, consumed, transformed, or contradicted by another.
   - Every meaningful restriction should be able to name the invariant it protects.
   - Without an invariant, a rule is probably preference wearing a safety costume.

## Job of Essay Six

**Breaking the Rules: Exceptions Made Simple and Measurable** answers the question created by *Style Is Grammar*:

> If a dialect deliberately restricts expression to preserve meaning, what happens when a legitimate program needs to depart from the ordinary grammar?

This essay should NOT argue that exceptions are unfortunate necessities or generic escape hatches.

Its stronger proposition is:

> A legitimate exception is itself structured evidence about the boundary between the grammar and the program.

The essay should establish a disciplined tolerance model without weakening the underlying analyzer.

## Central Argument

A rule establishes the ordinary permitted form.

An exception identifies a narrow location where the author **claims** that preserving the actual contract requires relaxing that rule.

Important epistemic distinction:

> The exception does not prove its own justification.

The draft already contains the stronger formulation:

> A comment records the claim. Review and behavioral checks establish whether the claim holds.

Preserve this.

Therefore avoid language such as:

> "An exception identifies where preserving the contract requires another form."

Prefer:

> "An exception identifies where the author claims preserving the contract requires another form."

That keeps the exception inside the same evidence discipline as the rest of Resilient.

## Exception Structure

A useful exception should:

1. Name the rule being relaxed.
2. Have narrow, explicit scope.
3. State the contractual reason for the departure.
4. Remain visible to tooling/review.
5. Relax only the named policy.
6. Leave unrelated agreements and analysis intact.

The important principle is:

> Relaxing one rule does not suspend the rest of the dialect.

An exception is therefore not an escape from Resilient.

It is a constrained expression within Resilient.

## Use Existing ESLint Semantics

The draft argues against inventing a parallel exception language when ESLint already provides:

```js
// eslint-disable-next-line resilient/prefer-async-await -- reason
```

and scoped disable/enable directives.

This is consistent with the broader Resilient philosophy:

- do not build a second structure when an existing executable/tooling structure already expresses the needed distinction;
- use common ECMAScript/tooling conventions where they are sufficient;
- add specialized syntax only when it performs an independently necessary job.

Do not turn this section into an ESLint tutorial.

ESLint directives are evidence for the larger architectural argument.

## Critical Real-World Example

The existing implementation introduced custom markers:

- `resilient-allow-promise-chain`
- `resilient-allow-loop`

The essay should KEEP the fact that Resilient's own implementation departed from the emerging theory.

This is valuable evidence, not embarrassment.

The loop case exposed a coordination defect:

- the loop rule could recognize the custom permission;
- mutation analysis also consulted shared loop state;
- ordinary loop analysis normally withheld overlapping mutation findings;
- allowing the loop through the custom marker made mutation findings eligible;
- replacing this behavior naïvely with standard suppression exposed that loop permission and mutation permission are separate concerns.

The lesson is larger than the bug:

> Permission to violate one rule must not silently alter the semantics of another rule.

This demonstrates why exception scope matters.

Do not sanitize the essay into a story where the implementation was already correct.

The theory discovered a flaw in its own implementation.

That is a strength.

## Generated / Lowered Code

TypeScript lowering currently matters as another source of exceptions.

Generated code may legitimately retain a construct when there is no proven behavior-preserving rewrite.

But generation does not exempt code from the tolerance model.

A transformer may state that it retained source behavior because it lacks a proven equivalent transformation.

It should NOT treat a generic comment such as "stateful iteration retained from TypeScript source" as proof that the exception was necessary.

Generated code and authored code should use the same exception semantics.

This is particularly important because TS-lowered Resilient is mechanically different in style from hand-authored Resilient while still passing the same grammar.

Do not expand this into the TypeScript article. That comes later.

## Measurement Is the Important Second Half

Do not reduce "measurable" to counting eslint-disable comments.

The interesting measurements include:

- which rules receive exceptions;
- where they occur;
- how narrowly they are scoped;
- how much code they cover;
- whether reasons recur;
- whether a stated reason remains true after surrounding code changes.

Raw counts are insufficient.

Ten narrowly justified external-boundary exceptions may be healthier than one file-wide suppression.

The key feedback loop is:

    grammar
        ↓
    rule
        ↓
    real program
        ↓
    exception
        ↓
    measurement
        ↓
    repeated legitimate disagreement?
        ↓
    inspect the grammar

Repeated exceptions may indicate:

- a missing accepted grammatical form;
- an inaccurate rule;
- an inadequately modeled boundary;
- a legitimate recurring domain constraint.

This means:

> The program can produce evidence about the adequacy of the dialect.

That is one of the most important consequences of the essay.

Resilient analyzes the program, but repeated legitimate exceptions provide evidence that can cause Resilient's own grammar/policy to be reconsidered.

The grammar is therefore accountable rather than dogmatic.

## Accountability

Preserve the draft's three-way accountability:

- the **rule** remains accountable for the boundaries it recognizes;
- the **exception** remains accountable for its reason and scope;
- the **implementation** remains accountable for its actual behavior.

An exception cannot:

- make a contradiction correct;
- validate external data;
- prove runtime behavior;
- erase unrelated ownership obligations;
- establish a precedent merely by existing.

It explains why one named barrier has been relaxed at one location.

## What This Essay Should NOT Do

Do not:

- turn it into ESLint documentation;
- catalog every Resilient exception;
- introduce a large new theoretical vocabulary;
- re-explain the entire Agreement Engine;
- re-prove the Unknown Cliff;
- re-explain falsifiable defaults at length;
- introduce the TypeScript lowering thesis;
- claim exception metrics/tooling already exists when the draft explicitly says some measurements are prospective;
- make exceptions sound like arbitrary developer preference;
- imply that every exception is valid because someone wrote a reason;
- imply that a rule is correct merely because Resilient currently enforces it.

This essay should cash out vocabulary established by the previous five essays rather than expand the conceptual surface substantially.

## Desired Handoff From Style Is Grammar

*Style Is Grammar* should leave the reader with roughly this problem:

> A meaningful grammar must constrain expression, but a grammar that cannot accommodate legitimate behavior will eventually describe its own preferences instead of the program.

*Breaking the Rules* answers:

> Make the disagreement explicit. Name the rule. Bound the scope. State the reason. Preserve every unrelated agreement. Then let repeated disagreement become evidence about the grammar itself.

## Desired Handoff to the Next Phase

This should complete the initial conceptual sequence:

    code
      ↓
    agreement
      ↓
    limits of knowledge
      ↓
    absence / negative states
      ↓
    grammar
      ↓
    tolerance

After this essay, resist adding another large philosophical concept.

The next phase should become empirical.

Show the analyzer.

Show what it can establish.

Show contradictions it catches.

Show where it deliberately stops.

Show exceptions.

Show measurements.

Show real codebases.

Let implementation test the preceding essays.

Only after the theory + grammar + tolerance model + working analyzer are established should the corpus make the larger TypeScript move.

## Editorial Tone

Preserve the existing voice:

- conversational;
- technically precise;
- skeptical of its own claims;
- ordinary JavaScript examples;
- no academic cosplay;
- no marketing language;
- no unnecessary formal notation;
- no "Resilient solves JavaScript" rhetoric.

The essay is strongest when the implementation is allowed to disagree with the theory and the theory responds by becoming more precise.

The central idea is not:

> Exceptions let developers break the rules.

It is:

> **A disciplined dialect must make its own disagreements observable.**
