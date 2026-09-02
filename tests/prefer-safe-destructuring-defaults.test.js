import { RuleTester } from 'eslint';

import rule from '../rules/prefer-safe-destructuring-defaults.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('prefer-safe-destructuring-defaults', rule, {
    valid: [
        { code: 'const getConfig = ({ config: { timBurton = "" } = {} } = {}) => timBurton;' },
        { code: 'const useState = value => [value, () => {}]; const [value, setValue] = useState(false);' },
        { code: 'const run = ({ onDone } = {}) => { if (isFunction(onDone)) onDone(); };' }
    ],
    invalid: [
        {
            code: 'const getConfig = ({ config: { timBurton } = {} } = {}) => timBurton;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const getConfig = ({ config } = {}) => config;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const getFirst = ([item] = []) => item;',
            errors: [{ messageId: 'safeDefault' }]
        },
        {
            code: 'const run = ({ onDone }) => { const later = () => onDone(); return later; };',
            errors: [{ messageId: 'safeDefault' }]
        }
    ]
});
