# TypeScript Represented in the Artikulates Resilient Dialect: Translating Type into Intent and Agreement

TypeScript is very good at describing intent before code runs. Resilient is
interested in what survives when the code does run.

That makes TypeScript a natural source language for an Artikulates Resilient
dialect. The goal is not to attack TypeScript from outside its ecosystem, and
it is not to recreate the TypeScript type system in another syntax. The goal is
to translate useful type intent into executable agreement.

The proposed pipeline is simple:

```text
TypeScript / TSX
        |
        v
Artikulates Resilient
        |
        v
JavaScript
```

TypeScript remains expressive at the source boundary. Resilient becomes the
high-resolution representation of that source: the form in which defaults,
boundaries, resolvers, guards, callbacks, and object relationships remain
visible after type erasure.

## TypeScript gives intent, then erases it

Consider an ordinary annotation:

```typescript
interface User {
    name: string;
    tags?: string[];
}

const render = (user: User) => user.name;
```

The TypeScript compiler can check the annotation. The emitted JavaScript does
not carry the `User` interface, the required `name`, or the optional `tags`.
It becomes approximately:

```javascript
const render = user => user.name;
```

The type helped the author and the editor. It did not become an executable
contract.

Resilient takes the type as source evidence and asks a different question:
what should the runtime-facing form say about this boundary?

## Type becomes executable intent

For an object-shaped boundary, the answer is a canonical destructured
function:

```javascript
const User = (input = {}) => {
    const {
        name = '',
        tags = [],
        ...attrs
    } = isObject(input) ? input : {};

    return {
        ...attrs,
        name,
        tags
    };
};
```

This is not a generated runtime schema full of weak field checks. It does not
spray `typeof name === 'string'` and `hasOwnProperty` through the output. It
uses the Resilient standard predicate for the object boundary, then expresses
the type’s useful intent through defaults, destructuring, and the returned
shape.

The optional `string` and `string[]` properties become `''` and `[]`. The rest
path makes passthrough explicit. The resulting function is ordinary
JavaScript, but it is also legible contract evidence.

## React props become component grammar

The same lowering works at a JSX boundary. TypeScript source can use either a
named props type or an inline object annotation:

```tsx
const Card = ({
    title,
    items,
    onSelect,
    ...attrs
}: {
    title?: string;
    items?: string[];
    onSelect?: (item: string) => void;
} = {}) => (
    <article {...attrs}>
        <h2>{title}</h2>
        {items.map(item => (
            <button onClick={() => onSelect && onSelect(item)}>
                {item}
            </button>
        ))}
    </article>
);
```

The Resilient form is direct:

```jsx
const Card = ({
    title = '',
    items = [],
    onSelect,
    ...attrs
} = {}) => (
    <article {...attrs}>
        <h2>{title}</h2>
        {items.map(item => (
            <button onClick={() => onSelect && onSelect(item)}>
                {item}
            </button>
        ))}
    </article>
);
```

The props type does not become a redundant runtime artifact. The component
itself is the contract boundary. Optional data receives canonical values. The
callback remains available to the guarded invocation. JSX remains JSX.

This is the point of translating TypeScript into a dialect rather than merely
removing its annotations. The output is not empty JavaScript where the intent
used to be.

## Unions resolve; they are not forbidden

A union is expressive source syntax. Resilient does not need to reject it. It
needs to prevent an unresolved union from becoming an ambiguous target value.

```typescript
type UserOrId = User | string | number;

const resolve = (value: UserOrId) => resolveUserOrId(value);
```

The translated target can provide one functional resolver with one stable
envelope:

```javascript
const resolveUserOrId = (input = {}) => {
    if (isObject(input))
        return { kind: 'User', value: User(input) };

    if (typeof input === 'string')
        return { kind: 'string', value: input };

    if (typeof input === 'number')
        return { kind: 'number', value: input };

    return { kind: 'invalid', value: {} };
};

const resolve = value => resolveUserOrId(value);
```

The union has been resolved through a function. The target does not pretend
that three unrelated return families are one ordinary value. The `{ kind,
value }` envelope gives downstream code an agreement it can inspect and
compose.

