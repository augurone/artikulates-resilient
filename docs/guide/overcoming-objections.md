# Overcoming objections

Resilient is easy to misunderstand if it is described as a type checker with
less syntax. That is not the product. It is a discipline for writing ordinary
JavaScript whose executable boundaries can be inspected, propagated, and
checked.

The short version:

The signature establishes the expectation. Defaults define absence. Every
known value, call, return path, property, callback, and operation that follows
must agree with that expectation. Unknown values remain unknown.

## “This is only inference.”

Inference is only one part of the model. A signature establishes the boundary
contract. Its destructured parameters and defaults say what shape the function
accepts and what absence produces. The analyzer carries that expectation
through aliases, calls, returns, object properties, callbacks, imports, and
re-export barrels.

Inference explains what the source proves. It does not turn uncertainty into a
guessed contract. A known contradiction is reported. An unknown value is
preserved because the source has not proved enough yet.

## “Defaults hide broken data.”

A default is an execution decision, not an API validator:

```javascript
const getItems = ({ data: { items = [] } = {} } = {}) => items;
```

This keeps missing or `undefined` data from destroying the consuming path. It
does not make `null` array-like, and it does not make a known number acceptable
as `items`. The development pipeline can still report a known contradiction at
the boundary.

The default is the fail-safe. The diagnostic is the feedback.

## “You do not have required fields.”

That is intentional for properties with defaults. If absence has a defined
value, the property is not required. Reporting its absence would be a false
finding.

Function arguments are different. A function without a default has no absence
policy, so a known local call can receive a too-few-argument diagnostic. A
function with a default owns that missing argument through the default.

Missing names on known closed objects remain useful diagnostics. Object rest
keeps a forwarding boundary open when the code intentionally passes through
contextual properties; it does not make every transformation open.

## “PropTypes or annotations are clearer.”

Annotations are an anti-pattern for Resilient when they merely restate a local
executable boundary. Destructured parameters, defaults, falsification,
validation, normalization, operations, and return paths show the expected
shape of external data in ordinary JavaScript, and they remain present at
runtime. A parallel annotation can drift from the code it claims to describe.

A runtime schema or validator can still have an independent job at an owned
boundary. That is executable boundary behavior, not a required second
description of every local value.

## “JavaScript cannot track contracts across modules.”

JavaScript can carry contracts across local modules because the evidence is in
the source. Resilient reads function parameters, calls, returns, object
shapes, operations, control flow, callbacks, and module relationships. The
default graph resolver handles relative `.js`, `.jsx`, and `index.js` paths,
named/default/namespace imports, re-export barrels, and finite re-export
cycles. Provider signatures and return contracts reach consumers through
those graph edges.

External packages, dynamic imports and properties, unresolved modules, and
unsupported effects remain unknown. A caller can supply a resolver or evidence
adapter for an additional authored layout.

## “Unknown means the checker gives up.”

Unknown means the checker refuses to fabricate certainty. Runtime API data,
database records, configuration, third-party implementations, dynamic module
edges, and incomplete evidence can remain unknown in the static model. Runtime
validation, falsification, normalization, tests, and runtime behavior belong
to the boundary that owns them.

Unknown does not erase project safety policies. Callback guards, failure
ownership, mutation rules, and other runtime-facing disciplines can still
apply.

```text
known         → check it
contradictory → report it
unknown       → preserve it, avoid fabricated certainty, and keep safety obligations visible
```

## “You are just enforcing style.”

“Style” is an informed prejudice. In a serious codebase, many style choices
are oriented around execution and ownership hazards. They are not decoration.
They are how the project enforces its contract law.

An unguarded optional callback can throw. A dropped promise rejection loses
failure ownership. In-place mutation obscures who owns an object. A silent
`catch` discards information. An imperative loop can hide whether the code is
mapping, filtering, sequencing, polling, or retrying.

Inference and policy are separate. Inference explains what happened; policy
decides what the project permits. The machinery needs to understand a rejected
transformation even when the code is not allowed to keep doing it.

## “What about return types?”

The return paths are the evidence. Known return paths must agree on one value
family. Resilient reports inconsistent known returns instead of widening them
into a union. A returned value then carries its family through aliases, object
properties, calls, and operations.

