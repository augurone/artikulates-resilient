# operator-linebreak

## What this finding means

`resilient/operator-linebreak` delegates operator placement to ESLint's core
`operator-linebreak`, with one declaration/comment policy exception. The
recommended profile keeps operators before line breaks' following operands,
with `&&` and `||` after their preceding operands.

When `=` uses `before` style, a variable declarator may retain `=` on the
binding's final line if comments separate it from the next executable token
on a later line. This preserves the initializer-leading comment anchor:

```javascript
export const empty =
    // Authored initializer explanation.
    new Map();
```

Line comments, block comments, multiple comments and directives all qualify.
The rule leaves this complete layout intact, including directive target lines.

## Boundaries and non-goals

Uncommented declarations, comments before `=`, comments inside initializer
parentheses, assignment expressions, class fields, binary/logical operators
and conditional operators retain core behavior. A lone `=` on its own line
also retains core behavior. Explicit `after`, `none` and `ignore` overrides
retain core behavior. The exception accepts an existing preferred layout; it
does not relocate authored comments from another layout.

This rule changes formatting policy, not declaration emission or semantics.
It uses the installed ESLint core implementation for ordinary validation and
fixing. It does not introduce another formatter or turn off operator placement.
The recommended profile replaces the core rule with this rule using the same
options. Consumers adopting that profile should target
`resilient/operator-linebreak` in rule-specific directives and overrides.

## Repair recipes

Keep the binding and `=` together when retaining a leading initializer
comment, as above. For ordinary multiline declarations, use the existing
before style:

```javascript
const value
    = initialize();
```

Use the rule's fixer for ordinary operator layout findings. Do not move a
comment across `=` merely to satisfy the former core-only policy.
