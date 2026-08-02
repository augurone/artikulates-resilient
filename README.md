# eslint-plugin-resilient

Resilient is an opinionated, ECMAScript-native standard for functional-first, data-driven JavaScript. It uses explicit contracts, predictable shapes, declarative transformations, and graceful runtime degradation while reserving hard failures for the build.

* Data flow: Inspired by Flux and functional approaches, with clear movement from input to transformation to output.
* Contracts: Destructured signatures declare required data, defaults handle absence, and malformed shapes remain visible contract violations.
* Runtime behavior: Missing content degrades pragmatically into stable empty values instead of taking down the site.
* Control flow: No classes, nested conditionals, else branches, or imperative loops; native functions and prototype methods state intent directly.
* Enforcement: ESLint turns the model into build-time rules so invalid code fails before publication while valid runtime variation remains survivable.

**These rules are based on:** docs/CODING_STANDARDS.md

## Install

```bash
npm install --save-dev eslint-plugin-resilient
```

## Configure

For ESLint flat config, add the recommended configuration:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended
];
```

The recommended configuration enables the twelve custom resilient rules plus
the native ESLint rules used by the standard.

Resilient uses ESLint flat config and requires ESLint 9 or later. Node.js
18.18 or later is supported.

## IDE integration

Resilient does not require an editor-specific plugin. Editors use the local
ESLint installation and the project's `eslint.config.js`.

### VS Code

Install the [ESLint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
and open the project folder. If workspace settings define `eslint.validate`,
include JavaScript:

```json
{
    "eslint.validate": ["javascript"],
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": "explicit"
    }
}
```

ESLint 9 uses flat config by default. The extension resolves ESLint from the
opened workspace, so install ESLint and Resilient locally rather than relying
on a global installation.

### JetBrains IDEs

In WebStorm or another JetBrains IDE, open **Settings | Languages & Frameworks
| JavaScript | Code Quality Tools | ESLint** and select **Automatic ESLint
configuration**. The IDE will use the local ESLint package and
`eslint.config.js`. For monorepos, set the working directory to the package
that contains the relevant configuration.

Resilient distinguishes automatic fixes from suggestions. The current rules
provide explicit suggestions for length checks and signature destructuring,
while contract and structural rules report problems without rewriting code.
Suggestions require deliberate editor selection; they are not silently applied
on save.

## Custom rules

Rule behavior is intentionally explicit:

- Suggestions: `prefer-signature-destructuring` and `no-length-comparison`
- Diagnostics only: `no-destructuring-fallback`, `no-else`,
  `no-null-assignment`, `no-nested-if`, `no-undefined-assignment`,
  `no-undefined-comparison`, `prefer-destructured-member-access`,
  `prefer-falsey-returns`, `prefer-prototype-methods`, and
  `prefer-safe-destructuring-defaults`

Resilient currently provides no silent automatic fixes for its custom rules.

- `resilient/prefer-signature-destructuring`
- `resilient/no-destructuring-fallback`
- `resilient/no-else`
- `resilient/no-length-comparison`
- `resilient/no-null-assignment`
- `resilient/no-nested-if`
- `resilient/no-undefined-assignment`
- `resilient/no-undefined-comparison`
- `resilient/prefer-destructured-member-access`
- `resilient/prefer-falsey-returns`
- `resilient/prefer-prototype-methods`
- `resilient/prefer-safe-destructuring-defaults`

To enable rules selectively:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    {
        plugins: {
            resilient
        },
        rules: {
            'resilient/prefer-signature-destructuring': 'error'
        }
    }
];
```

Rule details and examples are in [docs/rules](docs/rules/). The complete
standard, including rationale and exceptions, is in
[docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md).

## Development

```bash
npm test
npm run lint
```

## License

MIT
