import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { createAuthoredRuleScope } from '../policy/exceptions.js';

// A namespace member read creates a local snapshot, never a live import or
// re-export. Retain the declaration, its scope and its position in execution.
const lowerNamespaceSnapshots = ({
    typescript = {}, sourceFile = {}, namespaceReferences = new Set(), context = {}
} = {}) => {
    if (!namespaceReferences.size) return sourceFile;

    const { factory = {} } = typescript;
    const { VariableDeclaration = -1, Identifier = -1, PropertyAccessExpression = -1,
        ObjectBindingPattern = -1, AsExpression = -1, TypeAssertionExpression = -1,
        SatisfiesExpression = -1, ParenthesizedExpression = -1, NonNullExpression = -1,
        MultiLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const unwrap = (node = {}) => {
        const { kind = 0, expression = {} } = getObject(node);

        return [AsExpression, TypeAssertionExpression, SatisfiesExpression, ParenthesizedExpression, NonNullExpression].includes(kind)
            ? unwrap(expression) : node;
    };
    const rule = 'resilient/prefer-safe-destructuring-defaults';
    const authoredRules = createAuthoredRuleScope({ typescript, sourceFile });
    const retainAbsence = (pattern, owner) => {
        if (authoredRules(owner, [rule]).has(rule)) return pattern;

        // Clone before annotation: callers may reuse their compiler tree while
        // this transform is alive. The narrow pair leaves other bindings alone.
        const retained = factory.cloneNode(pattern);

        return typescript.addSyntheticTrailingComment(
            typescript.addSyntheticLeadingComment(retained, MultiLineCommentTrivia,
                ` eslint-disable ${rule} -- Namespace snapshot retains native absence and binding-time failure. `, false),
            MultiLineCommentTrivia, ` eslint-enable ${rule} `, false
        );
    };
    const visit = (node = {}) => {
        const visited = typescript.visitEachChild(node, visit, context);
        const { kind = 0, name = {}, initializer = {}, exclamationToken, type } = getObject(visited);

        if (kind !== VariableDeclaration) return visited;

        const source = unwrap(initializer);
        const { kind: sourceKind = 0, expression = {}, name: property = {}, questionDotToken = false } = getObject(source);
        const { kind: nameKind = 0, text: local = '', elements = [] } = getObject(name);
        const direct = nameKind === Identifier && sourceKind === PropertyAccessExpression && !questionDotToken;
        const pattern = nameKind === ObjectBindingPattern && sourceKind === Identifier;
        const receiver = direct ? expression : source;

        if ((!direct && !pattern) || !namespaceReferences.has(typescript.getOriginalNode(receiver))) return visited;

        if (pattern) {
            const plain = elements.every(({ name = {}, dotDotDotToken = false, propertyName = {} } = {}) => (
                getObject(name).kind === Identifier && !dotDotDotToken &&
                (!getObject(propertyName).kind || getObject(propertyName).kind === Identifier)
            ));
            const missing = elements.some(({ initializer = false } = {}) => !initializer);

            return plain && missing ? factory.updateVariableDeclaration(visited,
                retainAbsence(name, node), exclamationToken, type, initializer) : visited;
        }

        const { text: imported = '' } = getObject(property);
        const binding = factory.createBindingElement(undefined, imported === local ? undefined : property, name);
        const snapshot = retainAbsence(factory.createObjectBindingPattern([binding]), node);

        return factory.updateVariableDeclaration(visited, snapshot, exclamationToken, type, receiver);
    };

    return typescript.visitEachChild(sourceFile, visit, context);
};

export { lowerNamespaceSnapshots };
