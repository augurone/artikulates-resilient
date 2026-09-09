import { registerBindingSource } from './contracts/binding-evidence.js';
import { getMemberAccessFact } from './contracts/member-evidence.js';

export default {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Require static data from function parameters to be destructured',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/prefer-destructured-member-access.md'
        },
        schema: [],
        messages: {
            staticMember: 'Destructure bound data before accessing it.'
        }
    },
    create({ report = () => {}, sourceCode = {} } = {}) {
        registerBindingSource(sourceCode);

        return {
            MemberExpression(node = {}) {
                if (getMemberAccessFact(node) !== 'static-data') return;

                report({ node, messageId: 'staticMember' });
            }
        };
    }
};