The exact resolver can be project-owned or overwritten through configuration.
The important part is the boundary: a union must acquire a functional meaning
before it becomes target code.

## `any` becomes a required fact

TypeScript’s `any` is an escape hatch. It can be useful while exploring a
codebase, but it is dangerous as a runtime contract because it disappears
without leaving an obligation behind.

In the Resilient dialect, an unguarded `any` remains required:

```typescript
const read = (value: any) => value;
```

becomes:

```javascript
const read = value => value;
```

There is no fabricated default for a value whose family is unknown. The
parameter is required. If the source provides a target-scope guard, an
optional boundary can be opened deliberately:

```typescript
const read = (value?: any) =>
    typeof value === 'string' ? value : '';
```

becomes:

```javascript
const read = (value = {}) =>
    typeof value === 'string' ? value : '';
```

The guard is not an annotation workaround. It is executable evidence that the
source knows how to handle the boundary.

## No fear of the yet unknown

This is the central innovation. Resilient does not need to eliminate unknown
values in order to be useful. It needs to keep them visible and preserve the
obligation to resolve them.

Unknown external data can be routed through a schema. An unknown callback can
be guarded. An unknown union can be functionally resolved. An unknown object
can be handled by `isObject` and a project-owned normalizer. A value can remain
unknown without becoming a confident lie.

The distinction is:

```text
known         → use the evidence
contradictory → report the contradiction
unknown       → preserve the boundary and require a path through it
```

That is why the dialect can be strict without becoming afraid of real
applications. It does not require every value to be known before the program
can move. It requires uncertainty to have an honest location and an owned
resolution path.

## The standard library is part of the target

The target is not generic JavaScript with a new name. It has a small standard
vocabulary:

```javascript
import { isObject } from '../rules/support/object.js';

const isFunctionNode = ({ type = '' } = {}) =>
    FUNCTION_TYPES.has(type);
```

The distinction between syntax predicates and runtime predicates matters. An
`isFunctionNode` function classifies a syntax node. An `isFunction` function
classifies a runtime value. Their names and locations communicate which
contract is being expressed.

Arrays have their own canonical evidence:

```javascript
const count = (items = []) => items.length;
```

`Array.isArray` can establish the family when a boundary needs it. `[].length`
establishes the safe empty cardinality. The standard modules, not the
transpiler, own these meanings.

## A route into existing codebases

This gives the project a practical adoption path. An existing TypeScript or
TSX codebase can be translated into a more explicit representation without
requiring a rewrite on day one.

The translator can use TypeScript’s own compiler front end to understand
interfaces, aliases, generics, utility types, JSX, imports, and source
locations. The Resilient layer then decides what needs to survive as runtime
intent:

- object types become destructured contracts;
- optional values acquire canonical defaults;
- unions acquire functional resolvers;
- `any` remains a required boundary;
- callbacks acquire guards or remain required;
- type-only declarations disappear when their intent is already materialized;
- project-owned schemas and standard modules remain graph-visible.

That is a semantic codemod, not just a transpilation step. It raises the
resolution of an existing project by materializing agreements that were
previously visible only to the TypeScript checker—or not visible at runtime at
all.

The same ecosystem can support direct Resilient authoring. People who prefer
the dialect can write the executable form from the beginning. TypeScript users
can arrive through translation. Both paths share the standard library,
resolver model, graph, and diagnostics.

## What this does not claim

This is not a claim that Resilient replaces TypeScript’s entire language or
tooling ecosystem. TypeScript remains excellent at parsing, inference, editor
support, and compile-time analysis. It is also not a promise that every
type-level construction has an automatic runtime equivalent.

The claim is narrower and more useful:

> Resilient is a runtime-contract dialect that TypeScript can compile into.

The TypeScript compiler supplies the source understanding. Resilient supplies
the executable agreement. Runtime data that cannot be known statically remains
owned by the boundary that can validate or resolve it.

TypeScript gives intent. Resilient gives that intent a runtime form.

That is how TypeScript becomes JavaScript—and how JavaScript can become
Resilient.