```javascript
const loadItems = () => [];

loadItems().toUpperCase(); // the return and operation disagree
```

For this local boundary, a separate return annotation would repeat the
expected result. It would not create the evidence already present in the
implementation.

## “Functions are too dynamic to follow.”

Functions are values, and Resilient treats them as a first-class family. Known
function signatures can travel through aliases, object properties, and returned
functions. Known local higher-order calls can carry callback contracts through
the invocation stack. A function does not stop being a function because it was
returned, assigned, or placed on an object. Unknown callable values remain
unknown.

## “You need generics, unions, or annotations for serious code.”

Those features are outside Resilient’s chosen grammar and design. Resilient
keeps value families, object shapes, defaults, return paths, and operations
explicit in standard JavaScript. It does not claim to reproduce arbitrary type
algebra or to make runtime data trustworthy by inspection alone.

When a problem crosses ownership, time, or a runtime boundary, model that
boundary explicitly. Do not make every local value carry a second algebra when
the executable boundary already supplies the relevant evidence.

## “Isn't this just contract testing or an agreement pattern?”

Those are related ideas, but they operate at different boundaries.

[Agreement Patterns](https://ceur-ws.org/Vol-635/proceedings-complete.pdf)
describe patterns for coordinating software components and services through
agreements. [Consumer-driven contract testing](https://martinfowler.com/articles/microservice-testing/fallback.html)
checks whether a provider continues to satisfy expectations held by its
consumers across a service boundary.

Resilient brings the agreement relation inside authored source. Its contracts
are derived from executable JavaScript and propagated through signatures,
operations, returns, transformations, effects, failures, and local module
relationships. A known contradiction is reported; an unknown boundary remains
unknown. The result is a source-derived Agreement Engine, not a replacement
for integration tests or a catalog of service-coordination patterns.

## “Native methods are not a real contract.”

They are executable evidence about the value being used:

```javascript
Object.entries({ title: 'ready' }).map(entry => entry);
Object.entries({ title: 'ready' }).trim();
```

The first operation agrees with the array result of `Object.entries`. The
second does not. A method name is not automatically valid on every receiver.

## “Your examples are contrived.”

Examples are reductions. Their job is to isolate the contradiction so the
reader can see the mechanism without carrying an entire application through
the explanation. The standard is whether the example represents a failure at a
real boundary, not whether it is large.

The plugin also analyzes its own implementation, and its regression fixtures
include engine structures and cross-file contracts. That is evidence of useful
signal, not a claim that every JavaScript project has already been solved.

## “This is a new language.”

The syntax and runtime are JavaScript. Resilient does not transpile a new
language or replace ECMAScript. It is a selected dialect: a project adopts a
disciplined subset and enforces it with tooling.

## “This will not work with third-party packages.”

Third-party code is an open-world boundary. Resilient does not pretend to
inspect every package implementation or track arbitrary dependency drift as if
it were authored source.

When the package boundary is unknown, the value remains unknown. Use an
explicit guard, falsification utility, runtime schema, normalizer, or
documented adapter when the application owns the responsibility for
establishing more evidence. Do not convert an external guess into an internal
fact.

## “What has actually been proven?”

The public evidence is specific:

- the plugin analyzes its own source;
- the contract core and ESLint rules consume the same analysis model;
- local signatures, returns, callbacks, object shapes, rest boundaries, and
  known operations are covered by executable tests;
- the package states its unknown and external-boundary limits openly.

Private ecosystem use has informed the design, but those applications and
their results are not public benchmark evidence. This is not a claim that
Resilient has eliminated runtime validation, tests, or every form of dynamic
behavior.

## The position

Resilient is not a compromise between JavaScript and a type system. It is a
decision about where software discipline belongs. The contract belongs in
executable boundaries, and the tooling should analyze and enforce those
boundaries without requiring a second description of the code.

The signature establishes the expectation. The implementation supplies the
evidence. The analyzer carries that evidence. Policies protect execution and
ownership. Unknowns remain visible.

See the [contract model](../reference/contracts.md), [dialect semantics](../reference/semantics.md),
[migration playbook](migration-playbook.md), [GitHub repository](https://github.com/augurone/artikulates-resilient),
and [npm package](https://www.npmjs.com/package/eslint-plugin-resilient).
