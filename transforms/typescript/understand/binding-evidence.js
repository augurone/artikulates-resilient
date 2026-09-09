import { createSourceCensus } from './source-census.js';
import { getAgreementReason, getCheckerContract, getTypeInfo, getTypeText, getRuntimeKind } from './type-evidence.js';
import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

const getBindingName = ({ element = {} } = {}) => {
    const { name = {} } = element;

    return name;
};

const getBindingElementCanonical = ({
    typescript = {},
    element = {},
    sourceFile = {},
    declarations = {},
    checker = {},
    resolvers = {}
} = {}) => {
    const name = getBindingName({ element });
    const checkerInfo = getCheckerContract({
        typescript,
        node: name,
        checker,
        declarations,
        typeText: getTypeText({ node: name, sourceFile })
    });
    const { canonical: checkerCanonical = '' } = checkerInfo;
    const info = getTypeInfo({
        typescript,
        node: name,
        sourceFile,
        declarations,
        resolvers,
        checker
    });
    const { canonical: infoCanonical = '' } = info;

    return checkerCanonical || infoCanonical || '';
};

const getBindingAgreementReason = ({
    typescript = {},
    element = {},
    sourceFile = {},
    declarations = {},
    checker = {},
    resolvers = {}
} = {}) => {
    const name = getBindingName({ element });
    const checkerInfo = getCheckerContract({
        typescript,
        node: name,
        checker,
        declarations,
        typeText: getTypeText({ node: name, sourceFile })
    });
    const { kind: checkerKind = '' } = checkerInfo;
    const info = getTypeInfo({
        typescript,
        node: name,
        sourceFile,
        declarations,
        resolvers,
        checker
    });
    const { kind: infoKind = '' } = info;

    return getAgreementReason({
        typescript,
        checker,
        node: name,
        kind: checkerKind || infoKind
    });
};

const runtimeGuardKinds = new Set([
    'string',
    'number',
    'boolean',
    'bigint',
    'array',
    'object',
    'function'
]);

const getBindingRuntimeGuardKind = ({
    typescript = {},
    element = {},
    sourceFile = {},
    declarations = {},
    checker = {},
    resolvers = {}
} = {}) => {
    const { name = {} } = getObject(element);
    const checkerInfo = getCheckerContract({
        typescript,
        node: name,
        checker,
        declarations,
        typeText: getTypeText({ node: name, sourceFile })
    });
    const { kind: checkerInfoKind = '' } = checkerInfo;
    const info = getTypeInfo({
        typescript,
        node: name,
        sourceFile,
        declarations,
        resolvers,
        checker
    });
    const kind = getRuntimeKind(checkerInfoKind ? checkerInfo : info);

    return runtimeGuardKinds.has(kind) ? kind : '';
};

const getRuntimeGuardKinds = ({ typescript = {},
    sourceFile = {},
    declarations = {},
    checker = {},
    resolvers = {},
    census = createSourceCensus({ typescript, sourceFile }) } = {}) => {
    const {
        SyntaxKind: {
            VariableDeclaration: VariableDeclarationKind2 = -1
        } = {}
    } = typescript;

    const { BindingElement = -1 } = getSyntaxKinds(typescript);
    let kinds = new Set();
    const visit = (node) => {
        const { parent: nodeParent = {} } = getObject(node);
        const { parent: declaration = {} } = getObject(nodeParent);

        const { kind: nodeKind = 0, dotDotDotToken = false } = getObject(node);
        const { kind: declarationKind = 0 } = getObject(declaration);

        if (nodeKind !== BindingElement ||
            dotDotDotToken ||
            declarationKind !== VariableDeclarationKind2) {
            return;
        }

        const canonical = getBindingElementCanonical({
            typescript,
            element: node,
            sourceFile,
            declarations,
            checker,
            resolvers
        });
        const kind = getBindingRuntimeGuardKind({
            typescript,
            element: node,
            sourceFile,
            declarations,
            checker,
            resolvers
        });

        if (!canonical && kind) kinds = new Set([...kinds, kind]);
    };

    census.select(BindingElement).forEach(visit);

    return kinds;
};

export { getBindingElementCanonical, getBindingAgreementReason, getBindingRuntimeGuardKind, getRuntimeGuardKinds };
