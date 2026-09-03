# The Code Is the Contract

## Native ECMA, Static Analysis

> Artikulates Resilient is an open-source static-analysis method and disciplined dialect of standard JavaScript. It reads executable boundaries—destructured defaults, return paths, operations, callbacks, and local module relationships—as evidence, then reports contradictions in the source it can resolve. The current package exposes that analysis through ESLint as an integration surface; the contract model stands on its own. The project analyzes its own source, so it is both the method and a working example of the discipline.
> - [GitHub repository](https://github.com/augurone/artikulates-resilient)
> - [npm package](https://www.npmjs.com/package/eslint-plugin-resilient)

There is a particular kind of software maintenance that feels like inventory. Every function gets a description. Every object gets a shape. Every value gets a label. Then the descriptions multiply, drift, and become important enough that nobody wants to touch them.

The code keeps moving underneath.

Resilient starts somewhere else. For application-owned executable contracts, the code that runs is the primary source of truth. Its signatures, defaults, operations, control flow, callbacks, and return paths already contain the contract. That evidence belongs in a model any tool can query, not only in the diagnostics of whichever linter happens to be running. The job is to read that evidence, carry it to the places where it matters, and report contradictions before they become runtime surprises.

This is not a claim that dynamic JavaScript is completely knowable. It is a decision about what to do with the part that is knowable, and about where the responsibility for handling it should sit.

Report contradictions. Preserve unknowns. Keep runtime safety visible. That responsibility belongs to the tooling, not to a second syntax layered on top of the language. For Resilient, annotations that merely restate executable boundaries are an anti-pattern: they create a second description of the same fact that must remain in agreement by hand. Resilient asks the language to keep saying what it already says, and asks the tooling to get better at listening.

### A boundary is already a declaration

A boundary is where code hands a value to another responsibility: a function parameter, a return path, an object property, or a callback argument. Consider this:

```javascript
const render = ({ title = '' } = {}) => title.trim();

render({ title: 42 });
```

The function tells us that it accepts an object-shaped boundary. The default tells us what absence means for `title`. The operation tells us that the value must be string-like. The call supplies a known number-like value.

There is no missing information that needs to be restated before the error can be understood. For this input boundary, the signature is not documentation about the contract. It is the contract.

The same is true for a return:

```javascript
const loadItems = () => [];

loadItems().toUpperCase();
```

The return path produces an array-like value. The later operation is string-like. The contradiction belongs at the use of the returned value. A separate return declaration would repeat the evidence; it would not create it.

### Where the contract becomes visible

A contract becomes visible wherever responsibility changes hands. A function receives something. A call makes a demand. A return carries a result forward. An object exposes some things and keeps other things private. An operation reveals what a value is expected to be. A callback, a module, or a branch makes the same kind of promise in a different form.

These are not annotations added beside the program. They are the places where the program declares an expectation in executable form. The full implementation inventory belongs in the [contract documentation](contracts.md); the principle is simpler: where code changes hands, its expectations become visible.

### Defaults defend execution

Defensive defaults are sometimes accused of hiding broken data. That criticism confuses two different jobs.

```javascript
const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

The default is an operational fail-safe for a missing or `undefined` value. It keeps that absence from needlessly destroying the consuming path. It does not validate an arbitrary API payload. It does not make `null` array-like. It does not make a known number acceptable as `items`.

With `resilient.configs.contracts` enabled, when the source provides enough evidence, the development pipeline still flags the contradiction at the boundary. The application gets its intended absence behavior. The developer gets a diagnostic.

Those are not competing goals. A user should not have to experience every upstream failure for a developer to learn that the contract was wrong.

A default tells the analyzer a property is not required. If absence already has a defined meaning, flagging that absence would be a false error. A function parameter without a default carries no such absence policy, so a known local call that omits it can still be reported for arity. The default does not just protect execution; it is what marks a boundary as open to absence in the first place.

### The evidence has to travel

Once a contract is visible, it must remain available as the value moves. That is a different problem from identifying the boundary. Resilient propagates known contracts through aliases, returns, object properties, callbacks, local imports, re-export barrels, and known higher-order calls.

```javascript
const makeReader = () => (title = '') => title.trim();
const api = { read: makeReader() };

api.read(42);
```

The value is still a function after it is returned and stored on an object. The call still crosses a boundary. The source did not stop being understandable because the value took a short trip through the program.

The same evidence can survive a resolved local module boundary and a destructure, even when no native operation follows immediately:

```javascript
// article.js
export const getArticle = () => ({
    title: '',
    summary: ''
});

// view.js
import { getArticle } from './article.js';

const { title, summery } = getArticle(); // known returned shape: `summery` is absent
```

The typo is visible because the imported return shape remains part of the consumer’s evidence. The contract did not disappear just because the value crossed a file boundary and changed shape through destructuring.

The project graph has two useful views:

```text
Passive Tree: indexed source and contracts
        |
        +-- Active Tree: selected root and closure
                |
                +-- consumer diagnostics
```

The Passive Tree indexes available project definitions, signatures, capabilities, and relationships. The Active Tree follows the statically resolvable path from a selected root through local module edges. The analyzer reasons from the source present in that tree and records external, dynamic, unresolved, and unsupported edges as unknown.

When a provider changes, an ESLint run that includes an affected consumer rebuilds the relevant graph and analyzes the consumer again. Change the provider; the consumer call site receives the updated contract evidence.

Unused files remain indexed but inactive. External and unsupported edges remain unknown. Nothing gets pulled into the active analysis because the engine felt optimistic that it probably knew what was there.

### Unknown is not failure

Some values cannot be known statically. API responses, database records, configuration files, dynamic properties, and third-party implementations are real boundaries. A tool that assigns certainty to them is not being helpful. It is fabricating inventory.

Resilient keeps those values unknown until runtime validation, falsification, normalization, or an explicit guard establishes more evidence. Unknown is a boundary marker, not a final endorsement. When a value enters authored code, that marker tells us where a guard or normalizer may be needed. Unknown does not mean that every surrounding safety rule turns off. A dynamic value can still be subject to callback guards, failure ownership, mutation policy, and native runtime behavior.

The distinction is simple:

```text
known         → check it
contradictory → report it
unknown       → preserve it, avoid fabricated certainty, and keep safety obligations visible
```

That is a better result than turning uncertainty into a confident lie.

### The value and the operation must agree

A contract is not just a bag of allowed property names. The receiver, the operation, the callback, and the result belong to the same story. The same agreement that governs a return path also governs any native method called on that value:

```javascript
Object.entries({ title: 'ready' }).map(entry => entry);
Object.entries({ title: 'ready' }).trim();
```

The first operation agrees with the array-like result of `Object.entries`. The second does not. Likewise, `[].map(...)` makes sense while `[].trim()` does not.

Native prototype methods provide evidence about the value being used. Resilient protects that agreement. A familiar method name is not automatically valid on every receiver.

### Safety is larger than value compatibility

The most expensive failures are not always about a number reaching a string operation. They are often failures of ownership and control:

- an optional callback is invoked without a function guard;
- a promise rejection is dropped;
- an object owned by another boundary is mutated;
- a value-producing path returns an incompatible fallback;
- a silent `catch` discards the failure;
- collection work is hidden inside loop state that obscures what is happening.

These are dialect policies. They are not pretend types.

Inference explains what the source proves. Policy decides what the project permits. An analyzer can understand a rejected mutation so later reads remain accurate while the dialect still rejects the mutation as unsafe.

That separation is important. The machinery needs to understand what happened even when the code is not allowed to keep doing it.

### Model the boundary, not every brick

Not every external model is redundant. A runtime schema or validator for an API payload, persisted record, versioned event, or public package surface has an independent job. It may validate data, define a compatibility boundary, generate documentation, or serve consumers who cannot inspect the implementation.

Those models cross ownership, time, or a runtime boundary. They have a life outside the function that happens to consume them. That is different from placing a granular description on every local value whose behavior is already visible in the source.

Model the things that cross meaningful boundaries. Infer the things that happen inside them. The model earns its keep when it has an independent job to do.

The code should not have to carry a second structure just to prove that it has one.

### Tooling should read the code

The editor should be able to ask the code what it means. That is the model promised from the start: evidence that lives independently of any single consumer.

Resilient’s contract core exposes signatures, value families, object shapes, return contracts, source stacks, module agreements, and diagnostics independently of ESLint. ESLint is one consumer of that model, not its owner.

The implementation is open for inspection in the [contract source](https://github.com/augurone/artikulates-resilient/tree/main/rules/contracts), and the public API is documented in the [contract documentation](https://github.com/augurone/artikulates-resilient/blob/main/docs/contracts.md).

Human documentation still matters. It should explain purpose, context, examples, caveats, and external semantics. It should not become an alternate authority that disagrees with the executable boundary.

The best documentation is not always more text. Sometimes it is a default in the right place, an explicit rest element, a guard before a callback, a return path that agrees with itself, or a native method that says exactly what the code is doing.

### The code is the contract

I am not trying to invent a better language. I want standard JavaScript to be largely true to itself: readable by people, inspectable by tools, and disciplined at the places where values and responsibilities change hands.

The code defines the boundary. Defaults define absence and express property intent (for example, a default should assign a testable, type-appropriate empty value where no other value is appropriate—'', [], {}, false, or 0—not null or undefined). Rest elements define intentional, contextual passthrough where the boundary allows it; they are not relevant to every transformation. Operations test whether the value and its behavior agree. Guards define safe optional behavior. Return paths define the result. Policies define ownership and failure handling.

The code is the thing that has to survive. It is the load-bearing structure. Make it legible. Make its boundaries carry their own weight. Make the tools inspect what is actually there.

Do not build a second structure to explain the first.

### References: conceptual and theoretical

This position did not arrive from nothing. These works either support it directly or shaped the instincts behind it:

- **Douglas Crockford, *JavaScript: The Good Parts*.** The case for treating a language as a chosen, disciplined subset rather than everything it permits is the direct ancestor of calling Resilient’s rules a dialect, not a type system.
- **Elijah Manor, [“Eliminate JavaScript Code Smells”](https://elijahmanor.github.io/talks/js-smells/).** A JavaScript-native vocabulary for recognizing runtime and control-flow hazards—dropped rejections, unguarded callbacks, silent catches—as smells worth catching, rather than treating them as a matter of taste.
- **Martin Fowler and Kent Beck, *Refactoring*.** The book that popularized and developed “code smell” as a practical vocabulary for structural problems: a smell is evidence of a deeper issue, not a cosmetic complaint, which is why these policies are enforced rather than merely suggested.
- **Kyle Simpson, [*You Don’t Know JS: Types & Grammar*](https://github.com/getify/You-Dont-Know-JS/tree/2nd-ed/types-grammar).** A narrative, JS-native case for respecting the value and operation behavior that JavaScript actually provides—the same instinct behind treating a default as absence-handling rather than payload validation.
- **Peter Naur, [“Programming as Theory Building”](https://pages.cs.wisc.edu/~remzi/Naur.pdf).** Support for the claim that a signature is not documentation about the contract—it is the contract, because the executable structure carries the real theory of what a program does.
- **Findler and Felleisen, [“Contracts for Higher-Order Functions”](https://dl.acm.org/doi/10.1145/581478.581484) (ICFP 2002).** A formal foundation for higher-order contracts and blame as boundary obligations between a provider and a consumer—close to the academic ancestor of what this piece calls a boundary.
- **Siek and Taha, [“Gradual Typing for Functional Languages”](https://www.researchgate.net/profile/Jeremy-Siek/publication/213883236_Gradual_typing_for_functional_languages/links/0912f507f2204802df000000/Gradual-typing-for-functional-languages.pdf) (2006).** The formal case for letting typed and dynamic regions coexist at an explicit boundary, closest in spirit to preserving `unknown` values rather than forcing them into a type. Resilient does not implement gradual typing; the kinship is in the boundary, not the mechanism.
