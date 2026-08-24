import { RuleTester } from 'eslint';

import rule from '../rules/no-silent-catch.js';

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
    }
});

ruleTester.run('no-silent-catch', rule, {
    valid: [
        { code: 'try { run(); } catch (error) { throw error; }' },
        { code: 'try { run(); } catch (error) { log(error); }' },
        { code: 'const runSafely = () => { try { run(); } catch (error) { return fallback(error); } };' },
        { code: 'try { run(); } finally { cleanup(); }' }
    ],
    invalid: [
        {
            code: 'try { run(); } catch (error) {}',
            errors: [{ messageId: 'silentCatch' }]
        },
        {
            code: 'try { run(); } catch {}',
            errors: [{ messageId: 'silentCatch' }]
        }
    ]
});
