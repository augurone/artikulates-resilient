import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { createOwner, familyEvidence } from 'eslint-plugin-resilient/agreement';

import { createSession } from '../../../analysis/analyzer/analysis.js';
import { completeCallable } from '../../../analysis/analyzer/callables.js';
import { callOutcome } from '../../../analysis/analyzer/calls.js';
import { createDecisions } from '../../../analysis/analyzer/decisions.js';
import { createDemand } from '../../../analysis/analyzer/demand.js';
import { sequenceFlow } from '../../../analysis/analyzer/flow.js';
import { createModelStorage } from '../../../analysis/analyzer/model.js';
import { formalSlot } from '../../../analysis/analyzer/patterns.js';
import { unknownOwner } from '../../../analysis/analyzer/uncertainty.js';
import { append, put } from '../../../analysis/collections.js';
import { getObject } from '../../../analysis/host/object.js';
import { traverse } from '../../../analysis/traversal.js';
import { getCompilerOptionsIdentity } from '../../utils/compiler-shape.js';
import { callableCreation, callableParameters, tupleConsumer } from './source-callables.js';
import { createCallableReferences, indexSource, localAlias } from './source-lexical.js';
import { acquireStatementFlow, sourceLifetime } from './source-statements.js';

const digest = text => createHash('sha256').update(text).digest('hex');
const verifyProgram = ({ program = false, sourceFile = {}, fileName = '', compilerOptionsIdentity = '' } = {}) => {
    if (!program) return;

    const { getSourceFile, getCompilerOptions } = program;

    if (typeof getSourceFile !== 'function' || typeof getCompilerOptions !== 'function') throw new TypeError('Expected the owning compiler Program');

    if (getSourceFile.call(program, fileName) !== sourceFile || getCompilerOptionsIdentity(getCompilerOptions.call(program)) !== compilerOptionsIdentity) {
        throw new Error('Compiler source/Program mismatch');
    }
};
const sourceIdentity = ({ typescript = {}, program = false, sourceFile = {}, sourceText = '', filename = '',
    revision = '', programRevision = '', compilerOptionsIdentity = '' } = {}) => {
    const { version = '', SyntaxKind: { SourceFile = -1 } = {} } = typescript;
    const { kind = -2, fileName = '', text = '', parseDiagnostics = [] } = sourceFile;

    if (SourceFile < 0 || kind !== SourceFile) throw new TypeError('Expected an original compiler SourceFile');

    if (![version, filename, revision, programRevision, compilerOptionsIdentity].every(value => typeof value === 'string' && value.length)) {
        throw new TypeError('Expected explicit compiler, file, source revision, Program revision and options identities');
    }

    if (resolve(filename) !== filename || resolve(fileName) !== filename || text !== sourceText) throw new Error('Compiler source identity mismatch');

    if (parseDiagnostics.length) throw new SyntaxError('Compiler source contains parse diagnostics', { cause: parseDiagnostics.at(0) });

    verifyProgram({ program, sourceFile, fileName, compilerOptionsIdentity });

    return Object.freeze({ filename, revision, programRevision, compilerVersion: version, compilerOptionsIdentity, digest: digest(sourceText) });
};

