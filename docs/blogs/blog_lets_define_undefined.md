# Let's Define Undefined

## Falsifiable Defaults and the Semantics of Undefined

---
[Artikulates Resilient GitHub repository](https://github.com/augurone/artikulates-resilient)
[Artikulates Resilient npm package](https://www.npmjs.com/package/eslint-plugin-resilient)
---

There is a small habit in JavaScript that carries a surprisingly large amount of meaning: reaching for `undefined` whenever a value is absent, empty, failed, or not yet understood.

The habit is understandable. `undefined` is available everywhere, falsy, and often harmless until a later operation needs a string, an array, a number, or a function. But using one representation for all of those states asks it to say more than it can.

Resilient treats absence more narrowly. When a contract has an executable empty form, that form should remain inside the contract. `undefined` is reserved for a different fact: no contractual value has been supplied or produced.

That distinction does not make a program more certain than it is. It gives uncertainty, absence, and falsification separate places to live.

## A default says something

In [The Code Is the Contract](https://dev.to/augurone/the-code-is-the-contract-mk1), defaults carry executable meaning. They describe what a boundary does with absence, and that meaning has to agree with the operations that follow.

```javascript
const readTitle = ({ title = '' } = {}) => title.trim();
```

The default does not validate arbitrary input. `42` is still not a string. It does establish what this function will receive when `title` was omitted or `undefined`: an empty string, on which `trim()` remains an ordinary operation.

That is more than a defensive convenience. The boundary has made an agreement visible. It says that absence of text is expressed here as text with no characters.

## The default carries the agreement

Where a falsifiable default is feasible, it is not merely one signal among many. It is the primary carrier of the agreement. In Resilient's grammatical convention of the destructured signature, the signature declares the shape a function receives and its defaults declare the usable values that stand for absence within that shape.

```javascript
const renderArticle = ({
    title = '',
    tags = [],
    metadata = {}
} = {}) => ({
    title: title.trim(),
    tags: tags.map(tag => tag.trim()),
    metadata
});
```

This is not a prose description placed beside the boundary. It is executable evidence. `title` begins as a string agreement, `tags` as an array agreement, and `metadata` as an object agreement whenever the corresponding property is absent or `undefined`. The operations and return path can be checked against those same agreements without first widening each one into a nullish alternative.

For the analyzer, this is the beginning and end of the local path: read the destructured signature, follow the agreements through their operations and guards, and require every reachable normal return to preserve the promised families. The default is therefore a compact, executable statement of both absence behavior and continuation behavior. It does not validate an arbitrary incoming value, but it gives the analyzer—and the next participant—a known agreement when absence is the case the boundary has chosen to handle.

The same pattern is available across familiar value families:

```javascript
const count = 0;
const enabled = false;
const title = '';
const items = [];
const record = {};
```

Each value remains usable according to its family:

```javascript
count + 1;
enabled === false;
title.trim();
items.map(item => item);
Object.keys(record);
```

Each can also participate in a falsifiable observation:

```javascript
!count;        // true
!enabled;      // true
!title;        // true
!items.length; // true
!hasContent({}); // true
```

The array and the object are themselves truthy. Their emptiness needs a more specific observation: an array's `length`, and an object-content guard such as `hasContent`. That small difference is important: a test should say what it is actually testing.

## Falsifiable does not mean invalid

A falsifiable value is still a valid member of its contract.

`0` does not stop being a number because `!0` is true. `false` does not stop being a boolean. An empty string remains a string, an empty array remains an array, and `{}` remains an object. The value family and its available operations survive the negative observation.

What that observation means belongs to the participant consuming the value.

```javascript
if (!count) return;

const next = count + 1;
```

In the first scope, zero stops the operation. In the second, it is a useful operand. Neither reading changes the producer's numeric agreement.

This is the grammar of falsifiable defaults in Resilient. Success and a falsifiable condition do not require different value families:

```text
string  → string
array   → array
object  → object
number  → number
boolean → boolean
```

The consumer may decide to stop, continue, render, calculate, filter, or assign the value. The producer has not abandoned its agreement merely because the consumer can make a negative observation about its contents.

That matters to static analysis as well as runtime behavior. A producer that returns an empty array can still promise an array. Its consumer can ask the question that belongs to array content:

```javascript
if (!items.length) return;
```

It does not first need to resolve whether the producer returned an array or withdrew from the array contract. Preserving the value family preserves the operations the next participant is entitled to use.

## Empty needs the right test

An empty default does not make every family falsifiable through bare truthiness. JavaScript makes both `[]` and `{}` truthy. A contract that requires collection members or record fields needs a content test that establishes that condition directly.

```javascript
const hasArrayContent = (value = []) => (
    Array.isArray(value) && !!value.length
);

const hasContent = (value = {}) => (
    Object.prototype.toString.call(value) === '[object Object]' &&
    !!Object.keys(value).length
);
```

These synthetic tests construct the observation that truthiness alone cannot provide. More importantly, they let the consuming scope ask whether the agreement it needs has been established. An empty array or object retains its family; a failed content test falsifies the content agreement where that scope requires content.

```javascript
if (!hasContent(record)) return;

const { title = '' } = record;
```

The first line asks whether this scope has the record content it needs. The second still receives an object-shaped value and can use the object agreement. The guard owns the consequence of the failed content test; the empty default does not itself force control flow.

Falsification is therefore about agreement, not a universal verdict on a value. An object-content test does not declare every empty object invalid, and an array-length test does not validate every member. Each test establishes only the condition the present agreement asks it to establish.

## What is left for `undefined`?

Once established contracts can express their own falsifiable states, `undefined` no longer has to serve as the universal negative member of every contract.

It can say something narrower and more useful: no contractual value has been supplied or produced.

```javascript
const count = 0;       // a Number has been established
const enabled = false; // a Boolean has been established
const title = '';      // a String has been established
const items = [];      // an Array has been established
const record = {};     // an Object has been established
let func;              // no Function has been established
```

This is not a claim that `0`, `false`, `''`, `[]`, and `{}` share one universal meaning. They do not. It is a claim that each already gives the receiver a value in the promised family, while `func` has not yet established a callable value at all.

The distinction keeps several states from collapsing into one another:

```text
falsifiable value ≠ undefined
undefined         ≠ contradiction
unknown           ≠ undefined
unknown           ≠ contradiction
```

A known zero is not unknown. A known false is not absent. An empty string has not failed its string contract. An unknown external payload should not become `undefined` merely because the application has not yet established its contract. Each state carries different evidence, and collapsing them creates more ambiguity for both the developer and the analyzer.

## The edge exposed by functions

Functions make the distinction difficult to ignore. There is no falsy callable function in JavaScript.

```javascript
const defined = {
    func: () => {}
};
```

This function does nothing, but it still exists. It is callable and truthy:

```javascript
typeof defined.func === 'function'; // true
!!defined.func;                     // true
```

Supplying an empty callback therefore makes a real claim on behalf of the participants: an implementation is present. It may be a no-op implementation, but it is not the absence of one.

```javascript
let func;

const unresolved = { func };
```

Here the property is present, but no callable value has been supplied. The receiver still has a decision to make. Not knowing whether an implementation exists is the condition being represented.

That is the edge of falsifiable defaults. An empty string can preserve a string agreement; an empty array can preserve an array agreement. A no-op callback cannot preserve the agreement that no callback has been established.

## The receiver owns the decision

A function boundary may require a callable value. It may also allow its absence, provided it guards the call in its own scope.

```javascript
const notify = (func) => {
    if (!isFunction(func)) return; // return here acts as a break on the side-effect

    func(); // this is a side-effect nothing is returned from notify directly.
};
// Isolation of side-effects will be a later blog
```

The guard makes the decision visible. If the value is callable, execution proceeds. Otherwise, the function ends without producing a return value.

The scope of that conclusion matters. `notify()` also returns no value after a valid callback runs, so its result does not prove whether the callback ran. Boolean conversion alone also does not distinguish `undefined` from every other falsy value. Test callability when the operation needs a function; test a result only when the next operation depends on that result.

This is the producer-and-consumer division described throughout Resilient: the producer owns the agreement it offers, and the consumer owns the interpretation needed in its own scope. A guard knows enough to stop. It does not need to invent an implementation for one that was never supplied.

## The language meaning of `undefined`

The ECMAScript specification defines the [undefined value](https://262.ecma-international.org/5.1/#sec-4.3.9) as the primitive value used when a variable has not been assigned a value. It defines the [Undefined type](https://262.ecma-international.org/5.1/#sec-4.3.10) as the type whose sole value is that value. [Section 8.1](https://262.ecma-international.org/5.1/#sec-8.1) reiterates the relationship: the type contains one value, and an unassigned variable has that value.

That is not a side note to this argument. It is the ground on which the contractual reading stands. ECMAScript establishes the language mechanics: `undefined` is the primitive value of an unassigned variable. Resilient does not attempt to redefine that fact. It asks what that available language expression should mean when participants use it to make agreements in an application.

JavaScript permits explicit assignment of `undefined`. A dialect still has to decide which permitted expressions belong in its grammar. For Resilient, the meaning begins with the state named by the specification: a value has not been assigned. The runtime represents that state with `undefined`; within the dialect, it communicates something left undefined.

The same restraint applies to a bare return. No return value is supplied, and the caller receives `undefined` as the outcome. The language supplies the value; the program has still said that its path did not produce one.

## An outcome, not a catch-all assignment

Consider the difference in authored intent:

```javascript
let func;
```

No implementation has been supplied.

```javascript
func = undefined;
```

An assignment has been made. If a function existed before, a known value has been cleared, invalidated, or withdrawn. Those are actions with meanings of their own, and the resulting value does not reveal which action occurred.

Resilient therefore treats `undefined` most clearly when it arises from what was not supplied or what was not produced: an uninitialized binding, an omitted result, or a guarded path that deliberately does not continue. When an action has a known domain meaning, its contract should express that meaning rather than hiding it behind a catch-all assignment.

JavaScript cannot reconstruct this history from the resulting value. The distinction belongs to the authored code and to the discipline used to read it. That is part of what makes Resilient a dialect: participants agree on how the language's available expressions will be used.

## Let's define `undefined`

The point is not to ban `undefined`, or to make every absence look like an empty collection. It is to stop asking one value to carry incompatible facts.

An empty default is not a placeholder. It is a falsifiable expression of an established agreement: `[]` says an array is here, even when it has no members; `{}` says an object is here, even when it has no own content; `''`, `0`, and `false` remain values in their respective families. Their consumers decide what follows when the agreement's content test fails.

`undefined` says something prior to that agreement. No contractual value was supplied or produced. It is not the empty array, the empty object, a failed string, an unknown external payload, or a known contradiction. It is the remaining language value for something genuinely left undefined.

That is the discipline Resilient needs from its defaults and its analysis. Let a destructured signature establish the agreement it can honestly carry. Let a falsifiable default preserve that agreement through its empty form. Let a guard decide whether the present scope can continue. And when no value has been established, let `undefined` say exactly that.

> Let falsifiable defaults carry agreement. Let the unknown remain unknown. Let `undefined` mean something was actually left undefined.
