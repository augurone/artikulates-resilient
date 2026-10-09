# TypeScript source adapter

The TypeScript adapter is an experimental lowering boundary. TypeScript is
allowed to describe expressive input; the emitted JavaScript is expected to
have Resilient's explicit executable contracts.

The emitted target is ECMAScript 2016 or newer. The adapter does not produce
IE-era downlevel output or restore `var`; requests for an older TypeScript
`target` are rejected.

## Specification boundaries

[Grammar G-T](grammar.md#g-t-typescript-source-and-emitted-target) distinguishes
TypeScript input from executable target forms. [Policy P-04](policy.md#p-04-typescript-downleveling)
owns target enforcement and retained exceptions. [Semantics S-11](semantics.md#s-11-typescript-lowering-contracts)
owns the meaning and preservation obligations of lowering. This adapter
reference describes current implementation support, not a separate dialect.

## Core rule

Resilient does not compromise to preserve a TypeScript escape hatch. The
adapter translates or reports the escape hatch:

| TypeScript source | Resilient target |
| --- | --- |
| object alias or interface with an executable runtime use | executable model function using standard predicates |
| `A \| B` | functional resolver with runtime-family `{ kind, value }` |
| synthetic object union | model branches selected by a discriminator or unique property |
| `any` or `unknown` | required target value unless guarded or resolved |
| `T \| null` or `T \| undefined` | positive-family canonical default; incoming absence still requires a guard |
| `Pick`, `Omit` | structural member selection before contract lowering |
| `Partial<T>` | mark selected members optional before contract lowering |
| `Required<T>` | mark selected members required before contract lowering |
| `Readonly<T>` | preserve the shape; runtime mutability is not invented |
| `NonNullable<T>` | remove absence members before lowering |
| `Exclude<T, U>` | remove source union members matching `U` |
| `Extract<T, U>` | retain source union members matching `U` |
| `keyof T` | declaration-backed string, number, symbol, or mixed-family key contract; symbol keys remain caller-owned because a fresh symbol would not preserve identity |
| resolvable mapped type `{ [P in keyof T]: T[P] }` | structural member projection with mapped optionality |
| resolvable conditional `T extends U ? A : B` | static branch reduction or a functional resolver for distributive unions |
| optional object member | canonical default plus explicit property contract |
| `...attrs` | preserved remainder path |

## Compiler boundary

TypeScript and Resilient both operate on syntax trees, but they own different
parts of the pipeline. TypeScript parses source into an AST, uses its checker
for semantic evidence, transforms the AST, and prints the result. The
Resilient adapter consumes the available AST and declaration evidence, lowers
it into an internal Contract IR, and then emits Resilient-shaped JavaScript.

The adapter pipeline is:

```text
TypeScript AST/checker → Understand → Policy → Grammar → Lowering → Resilient output
```

For a project build, `resilient-lower --project tsconfig.json`
creates one TypeScript `Program`, preflights all configured source files, and
uses that Program's checker for project-wide adapter evidence. It writes
lowered JavaScript directly to a dedicated artifact directory; ordinary `tsc`
remains responsible for declarations, source maps, JSX handling, and target
downlevel emit. The target's `tsconfig` remains authoritative for source and
module resolution.
The command resolves its configured `outDir` relative to the command directory;
when none is configured, it uses `<command directory>/.resilient`. `--outDir`
overrides either location.
The standalone
`transform()` API remains appropriate for editor previews and focused tests.

The Understand stage produces reliable evidence from compiler input. It includes
source shape discovery, declaration lookup, and checker-derived type evidence.
Policy decides what that evidence permits. Grammar chooses the executable
structure, lowering rewrites the AST, and emission happens only after those
decisions exist. Provider modules are the preferred composition boundary for
repeated external or compiler shapes; each provider exposes unknown and
contradictory evidence instead of hiding it.

The Contract IR separates epistemic state, source-lowering kind, and executable
meaning:

```text
state       evidence state: known, unknown, or contradictory
kind        source-lowering kind: literal, resolved, union, required, or invalid
family      runtime family: string, number, boolean, bigint, array, object, or function
canonical   falsifiable empty value: '', 0, false, 0n, [], or {}
check       runtime predicate when one is provable
resolver    named functional boundary when one is required
```

The current adapter often represents evidence state indirectly through the
contract kind, empty or missing fields, and diagnostics rather than through a
single serialized `state` field. The distinction remains semantic: unknown
evidence is not a contradiction, and neither may be promoted to known evidence
merely to complete a lowering.

Projection, lookup, relation, and normalization are reusable algebraic
operations over that representation. A mapped type, indexed access, generic
alias, or conditional type therefore contributes evidence to the same
contract model instead of requiring a separate emitter for each syntax form.
Generated model functions, union resolvers, and standard imports are composed
as synthetic AST statements before TypeScript prints the final source. The
adapter therefore performs an AST-to-AST lowering pass; string formatting is
left to the compiler printer at the edge.
When a TypeScript `Program` is supplied, the adapter uses checker evidence at
the boundary for imported or renamed primitive aliases and other resolved
symbol information. It does not treat checker output as a replacement for the
Resilient algebra, and full assignability and control-flow-proven guards remain
future semantic evidence upgrades.

The same transformer exposes `analyze()` for editor and CI tooling. It returns
the lowered boundary decisions without emitting JavaScript:

```javascript
const { analyze } = createTypeScriptTransformer({ typescript });
const report = analyze({ code, fileName: 'user.ts' });
// report.contracts: [{ parameter, kind, family, canonical, resolver, ... }]
// report.diagnostics: type forms that cannot be lowered faithfully
```

Policy violations remain ESLint findings; analysis diagnostics are reserved for
missing or unsupported lowering evidence. Keeping those channels separate lets
the editor explain both “this violates Resilient policy” and “this TypeScript
form has no faithful target contract.”

## Example

```typescript
type User = { name: string; id?: string };
type UserOrId = User | string;

const render = (value: UserOrId, payload: any) => {
    if (typeof payload === 'string') return resolveUserOrId(value);
    return value;
};
```

The adapter emits a model function when the source has an executable use for
the shape, such as an explicit normalizer call or a union branch. The model
supplies canonical defaults and preserves additional attributes. TypeScript
names are lookup information, not runtime type tags.
The union resolver functionally resolves the runtime family and returns one
stable object shape. User-defined names are compile-time lowering aids, not
runtime identities:

```javascript
resolveUserOrId('user-1');
// { kind: 'string', value: 'user-1' }

resolveUserOrId({ name: 'Ada' });
// { kind: 'object', value: { name: 'Ada', id: '' } }
```

Discriminated object unions retain their object constructors and use the
literal discriminator to select the branch:

```typescript
type Button = { kind: 'button'; label: string };
type Link = { kind: 'link'; href: string };
type Action = Button | Link;
```

The generated resolver checks `isObject(input)` and the declared `kind` value
before invoking `Button(input)` or `Link(input)`. An object with an undeclared
discriminator resolves to the explicit invalid contract rather than being
silently accepted as the first object branch.

When synthetic object branches have no literal discriminator, the resolver
uses a unique declared property when one exists. If the branches are truly
indistinguishable, such as `{} | {}`, it preserves the object-family value
without pretending that one model won. This keeps structural ambiguity
explicit instead of turning it into accidental coercion.

Presence/absence unions such as `string | null` and `string | undefined`
lower to a string-family default of `''`. Defaults handle missing or
`undefined` inputs; incoming `null` still needs the target scope's guard.

For a numeric agreement, `0` is the canonical falsifiable response. Runtime
`NaN` propagates through ordinary arithmetic and must be handled by an explicit
numeric guard or resolver where the agreement requires usable numeric output.
A parameter default of `0` does not replace incoming `NaN`.

TypeScript has no separate built-in `NaN` type. A bare `NaN` spelling therefore
remains unknown to the adapter; it cannot create an optional-number default. A
type alias named `NaN` is treated as absence only when its declaration (or a
declaration-backed alias) resolves to `null`, `undefined`, or `void`. A
shadowed `NaN` alias that resolves to another family remains that family.

`keyof T` preserves declaration-backed string, numeric, and symbol key-family
evidence. A string index admits both string and numeric keys, while mixed
families retain a resolver rather than being collapsed to string. Symbols have
no falsifiable canonical value: constructing one would change identity, so a
symbol-only key remains caller-owned. Unsupported or unresolved key
sources remain unknown. These are source-lowering concerns; they do not
introduce a key-to-value agreement requirement in the ECMAScript dialect.

An unguarded `any` remains a required target parameter:

```javascript
const read = value => value;
```

An explicit content guard with an empty-object fallback changes that boundary
back to optional, because the control flow establishes the contract:

```javascript
const render = (object = {}) => {
    if (!hasContent(object)) return {};
    return renderObject(object);
};
```

That makes the distinction visible in the output:

```javascript
object => render(object);                         // required
(object = {}) => render(object);                   // optional pass-through
object => { if (!hasContent(object)) return {}; }  // optional by proven fallback
```

A supported type-guard pattern such as `typeof payload === 'string'` can also
satisfy a guarded `any` boundary. The current adapter recognizes a bounded set
of guard patterns and does not claim complete path-sensitive control-flow
proof. Projects can provide a resolver name through `resolvers`, for example
`{ any: 'resolveExternalValue' }`.

The standard library keeps syntax predicates and runtime predicates separate.
`isFunctionNode` classifies an AST node using `FUNCTION_TYPES`; `isFunction`
classifies a runtime value. The same distinction applies to `isObject` and
other standard predicates. Arrays use the same split: `isArray` establishes the
family, `validArray` returns the canonical `[]` for invalid input while
preserving valid empty or populated arrays, and `hasArrayContent` expresses the
`value.length` versus `!value.length` cardinality contract. The transformer
targets canonical modules through the `standard` configuration rather than
copying their implementations.

Object-shape membership uses `modelCheck(attr, model)`. It checks whether the
attribute exists, including falsey values such as `''`, `0`, or `false`; it does
not use the member's truthiness as evidence of presence.

Generated union resolvers can select canonical `array` and `function` runtime
predicates through the same configuration:

```javascript
standard: {
    object: '../rules/support/object.js',
    array: '../rules/support/array.js',
    function: '../rules/support/function.js'
}
```

## ESLint developer experience

The TypeScript adapter is also exposed as an ESLint flat-config factory. The
project supplies its TypeScript-aware parser; Resilient supplies the rules:

```javascript
import typescriptParser from '@typescript-eslint/parser';
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.typescript({ parser: typescriptParser })
];
```

This scopes the recommended, contract, and safety rules to `.ts` and `.tsx`.
Parser services and TypeScript project resolution remain parser configuration;
runtime contract semantics remain Resilient configuration.

That gives the dialect two complementary feedback paths. ESLint highlights a
policy violation while the author is editing TypeScript; the transformer then
lowers accepted source into executable contracts. A TS annotation is therefore
not a bypass around Resilient policy—it is evidence that participates in the
same grammar, and the emitted JavaScript is checked against that grammar again.

## Deliberate limits

This adapter proves the lowering model; it is not TypeScript compiler parity.
It currently focuses on object aliases, interfaces, primitive families, unions,
resolvable conditional types, and boundary obligations. It does not evaluate runtime
schemas or infer a
validator for arbitrary third-party values. Those remain project-owned
resolver boundaries, which preserves the same agnostic and overridable graph
model used by the rest of Resilient.

Type-level computations that do not have a faithful runtime lowering—such as
template-literal, `infer`, `unique symbol`, and dynamic import types—fail closed
with transformer diagnostics instead of silently becoming an invented contract.
Resolvable mapped types, indexed access, and conditional types are supported
when their keys and members can be resolved structurally; unresolved forms
remain required/unknown boundaries rather than being coerced into a selected
branch.