const prepare = ({ typescript = {}, sourceFile = {}, source = {}, census = false } = {}) => {
    const { SyntaxKind: { ArrayLiteralExpression = -1, ObjectLiteralExpression = -1, PropertyAssignment = -1, ShorthandPropertyAssignment = -1,
        CallExpression = -1, Identifier = -1, OmittedExpression = -1, SpreadElement = -1,
        NumericLiteral = -1, StringLiteral = -1, TrueKeyword = -1, FalseKeyword = -1, NullKeyword = -1,
        Block = -1,
        ParenthesizedExpression = -1, AsExpression = -1, NonNullExpression = -1, SatisfiesExpression = -1, ConditionalExpression = -1, PropertyAccessExpression = -1,
        ImportDeclaration = -1, ExportDeclaration = -1 } = {} } = typescript;
    const { root: lexicalRoot = {}, scopes = new WeakMap(), identities = new WeakMap(), functions: entries = [],
        calls: callNodes = [], writes = new Set(), invalidExecutions = new Set(), annexExecutions = new Set(), dynamic = false, nodes = 0 } = indexSource({ typescript, sourceFile, census });
    const callableReference = createCallableReferences({ typescript, identities, scopes });
    const storage = createModelStorage();
    const { own = false, ownStatement = false, absence = {}, unknown = {} } = storage;

    if (typeof own !== 'function' || typeof ownStatement !== 'function') throw new TypeError('Expected owned model storage');

    const { filename: module = '' } = source;
    const { getLineAndCharacterOfPosition } = sourceFile;

    if (typeof getLineAndCharacterOfPosition !== 'function') throw new TypeError('Expected compiler source locations');

    const location = ({ pos = -1, end = -1 } = {}) => {
        if (pos < 0 || end < pos) throw new Error('Expected original compiler spans');

        const { line = 0, character = 0 } = getLineAndCharacterOfPosition.call(sourceFile, pos);

        return Object.freeze({ source, range: Object.freeze([pos, end]), line: line + 1, column: character + 1 });
    };
    const common = node => ({ module, execution: getObject(scopes.get(node)).execution, location: location(node), truth: -1, guarded: true });
    const opaque = (node, code = 'unsupported-expression') => own({ ...unknown, ...common(node), owner: unknownOwner({ code, location: location(node) }) });
    const acquired = new WeakMap();
    const lifetimes = new WeakMap();
    const models = new WeakMap();
    const selections = new WeakMap();
    const aliases = new WeakMap();
    const bodies = [];
    const consumers = [];
    const functions = entries.map(({ node = {}, scope: { execution = false } = {}, parentExecution = false } = {}, index) => {
        const { body = node } = node;
        const admitted = tupleConsumer({ typescript, node, identities });
        const parameters = callableParameters({ typescript, node });
        const executable = Boolean(parameters) && !dynamic && !invalidExecutions.has(execution);
        const signature = Object.freeze({ supported: false, parameters: Object.freeze([]), descriptor: Object.freeze({ index, location: location(node), parameters: Object.freeze([]) }) });
        const model = { functionModel: true, module, index, execution, parentExecution, location: location(node), bodyLocation: location(body),
            supported: Boolean(executable), signature, owner: unknownOwner({ code: 'unsupported-signature', location: location(node) }) };

        put(models, node, model);

        if (executable) {
            const { kind = -1, statements = [] } = body;
            const inputs = parameters.map((parameter, position) => {
                const { name = {} } = parameter;
                const { kind = -1, elements = [] } = name;
                const input = own({ ...common(name), execution, kind: 'parameter', key: Symbol('formal input'), position, fallback: false,
                    owner: unknownOwner({ code: 'parameter-input', location: location(parameter) }) });

                if (kind === Identifier) put(selections, identities.get(name), input);

                elements.forEach(({ name = {} } = {}, slot) => {
                    const binding = identities.get(name);

                    if (binding) put(selections, binding, own(formalSlot({ ...common(name), execution, target: input, slot })));
                });

                return { input, parameter, pattern: kind !== Identifier };
            });

            append(bodies, { node, model, inputs, statements, expression: kind === Block ? false : body });
        }

        if (admitted) {
            const { parameter = {}, position = -1, slots = [] } = admitted;
            const positions = Object.freeze(slots.map(({ slot = 0, binding = {}, requirement = {}, family = '' } = {}) => {
                const { locationNode = {} } = binding;

                return Object.freeze({ slot, binding: location(locationNode),
                    requirement: Object.freeze({ family, provenance: 'tuple-annotation', location: location(requirement) }) });
            }));
            const [{ binding = {}, requirement = {} } = {}] = positions;

            // Retain the first consumer's public shape for its single position.
            append(consumers, { node, model, descriptor: Object.freeze({ index: consumers.length, functionIndex: index,
                source, location: location(node), parameter: location(parameter), parameterIndex: position, slots: positions,
                ...(positions.length === 1 ? { binding, requirement, returnedSlot: 0 } : {}) }) });
        }

        return model;
    });
    const recordEntries = ({ properties = [] } = {}) => properties.map(({ kind = -2, name = {}, initializer = false } = {}) => {
        const { kind: nameKind = -2, text = '' } = name;
        const shorthand = kind === ShorthandPropertyAssignment;

        return { name: text, value: shorthand ? name : initializer,
            supported: (shorthand || kind === PropertyAssignment) && [Identifier, StringLiteral, NumericLiteral].includes(nameKind) &&
                Boolean(text) && (shorthand || text !== '__proto__') };
    });
    const transparent = new Set([ParenthesizedExpression, AsExpression, NonNullExpression, SatisfiesExpression]);
    const syntaxChildren = ({ kind = -1, elements = [], properties = [], arguments: args = [], expression = {}, condition = {}, whenTrue = {}, whenFalse = {} } = {}) => {
        if (kind === ArrayLiteralExpression) return elements;

        if (kind === ObjectLiteralExpression) return recordEntries({ properties }).filter(({ supported = false } = {}) => supported).map(({ value = false } = {}) => value);

        if (kind === CallExpression) return [expression, ...args];

        if (kind === ConditionalExpression) return [condition, whenTrue, whenFalse];

        if (transparent.has(kind) || kind === PropertyAccessExpression) return [expression];

        return [];
    };
    const dependencies = (node = {}) => {
        const { kind = -1 } = node;

        return kind === Identifier ? [localAlias(node, identities, scopes)].filter(Boolean) : syntaxChildren(node);
    };
    const literals = new Map([[NumericLiteral, 'number'], [StringLiteral, 'string'], [TrueKeyword, 'boolean'], [FalseKeyword, 'boolean'], [NullKeyword, 'nullish']]);
    const literalValue = ({ kind = -1, text = '' } = {}) => {
        if (kind === NumericLiteral) return Number(text);

        return kind === StringLiteral ? text : kind === TrueKeyword;
    };
    const read = node => acquired.get(node) || unknown;
    const compile = (node = {}) => {
        const { kind = -1, text = '', elements = [], expression = {}, arguments: args = [], questionDotToken = false } = node;
        const facts = common(node);
        const lifetime = lifetimes.get(node) || false;
        const borrow = target => lifetime ? own({ ...facts, kind: 'unowned', target, lifetime }) : target;
        const binding = identities.get(node);
        const { ambiguous = false, callable = false } = binding ?? {};

        if (callableCreation({ typescript, node })) return own({ ...facts, kind: 'source', inert: true, familyOnly: true,
            truth: 1, absence: 'present', promise: 'none', callable: models.get(node), closure: models.get(node),
            owner: createOwner({ evidence: familyEvidence({ name: 'function' }) }) });

        if (kind === Identifier && writes.has(binding)) return opaque(node, 'unstable-binding');

        if (kind === Identifier && !ambiguous && selections.has(binding)) {
            const { execution = false } = binding;
            const { execution: readExecution = false } = facts;

            return execution === readExecution ? borrow(selections.get(binding)) : opaque(node, 'captured-value');
        }

        const initializer = kind === Identifier && localAlias(node, identities, scopes);

        if (initializer) return borrow(aliases.get(binding) || put(aliases, binding, own({ ...facts, kind: 'link', key: Symbol('local alias'),
            target: read(initializer), familyOnly: read(initializer).familyOnly, transfer: false })));

        if (kind === Identifier && !binding && text === 'undefined') return own({ ...absence, ...facts });

        if (kind === Identifier && !ambiguous && models.has(callable)) return own({ ...facts, kind: 'source', inert: true, truth: 1,
            absence: 'present', promise: 'none', callable: models.get(callable), owner: createOwner({ evidence: familyEvidence({ name: 'function' }) }) });

        if (kind === OmittedExpression) return absence;

        if (kind === ArrayLiteralExpression) {
            const array = own({ ...facts, kind: 'array', arguments: Object.freeze(elements.map(read)),
                argumentOwned: Object.freeze(elements.map(() => true)), holes: Object.freeze(elements.map(({ kind = -1 } = {}) => kind === OmittedExpression)),
                fixed: !elements.some(({ kind = -1 } = {}) => kind === SpreadElement), standardPrototype: true });

            return own({ ...facts, kind: 'unowned', target: array, lifetime: sourceLifetime({ own, call: array, prior: lifetime }) });
        }

        if (kind === ObjectLiteralExpression) {
            const entries = recordEntries(node);
            const supported = entries.every(({ supported = false } = {}) => supported);
            const record = own({ ...facts, kind: 'record', entries: Object.freeze(entries.map(({ name = '', value = false, supported = false } = {}) => (
                Object.freeze({ name, known: supported, data: supported, value: supported ? read(value) : unknown, key: false })
            ))), trusted: supported, standardPrototype: supported, owner: unknownOwner({ code: 'unsupported-expression', location: location(node) }) });

            return own({ ...facts, kind: 'unowned', target: record, lifetime: sourceLifetime({ own, call: record, prior: lifetime }) });
        }

        if (transparent.has(kind)) return read(expression);

        if (kind === ConditionalExpression) {
            const { condition = {}, whenTrue = {}, whenFalse = {} } = node;

            return own({ ...facts, kind: 'conditional', test: read(condition), yes: read(whenTrue), no: read(whenFalse),
                yesLocation: location(whenTrue), noLocation: location(whenFalse) });
        }

        if (kind === PropertyAccessExpression) {
            const { name: { text: name = '' } = {} } = node;

            return own({ ...facts, kind: 'member', target: read(expression), name, supported: !questionDotToken,
                owner: unknownOwner({ code: 'unsupported-expression', location: location(node) }) });
        }

        if (kind === CallExpression && (questionDotToken || args.some(({ kind = -1 } = {}) => kind === SpreadElement))) return opaque(node, 'unsupported-compiler-execution');

        if (kind === CallExpression) {
            const { callable = false } = getObject(callableReference(expression));
            const model = models.get(callable) || models.get(expression) || getObject(read(expression)).callable;
            const { text: name = '' } = expression;
            const { index: functionIndex = -1 } = model ?? {};

            const call = own({ ...facts, kind: 'member-call', callee: read(expression), functionIndex,
                name, requireInertPrefix: true, arguments: Object.freeze(args.map(read)),
                argumentFresh: Object.freeze(args.map(({ kind = -1 } = {}) => [ArrayLiteralExpression, ObjectLiteralExpression].includes(kind))),
                argumentMetadata: Object.freeze(args.map(argument => Object.freeze({ location: location(argument) }))),
                owner: unknownOwner({ code: 'unresolved-call', location: location(node) }) });

            const callee = read(expression);
            const { kind: calleeKind = '' } = callee;
            const unsupported = calleeKind === 'member' ? own({ ...callee, supported: false }) : callee;

            return lifetime ? own({ ...facts, kind: 'conditional', functionIndex, name, test: lifetime, yes: call,
                no: own({ ...call, callee: unsupported, nativeAvailable: false }), yesLocation: location(node), noLocation: location(node) }) : call;
        }

        const family = literals.get(kind);

        if (!family) return opaque(node, kind === Identifier ? 'unresolved-binding' : 'unsupported-expression');

        const value = literalValue(node);

        return own({ ...facts, kind: 'source', inert: true, familyOnly: true, truth: Number(Boolean(value)), absence: family === 'nullish' ? 'null' : 'present', promise: 'none',
            ...(family === 'nullish' ? {} : { constant: Object.freeze({ value }) }), owner: createOwner({ evidence: familyEvidence({ name: family }) }) });
    };
    const expressionFor = (node, lifetime = false) => {
        traverse(node, { enter: (current) => {
            if (acquired.has(current)) return [];

            put(lifetimes, current, lifetime);

            return dependencies(current);
        }, leave: (current) => {
            if (!acquired.has(current)) put(acquired, current, compile(current));
        } });

        return read(node);
    };

    functions.forEach((model) => {
        const { execution = false, supported = false } = model;

        if (!supported) completeCallable(model, ownStatement(execution, { kind: 'unsupported', owner: getObject(model).owner }));
    });
    bodies.forEach(({ model = {}, statements = [], expression = false, inputs = [] } = {}) => {
        const { execution = false } = model;
        const ownFlow = description => ownStatement(execution, description);
        const initialization = inputs.filter(({ pattern = false } = {}) => pattern).map(({ input = {}, parameter = {}, pattern = false } = {}) => ownFlow({ kind: 'effect', argument: input,
            binding: pattern, nativePattern: pattern, formalPattern: pattern, location: location(parameter) }));
        const prefix = sequenceFlow(initialization, ownFlow, ownFlow({ kind: 'continue' }));
        const body = expression ? ownFlow({ kind: 'return', argument: expressionFor(expression, sourceLifetime({ own, call: prefix })), location: location(expression) })
            : acquireStatementFlow({ typescript, statements, initialization, own: ownFlow, expressionFor, location, absence });

        completeCallable(model, expression ? sequenceFlow([prefix, body], ownFlow, ownFlow({ kind: 'continue' })) : body);
    });
    const { execution = false } = lexicalRoot;
    const { statements = [] } = sourceFile;
    const ownRoot = description => ownStatement(execution, description);
    const imported = statements.some(({ kind = -1, moduleSpecifier = false } = {}) => kind === ImportDeclaration || (kind === ExportDeclaration && moduleSpecifier));
    const initialization = imported ? [ownRoot({ kind: 'unsupported', owner: unknownOwner({ code: 'unsupported-statement', location: location(sourceFile) }) })] : [];
    const root = completeCallable({ functionModel: true, index: functions.length, execution, module, supported: !dynamic && !annexExecutions.has(execution), bodyLocation: location(sourceFile) },
        acquireStatementFlow({ typescript, statements, initialization, own: ownRoot, expressionFor, location, absence }));
    const slotsByFunction = new Map(consumers.map(({ descriptor: { functionIndex = -1, slots = [] } = {} } = {}) => [functionIndex, slots]));
    const callSelections = [];
    const calls = callNodes.map((node, index) => {
        const expression = expressionFor(node);
        const { functionIndex = -1, name = '' } = expression;
        const slots = Object.freeze((slotsByFunction.get(functionIndex) || []).map(({ slot = 0, requirement = {} } = {}) => {
            const { length: resultIndex = 0 } = callSelections;
            const { family = '' } = requirement;

            append(callSelections, { expression: own({ ...common(node), kind: 'selection', target: expression, slot, name: '', formal: false, fallback: false }),
                site: expression, required: family, descriptor: Object.freeze({ index: resultIndex }) });

            return Object.freeze({ slot, requirement, resultIndex });
        }));

        return Object.freeze({ index, functionIndex, name, location: location(node), slots });
    });
    const decisions = createDecisions();
    const demand = createDemand({ functions, root, moduleRoots: [root], decisions, absence, unknown });
    const analysis = createSession({ functions, demand, counts: { nodes, functions: functions.length, ...storage.counts() },
        prepared: callSelections, callResults: callNodes.map(node => demand.ownerFor(expressionFor(node))) });

    return { source, analysis, sourceFiles: new WeakSet([sourceFile]),
        functionOrigins: new WeakMap(entries.map(({ node = {} } = {}, index) => [node, index])),
        origins: new WeakMap(consumers.map(({ node = {}, descriptor: { index = -1 } = {} } = {}) => [node, index])),
        consumers: Object.freeze(consumers.map(({ descriptor = {} } = {}) => descriptor)),
        calls: Object.freeze(calls) };
};

