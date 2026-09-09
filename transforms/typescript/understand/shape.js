import { createSourceCensus } from './source-census.js';
import { requireCompilerMember } from './type-resolution.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';
import { createAstShape, getParameterShape } from '../../utils/ast-shape.js';

const invokeProvider = ({ provider = requireCompilerMember('Shape.provider'), input = {} } = {}) => provider(input);

const createShapeProvider = ({
    typescript = {},
    program = {},
    resolvers = {},
    targetScript = 0,
    getProgramDeclarationMap = requireCompilerMember('Shape.getProgramDeclarationMap'),
    getDeclarationMap = requireCompilerMember('Shape.getDeclarationMap'),
    getUnsupportedTypeDiagnostics = requireCompilerMember('Shape.getUnsupportedTypeDiagnostics'),
    getRuntimeReferences = requireCompilerMember('Shape.getRuntimeReferences'),
    getRuntimeNames = requireCompilerMember('Shape.getRuntimeNames'),
    getRuntimeGuardKinds = requireCompilerMember('Shape.getRuntimeGuardKinds'),
    getTypeInfo = requireCompilerMember('Shape.getTypeInfo'),
    getTypeText = requireCompilerMember('Shape.getTypeText'),
    hasRuntimeDeclaration = requireCompilerMember('Shape.hasRuntimeDeclaration')
} = {}) => {
    const { ScriptKind = {}, createSourceFile = requireCompilerMember('createSourceFile') } = typescript;
    const parameterKinds = [
        'FunctionDeclaration', 'FunctionExpression', 'ArrowFunction', 'MethodDeclaration',
        'MethodSignature', 'Constructor', 'GetAccessor', 'SetAccessor', 'CallSignature',
        'ConstructSignature', 'IndexSignature', 'FunctionType', 'ConstructorType', 'JSDocFunctionType', 'JSDocSignature'
    ].map(name => getSyntaxKinds(typescript)[name]);
    const isFunctionNode = ({ kind = 0 } = {}) => parameterKinds.includes(kind);
    const collect = (node, functions = []) => {
        const { kind = 0 } = createAstShape(node);
        const nextFunctions = functions;

        if (isFunctionNode({ kind })) {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private preorder buffer preserves identity and statement-complete parameter reads.
            nextFunctions.push(node);
        }

        typescript.forEachChild(node, (child) => {
            collect(child, nextFunctions);
        });

        return nextFunctions;
    };

    const createAnalysis = ({ code = '', fileName = 'input.ts' } = {}) => {
        const {
            getSourceFile = false,
            getTypeChecker = false
        } = program;
        const programSourceFile = typeof getSourceFile === 'function'
            ? getSourceFile.call(program, fileName)
            : undefined;
        const {
            TSX = -1,
            TS = -1
        } = ScriptKind;
        const sourceFile = programSourceFile || createSourceFile(
            fileName,
            code,
            targetScript,
            true,
            fileName.endsWith('.tsx') ? TSX : TS
        );
        const declarations = {
            ...invokeProvider({
                provider: getProgramDeclarationMap,
                input: { typescript, program }
            }),
            ...invokeProvider({
                provider: getDeclarationMap,
                input: { typescript, sourceFile }
            })
        };
        const checker = typeof getTypeChecker === 'function'
            ? getTypeChecker.call(program)
            : undefined;

        if (checker) Object.defineProperty(declarations, '__checker', {
            configurable: true,
            enumerable: false,
            value: checker
        });

        const census = createSourceCensus({ typescript, sourceFile });
        const diagnostics = invokeProvider({
            provider: getUnsupportedTypeDiagnostics,
            input: { typescript, census, sourceFile, declarations, checker }
        });
        const usedUnions = [];
        const usedObjects = [...invokeProvider({
            provider: getRuntimeReferences,
            input: { typescript, census, sourceFile }
        })];
        const reservedNames = invokeProvider({
            provider: getRuntimeNames,
            input: { typescript, census, sourceFile, checker }
        });
        const contracts = [];
        const { statements = [] } = sourceFile;

        statements.forEach((statement) => {
            const functions = collect(statement);

            functions.forEach(({ parameters = [] } = {}) => {
                parameters.forEach((parameter = {}) => {
                    const { name: parameterName = '', type = {} } = getParameterShape(parameter);
                    const { kind: typeKind = 0 } = createAstShape(type);
                    const info = typeKind
                        ? invokeProvider({
                            provider: getTypeInfo,
                            input: {
                                typescript,
                                node: type,
                                sourceFile,
                                declarations,
                                resolvers,
                                reservedNames
                            }
                        })
                        : {};

                    const {
                        kind: infoKind = 'unknown',
                        family = '',
                        canonical = '',
                        optional = false,
                        requiresGuard = false,
                        resolver = '',
                        parts = []
                    } = info;

                    if (typeKind) {
                        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private parameter buffer preserves ordered records with linear construction.
                        contracts.push({
                            parameter: parameterName,
                            typeText: invokeProvider({
                                provider: getTypeText,
                                input: { node: type, sourceFile }
                            }),
                            kind: infoKind,
                            family,
                            canonical,
                            optional: !!optional,
                            requiresGuard: !!requiresGuard,
                            resolver
                        });
                    }

                    if (infoKind !== 'union') return;

                    // eslint-disable-next-line resilient/prefer-safe-transformations -- Private union buffer preserves resolver overwrite order and exact info identity.
                    usedUnions.push([resolver, info]);
                    parts.forEach((part) => {
                        const partInfo = invokeProvider({
                            provider: getTypeInfo,
                            input: {
                                typescript,
                                node: part,
                                sourceFile,
                                declarations,
                                resolvers,
                                reservedNames
                            }
                        });
                        const {
                            resolver: partInfoResolver = '',
                            kind: partInfoKind = ''
                        } = partInfo;
                        const isRuntimeDeclaration = partInfoKind === 'resolved' && invokeProvider({
                            provider: hasRuntimeDeclaration,
                            input: { declarations, name: partInfoResolver }
                        });

                        if (isRuntimeDeclaration) {
                            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private reference buffer preserves seed and union-part order before publication.
                            usedObjects.push(partInfoResolver);
                        }
                    });
                });
            });
        });

        return {
            census,
            contracts,
            declarations,
            diagnostics,
            reservedNames,
            sourceFile,
            checker,
            usedObjects: new Set(usedObjects),
            usedUnions: new Map(usedUnions),
            runtimeGuardKinds: invokeProvider({
                provider: getRuntimeGuardKinds,
                input: { typescript, census, sourceFile, declarations, checker, resolvers }
            })
        };
    };

    return { createAnalysis };
};

export {
    createShapeProvider
};
