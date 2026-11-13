import { createNativeUndefinedReader } from './support/native-absence.js';
import { createReporter } from './support/reporter.js';

const numericZero = value => value === 0 || value === 0n;
const falsifiableName = (value, named = false) => ['', false, null, 'false', 'null', 'undefined'].includes(value) ||
    (named && (numericZero(value) || value === '0'));

// Property names are not absence defaults. Numeric selections remain native
// indexing, including computed destructuring; collection API arguments are data.
const falsifiableKey = ({ type = '', value = true, elements = [], properties = [], expressions = [], quasis = [], operator = '', argument = {} } = {}, named = false) => {
    if (type === 'Literal') return falsifiableName(value, named);

    if (type === 'ArrayExpression') return !elements.length;

    if (type === 'ObjectExpression') return !properties.length;

    const [{ value: { cooked = false } = {} } = {}] = quasis;

    if (type === 'TemplateLiteral') return !expressions.length && quasis.length === 1 && typeof cooked === 'string' && falsifiableName(cooked, named);

    const { type: operand = '', value: number = 1 } = argument;
    const signed = operator === '-' || (operator === '+' && typeof number === 'number');

    return type === 'UnaryExpression' && (operator === 'void' || (named && signed && operand === 'Literal' && numericZero(number)));
};

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Reject falsifiable defaults used as property names while preserving native indexing and collection keys',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-falsifiable-property-key.md'
        },
        schema: [],
        messages: { falsifiableKey: 'Use a meaningful property name; empty or falsifiable defaults are not property names.' }
    },
    create(context = {}) {
        const report = createReporter(context);
        const nativeUndefined = createNativeUndefinedReader(context);
        const check = (key, named = false, computed = true) => {
            const { type = '', name = '' } = key;
            const literalName = !computed && type === 'Identifier' && ['false', 'null', 'undefined'].includes(name);

            if (literalName || falsifiableKey(key, named) || (computed && nativeUndefined(key))) report({ node: key, messageId: 'falsifiableKey' });
        };

        return {
            Property({ key = {}, computed = false, parent: { type = '' } = {} } = {}) {
                check(key, type !== 'ObjectPattern', computed);
            },
            MemberExpression({ computed = false, property = {} } = {}) {
                check(property, false, computed);
            },
            ImportSpecifier({ imported = {} } = {}) {
                check(imported, false, false);
            },
            ExportSpecifier({ exported = {}, local = {}, parent: { source = false } = {} } = {}) {
                check(exported, false, false);

                if (source) check(local, false, false);
            },
            ExportAllDeclaration({ exported = false } = {}) {
                if (exported) check(exported, false, false);
            }
        };
    }
};