// A live session closes over owned descriptors and the shared demand engine.
// Acquisition locals (Program, compiler tree, scopes and reader closures) die here.
const session = ({ source = {}, analysis = {}, consumers = [], calls = [], sourceFiles = new WeakSet(), origins = new WeakMap(), functionOrigins = new WeakMap() } = {}) => {
    const { checkFunction: evaluateFunction, checkCallResult, check: checkSlot, functions = [] } = analysis;
    const byFunction = Map.groupBy(calls, ({ functionIndex = -1 } = {}) => functionIndex);
    const completed = new Map();

    if (typeof evaluateFunction !== 'function' || typeof checkCallResult !== 'function' || typeof checkSlot !== 'function') throw new TypeError('Expected shared analysis queries');

    const checkFunction = ({ index = -1, node = false, sourceFile = false, ...observation } = {}) => {
        if ((node || sourceFile) && (!sourceFiles.has(sourceFile) || functionOrigins.get(node) !== index)) throw new Error('Compiler function source identity mismatch');

        return evaluateFunction({ index, ...observation });
    };

    const checkTuple = ({ index = -1, node = false, sourceFile = false, ...observation } = {}) => {
        const descriptor = consumers.at(index);

        if (!Number.isInteger(index) || index < 0 || !descriptor) throw new RangeError('Expected a compiler tuple consumer index');

        if ((node || sourceFile) && (!sourceFiles.has(sourceFile) || origins.get(node) !== index)) throw new Error('Compiler tuple source identity mismatch');

        if (completed.has(index)) return completed.get(index);

        const { functionIndex = -1 } = descriptor;
        const result = checkFunction({ ...observation, index: functionIndex });
        const witnesses = (byFunction.get(functionIndex) || []).map(({ index: callIndex = -1, location = {}, slots: positions = [] } = {}) => {
            const { normal = false, thrown = false } = checkCallResult({ ...observation, index: callIndex, required: 'array' });
            const slots = Object.freeze(positions.map(({ slot = 0, requirement = {}, resultIndex = -1 } = {}) => {
                const { family = '' } = requirement;

                const { status = '', fact = {} } = checkSlot({ ...observation, index: resultIndex, required: family });

                return Object.freeze({ slot, requirement, result: Object.freeze({ status, fact, normal, thrown }) });
            }));
            const [{ result: first = {} } = {}] = slots;

            // Selecting the freshly returned slots is inert; all share the
            // invocation's completion. Slot facts remain separate in a pair.
            return Object.freeze({ location, scope: 'invocation', ...(slots.length === 1 ? first : { normal, thrown }),
                status: callOutcome(slots.map(({ result: { status = '' } = {} } = {}) => status)), slots });
        });

        return put(completed, index, Object.freeze({ source, descriptor, result, status: callOutcome(witnesses.map(({ status = '' } = {}) => status).concat('unknown')),
            calls: Object.freeze(witnesses), reason: 'Generic tuple input has no runtime slot requirement proof; source iteration remains native' }));
    };

    return Object.freeze({ source, consumers, checkTuple, functions, calls, checkFunction, checkCallResult, get counts() {
        const { counts = {} } = analysis;

        return counts;
    } });
};

export const createTypeScriptAnalysis = (options = {}) => session(prepare({ ...options, source: sourceIdentity(options) }));
