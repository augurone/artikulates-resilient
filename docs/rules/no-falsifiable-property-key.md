# no-falsifiable-property-key

The recommended preset rejects explicit falsifiable defaults used as object
property names: empty text, false, null, empty arrays/objects, native undefined,
and void expressions. Zero is rejected as an object-literal property name,
including Number and BigInt forms such as `{ 0: 'value' }`, `{ [0n]: 'value' }`
and `{ [-0n]: 'value' }`. Literal-only template keys use the same name checks
as quoted strings. Empty module import/export names are also rejected. There is no autofix: inventing a
name would change the program's contract.

Numeric member selection (`items[0]`, `items[-0]`, `items[0n]`, `items['0']`) and numeric
destructuring (`const { [0]: first = 0 } = items`, or a noncomputed numeric key)
retain native indexing.
Map keys and Set values are collection data; `new Map([[0, value]])` and
`new Set([0])` remain valid. Ordinary empty/default values remain valid.

This explicit syntax policy was requested on November 13, 2026. It extends the
recommended policy under P-01/P-02; it is not an ECMAScript runtime restriction.
It does not guess dynamic key values, evaluate arbitrary key expressions, or
inspect opaque reflective APIs. A shadowed `undefined` is not native absence.
Computed numeric selection is retained without claiming that an unknown receiver
has an array family.

Explicit names `false`, `null`, and `undefined` are rejected in either quoted
or identifier spelling; quoting a default name does not repair it. A quoted
`'0'` in an object literal is the same rejected property name as numeric `0`.

Module specifiers are checked by their role under G-S07: import names and
exported names are property names. A local export's local side is a binding
reference, so `const undefined = 7; export { undefined as result };` has no
finding from this rule. The separate `no-shadow-restricted-names` policy still
applies to that declaration. A re-export with a source checks both its imported
and exported names. Unnamed `export *` has no explicit name to check.

Signed literal zero includes Number `+0`/`-0` and BigInt `-0n`. Unary `+0n`
throws before producing a key; this rule does not manufacture one. Interpolated
templates and other executable key expressions remain outside literal-name
classification under S-02/S-03.

Semantics S-02/S-03 still govern inference: a missing key fact stays unknown.
Rejecting a source form does not authorize replacing it with a default key or
silencing another rule. The analyzer preserves explicitly known keys when
examining invalid programs and external boundaries. Any necessary boundary
exception names this rule and its concrete reason under P-03.

Fixed external schemas can require these keys: npm's lockfile uses `''` for
the root package, for example. Retain that spelling at the adapter boundary
with a local exception. Native conformance tests can likewise retain explicit
empty-key or array-like objects when their exact Get/Set behavior is the subject
of the test. These exceptions do not authorize application defaults as keys.

Tests: [falsifiable-keys.test.js](../../tests/falsifiable-keys.test.js) and the
[public rule canary](../../tests/rule-canary.test.js).
