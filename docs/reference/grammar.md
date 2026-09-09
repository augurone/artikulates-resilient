# Resilient grammar

Grammar describes the forms available to express a contract. [Policy](policy.md)
determines which forms are permitted at a boundary; [Semantics](semantics.md)
defines their meaning. These three documents form one normative specification.
The [AI guide](../ai/CODING_STANDARDS.md) presents the same specification compactly.

Resilient uses existing ECMAScript syntax. This is a contract-oriented inventory,
not a replacement parser grammar or a new annotation language. Parsing follows
the configured JavaScript or TypeScript parser. A parsed construct can still
violate policy or carry insufficient analyzer evidence. The IDs below are
documentation labels, not tokens to insert into source.

## G-A: Atomic grammar

“Atomic” means the smallest useful pieces of executable contract expression;
it does not imply that every entry is a lexical token.

| ID | Form | Examples and role |
| --- | --- | --- |
| G-A01 | Names and bindings | Identifiers name values, parameters, and imports. Names alone do not prove families. |
| G-A02 | Literal values | Strings, numbers, booleans, regular expressions, and `null`; `undefined` is an identifier, not a literal. |
| G-A03 | Aggregate expressions | `[]`, `{}`, array elements, named/computed properties, and spread. |
| G-A04 | Binding patterns | Object/array destructuring, aliases, nested patterns, rest, and default initializers. |
| G-A05 | Operations | Calls, member access, arithmetic, comparison, logical and conditional expressions, `typeof`, and `await`. |
| G-A06 | Callable expressions | Arrow functions and function expressions, including async forms and callbacks. |

A canonical empty value is a semantic choice, not a distinct token category.
`{}` is ordinary object syntax; its suitability as a fallback depends on the
contract. `||` is available even though object-destructuring fallbacks using it
are restricted by policy.

## G-S: Structural grammar

| ID | Composition | Contract role |
| --- | --- | --- |
| G-S01 | Declarations and scope | Bind values and callable expressions. |
| G-S02 | Function signatures | Compose parameters, nested patterns, defaults, and rest to expose consumed shape. |
| G-S03 | Function bodies and returns | Compose declarations, operations, guard paths, effects, and returned values. |
| G-S04 | Branches and iteration | Conditionals, loops, and collection callbacks express selection, traversal, and termination. |
| G-S05 | Transformations | Compose construction, spread, and prototype calls to produce values. |
| G-S06 | Async and failure boundaries | Compose promises, `await`, `try`, `catch`, `finally`, and `throw`. |
| G-S07 | Module relationships | Imports, exports, and re-exports connect authored contracts; resolution is adapter-owned. |

Atomic patterns and defaults compose a structural signature:

```javascript
const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

G-A04 identifies patterns and defaults; G-S02 identifies the signature.
[S-05](semantics.md#s-05-shapes-and-defaults) explains missing-value behavior.
[P-01](policy.md#p-01-rules) requires explicit defaults where the rule applies.
These are three descriptions of the same code, not three syntaxes.

`else`, nested `if`, classes, optional chaining, mutation, and function
declarations are recognizable ECMAScript forms. Preset rejection is a policy
decision, not a claim that the parser cannot read them. Unsupported static
inference likewise does not make an expression ungrammatical.

## G-T: TypeScript source and emitted target

The [TypeScript adapter](typescript.md) accepts TypeScript as an input language
and emits ECMAScript with executable contracts. Source aliases, interfaces,
type operators, and annotations are not additional target grammar. Supported
forms lower to signatures, defaults, models, or resolvers. Other forms use the
adapter's documented diagnostic or required/unknown boundary behavior.

The adapter requires ECMAScript 2016 or newer and preserves JSX for downstream
tooling. This minimum is not a promise that all emitted syntax is ES2016 or
that all TypeScript forms are supported. Generated helpers and authored target
code need the appropriate parser and the same applicable policy checks.

See [typescript.md](typescript.md) for lowering support and
[contracts.md](contracts.md) for the analyzer's evidence limits. Framework,
JSX, and project architecture policy belongs to the consuming project.
