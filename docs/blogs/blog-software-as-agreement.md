# Software as an "Agreement Engine"

## Innovation & Lineage in the Resilient JavaScript Dialect
[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)
[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

---

> Agree wherever possible.
> Disagree gracefully.
> Allow the unknown to remain unknown.

---


That is the discipline at the center of Resilient JavaScript.

It is also a way to think about reliable software more generally: keep what works, make disagreement visible, and do not manufacture certainty.

Resilient enters an old argument about correctness, contracts, invariants, specifications, and boundaries. It is not claiming that dynamic languages are unknowable or that static types are useless. It asks three simple questions: where does knowledge come from, how far can it travel, and what should a tool do when the evidence runs out?

## Innovation

The move Resilient makes is simple: it changes where authority lives.

Resilient is a dialect of standard JavaScript, not a new language. The grammar stays put. The discipline comes from the choices the code makes and the tooling that checks whether those choices remain coherent.

> For application-owned executable contracts, “the code that runs is the primary source of truth.”
>
> — [The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1)

The source is not merely an implementation of a design described somewhere else. It is the record of the agreements the program is actually making. The tool reads those agreements, follows them where the evidence holds, and leaves uncertainty alone where it does not.

This does not make explicit models obsolete. A model earns its keep when it crosses ownership, time, or a runtime boundary: an external payload, a public package, a persisted record, or a compatibility promise. The unnecessary model is the one that repeats an executable fact and then has to stay in sync with it by hand.

> Model the things that cross meaningful boundaries. Infer the things that happen inside them.
>
> — [The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1)

That is the move: ask standard JavaScript to carry more of its own meaning, and ask tooling to listen before the code is made to speak twice.

## The Agreement Engine paradigm

An agreement is not a type or a promise written beside the code. It is a relationship that has to survive contact with execution.

Programs are conversations between parts. One part offers something; another receives it, changes it, or passes it on. Every exchange carries an expectation. A program stays coherent when those expectations hold, when disagreement becomes visible, and when nobody pretends to know what has not been established.

The Agreement Engine does not eliminate uncertainty. It gives us a way to see how a program stays trustworthy while uncertainty moves through it.

```text
agreement    → cooperation
disagreement → information
unknown      → room for evidence
```

Every application or function has two broad outcomes: the result satisfies the agreement, or it does not. The goal is to define valid clearly, preserve it through the program, and manage invalidity without making it catastrophic.

`unknown` is not a third outcome. It is the condition to respect until the available evidence is sufficient to establish what is true.

Code is where these relationships become real. It is where the program's assumptions meet the world and either hold together or change.

## Predicates

An Agreement Engine rests on five axioms. Each acts as a predicate over an agreement: it asks what is true, what is promised, where does responsibility rest, what behavior matters, and where uncertainty belongs.

**Correctness:** An agreement has to survive execution. The question is not whether the code looks plausible, but what execution establishes and which claims remain valid afterward. Floyd, Hoare, and Dijkstra provide the formal lineage for reasoning about program meaning, assertions, and justified results:
- Robert W. Floyd — [“Assigning Meanings to Programs”](https://www.lem12.uksw.edu.pl/images/1/15/AssigningMeanings1967.pdf)
- C. A. R. Hoare — [“An Axiomatic Basis for Computer Programming”](https://doi.org/10.1145/363235.363259)
- E. W. Dijkstra — [“Letter to Dr. H. Bekic, 8 October 1974”](https://www.cs.utexas.edu/~EWD/ewd04xx/EWD454.PDF)

**Contract:** A component makes an offer to its caller, then has to deliver on it. The contract gives the agreement a shape. The contract tradition runs through:
- Bertrand Meyer — [“Design by Contract and Assertions”](https://www.eiffel.org/doc/solutions/Design_by_Contract_and_Assertions)

**Blame:** When an agreement breaks, locate the break. Responsibility should not be smeared across every component that happened to carry the value. Findler and Felleisen give this problem a name and a strategy:
- Robert Bruce Findler and Matthias Felleisen — [“Contracts for Higher-Order Functions”](https://dl.acm.org/doi/10.1145/581478.581484)

**Behavior:** An agreement is about what a value is allowed to do, not only what representation it has. If a property matters, specify the behavior that depends on it. A behavior-first account of specifications begins with:
- Rich Hickey — [“clojure.spec — Rationale and Overview”](https://clojure.org/about/spec)

**Boundaries:** Every agreement has an edge where local evidence ends. Uncertainty belongs there, where it can be isolated, interpreted, and turned into something the rest of the system can trust. Two useful treatments of where uncertainty should be handled are:
- Gary Bernhardt — [“Boundaries”](https://www.destroyallsoftware.com/talks/boundaries)
- Alexis King — [“Parse, don’t validate”](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)

Taken together, these predicates make an agreement actionable. They tell us what the program claims, what execution supports, where a contradiction belongs, what behavior must be preserved, and what remains unresolved. Resilient brings those questions to standard JavaScript, where the language leaves clues rather than settling every question for us. The work is to make those clues legible: to see where an agreement holds, where it breaks, and what still needs to be learned.

## Principle

Those questions do not stop at the analyzer. They describe a broader discipline for any system that has to remain trustworthy under change. These are not instructions to be agreeable at any cost. They are a way to stay compatible where we can, be precise when something breaks, and remain humble about what we have not established.

### Agree wherever possible

In software, agreement is interoperability. A boundary accommodates ordinary variation and preserves the invariant the next part of the system relies on, without pretending an invalid value is valid.

In life, agreement is common ground. It is not people-pleasing or surrender; it is recognizing another person's reality where recognition is possible before asserting a different view. Connection and collaboration begin with that small act of validation.

### Disagree gracefully

In software, a known contradiction needs an owner and a useful way out. A system can degrade, return an explicit error, or provide a fallback without silently corrupting everything around it.

In life, graceful disagreement protects both truth and relationship. It separates a person from an idea, makes a boundary firm without making it hostile, and leaves a bridge for whatever comes next.

### Allow the unknown to remain unknown

In software, not every component needs to know how every other component works. Encapsulation and abstraction leave some implementation detail unresolved until it matters. Resilient applies the same restraint to analysis: uncertainty stays open until validation or new evidence establishes more.

In life, this is humility without paralysis. We do not need a definitive answer for every mystery, future outcome, or person's motive before we move forward. Ambiguity can be bounded without being filled with a confident story.

That parallel is more than a metaphor. Software and human systems become more resilient when they preserve what works, make disagreement visible without making it catastrophic, and respect uncertainty without rushing to fill it. The interesting question is what becomes possible when code is built with the same discipline: not a new language, and not a promise of certainty, but a clearer record of what the system has agreed to—and what it has not yet learned.
