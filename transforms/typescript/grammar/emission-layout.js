import { getObject } from '../../../rules/support/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

// Directive list grammar accepts quoted names and empty comma entries. An empty
// normalized list disables every rule; justification starts at two or more
// hyphens surrounded by whitespace. Admission must preserve those scopes too.
const readDirectiveComment = (text = '') => {
    const match = text.match(/\s-{2,}\s/u);
    const [separator = ''] = match || [];
    const index = separator ? text.indexOf(separator) : text.length;
    const [, action = '', names = ''] = text.slice(0, index).trim()
        .match(/^eslint-(disable-next-line|disable-line|disable|enable)(?:\s+(.*))?$/su) || [];
    const rules = [...new Set(names.split(',').map(name => name.trim().replace(/^(['"]?)(.*)\1$/su, '$2')).filter(Boolean))];

    return { action, rules, reason: text.slice(index + separator.length).trim() };
};

// Layout owns only completed JavaScript tokens and whitespace. It never asks
// the checker for another semantic decision or runs a lint rule/fixer.
const applyEdits = (code, edits) => {
    const ordered = edits.toSorted((left, right) => getObject(left).start - getObject(right).start || getObject(right).end - getObject(left).end);
    // An outer arrow wrapper can begin exactly where an inner arrow loses
    // its optional parameter parenthesis. Compose both edits at that offset.
    const composed = ordered.reduce((result, edit) => {
        const previous = result.at(-1);

        if (previous && getObject(previous).start === getObject(edit).start &&
            getObject(edit).start === getObject(edit).end && getObject(previous).end > getObject(edit).end) {
            return [...result.slice(0, -1), { ...previous, replacement: getObject(edit).replacement + getObject(previous).replacement }];
        }

        return [...result, edit];
    }, []);
    const disjoint = composed.filter((edit, index) => !composed.slice(0, index).some(previous => (
        getObject(previous).end > getObject(edit).start || getObject(previous).start === getObject(edit).start
    )));

    return disjoint.toReversed().reduce((text, { start = 0, end = 0, replacement = '' }) => (
        text.slice(0, start) + replacement + text.slice(end)
    ), code);
};

const readSyntax = (code, typescript, scriptKind = getObject(getObject(typescript).ScriptKind).JS) => {
    const source = typescript.createSourceFile('emission.js', code, getObject(getObject(typescript).ScriptTarget).Latest, true, scriptKind);
    const nodes = [];
    const tokens = [];
    const visit = (node) => {
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private traversal work list preserves compiler node identity and source order.
        nodes.push(node);
        const children = node.getChildren(source);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private token index preserves exact source node identities.
        if (!children.length) tokens.push(node);

        children.forEach(visit);
    };

    visit(source);
    const comments = new Map();
    tokens.forEach((token) => {
        [...typescript.getLeadingCommentRanges(code, getObject(token).pos) || [],
            ...typescript.getTrailingCommentRanges(code, getObject(token).end) || []].forEach((range) => {
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private range index deduplicates compiler comment spans by source offset.
            comments.set(getObject(range).pos, range);
        });
    });
    const commentPayloads = [...comments.values()].map(({ pos: start = 0, end = 0 }) => ({ start, end }));
    const payloads = [...commentPayloads, ...tokens
        .filter(token => typescript.isLiteralExpression(token) || typescript.isTemplateLiteralToken(token))
        .map(token => ({ start: token.getStart(source), end: getObject(token).end }))];

    const directiveLines = new Set([...comments.values()]
        .filter(({ pos = 0, end = 0 }) => /eslint-disable-(?:next-)?line\b/u.test(code.slice(pos, end)))
        .map(({ pos = 0, end = 0 }) => /eslint-disable-next-line\b/u.test(code.slice(pos, end))
            ? source.getLineAndCharacterOfPosition(end).line + 1
            : source.getLineAndCharacterOfPosition(pos).line));

    const nextLineTargets = new Set([...comments.values()]
        .filter(({ pos = 0, end = 0 }) => /eslint-disable-next-line\b/u.test(code.slice(pos, end)))
        .map(({ end = 0 }) => source.getLineAndCharacterOfPosition(end).line + 1));

    const { parseDiagnostics = [] } = getObject(source);
    // TypeScript defers a missing throw operand beyond parseDiagnostics.
    const invalid = Boolean(parseDiagnostics.length) || nodes.some(node => typescript.isThrowStatement(node) &&
        getObject(node).expression.getWidth(source) === 0);

    return { source, nodes, invalid, tokens: tokens.filter(token => getObject(token).kind !== getSyntaxKinds(typescript).EndOfFileToken), commentPayloads, payloads, directiveLines, nextLineTargets };
};

const changesDirectiveLine = (code, source, directiveLines, start, end, replacement, nextLineTargets) => {
    const breaks = text => text.split('\n').length;
    const { line: first = 0 } = source.getLineAndCharacterOfPosition(start);
    const { line: last = 0 } = source.getLineAndCharacterOfPosition(end);

    const nextLine = code.indexOf('\n', end);
    const suffix = code.slice(end, nextLine < 0 ? code.length : nextLine);

    return breaks(code.slice(start, end)) !== breaks(replacement) &&
        [...directiveLines].some(line => line > first && line <= last &&
            (nextLineTargets.has(line) || !replacement.includes('\n')) || line === first &&
            (first === last && Boolean(suffix.trim()) || !replacement.includes('\n')));
};

const formatWhitespace = (code, typescript) => {
    const { source = {}, payloads = [], directiveLines = new Set(), nextLineTargets = new Set() } = readSyntax(code, typescript);
    const snapshot = typescript.ScriptSnapshot.fromString(code);
    const host = {
        getCompilationSettings: () => ({ allowJs: true, noLib: true }),
        getScriptFileNames: () => ['emission.js'],
        getScriptVersion: () => '0',
        getScriptSnapshot: () => snapshot,
        getCurrentDirectory: () => '',
        getDefaultLibFileName: () => '',
        fileExists: () => true,
        readFile: () => code
    };
    const service = typescript.createLanguageService(host);

    try {
        const edits = service.getFormattingEditsForDocument('emission.js', {
            indentSize: 4, tabSize: 4, convertTabsToSpaces: true, newLineCharacter: '\n',
            insertSpaceAfterCommaDelimiter: true,
            insertSpaceAfterSemicolonInForStatements: true,
            insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
            insertSpaceAfterKeywordsInControlFlowStatements: true,
            insertSpaceBeforeAndAfterBinaryOperators: true,
            insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
            indentSwitchCase: true,
            semicolons: getObject(getObject(typescript).SemicolonPreference).Ignore
        }).map(({ span: { start = 0, length = 0 } = {}, newText: replacement = '' }) => ({ start, end: start + length, replacement }))
            .filter(({ start = 0, end = 0, replacement = '' }) => (
                !payloads.some(range => start < getObject(range).end && end > getObject(range).start) &&
                !changesDirectiveLine(code, source, directiveLines, start, end, replacement, nextLineTargets)));

        return applyEdits(code, edits);
    } finally {
        service.dispose();
    }
};

const layoutSyntax = (code, typescript) => {
    const { source = {}, nodes = [], tokens = [], commentPayloads = [], payloads = [], directiveLines = new Set(), nextLineTargets = new Set() } = readSyntax(code, typescript);
    const edits = new Map();
    const startOf = node => node.getStart(source);
    const lineOf = position => source.getLineAndCharacterOfPosition(position).line;
    const lineLength = (position) => {
        const start = code.lastIndexOf('\n', position - 1) + 1;
        const next = code.indexOf('\n', position);

        return (next < 0 ? code.length : next) - start;
    };
    const put = (start, end, replacement) => {
        if (payloads.some(range => start < getObject(range).end && end > getObject(range).start)) return;

        // A line directive owns every operation on its targeted physical line.
        // Placement must choose a scoped boundary before that line can wrap.
        const nextLine = code.indexOf('\n', end);
        const suffix = code.slice(end, nextLine < 0 ? code.length : nextLine).trim();
        // An opening parenthesis at the end of an argument line owns no
        // reported token. Move it with the following commented argument.
        const openingDelimiter = !replacement.trim() && /^\(+$/u.test(suffix);

        if (changesDirectiveLine(code, source, directiveLines, start, end, replacement, nextLineTargets) && !openingDelimiter) return;

        const key = `${start}:${end}`;
        const { replacement: previous = '' } = getObject(edits.get(key));
        const combined = start === end && previous.trim() && replacement.trim() ? previous + replacement : replacement;
        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private edit map composes coincident grammar insertions and assigns each syntax gap one layout.
        edits.set(key, { start, end, replacement: combined });
    };
    const whitespace = (start, end, replacement) => {
        const ownsInsertion = [...edits.values()].some(({ start: position = 0, end: limit = 0, replacement: text = '' }) => (
            position === limit && position >= start && position <= end && Boolean(text.trim())
        ));

        if (!ownsInsertion && /^\s*$/u.test(code.slice(start, end))) put(start, end, replacement);
    };
    const before = (node, replacement = '\n') => {
        const start = startOf(node);
        const preceding = tokens.findLast(token => getObject(token).end <= start && token !== node);

        if (preceding) whitespace(getObject(preceding).end, start, replacement);
    };
    const after = (node, replacement = '\n') => {
        const next = tokens.find(token => startOf(token) >= getObject(node).end && token !== node);

        if (next) whitespace(getObject(node).end, startOf(next), replacement);
    };
    const multilineList = (node, elements) => {
        const hasComment = elements.some((element) => {
            const text = code.slice(getObject(element).pos, getObject(element).end);

            return /^\s*\(\s*(?:\/\/|\/\*)\s*eslint-disable\b/u.test(text) ||
                typescript.isParenthesizedExpression(element) && text.includes('// Retained indexed operation ends here.');
        });

        if (!elements.length || lineLength(startOf(node)) <= 180 && !hasComment) return;

        elements.forEach(element => before(element));
        const last = elements.at(-1);
        after(last);
    };
    const layoutArrow = (node) => {
        if (!typescript.isArrowFunction(node)) return;

        const { parameters = [], body = {}, equalsGreaterThanToken = {} } = getObject(node);
        const [parameter = {}] = parameters;
        const children = node.getChildren(source);
        const open = children.find(({ kind = 0 }) => kind === getSyntaxKinds(typescript).OpenParenToken);
        const close = children.find(({ kind = 0 }) => kind === getSyntaxKinds(typescript).CloseParenToken);
        const simple = parameters.length === 1 && typescript.isIdentifier(getObject(parameter).name) && !getObject(parameter).initializer && !getObject(parameter).dotDotDotToken;

        if (simple && !typescript.isBlock(body) && open && close &&
            /^\s*$/u.test(code.slice(getObject(open).end, startOf(parameter))) &&
            /^\s*$/u.test(code.slice(getObject(parameter).end, startOf(close)))) {
            put(startOf(open), getObject(open).end, '');
            put(startOf(close), getObject(close).end, '');
        }

        if (simple && typescript.isBlock(body) && !open) {
            put(startOf(parameter), startOf(parameter), '(');
            put(getObject(parameter).end, getObject(parameter).end, ')');
        }

        if (!typescript.isBlock(body) && !typescript.isParenthesizedExpression(body) &&
            lineLength(startOf(body)) > 180 && lineOf(startOf(body)) === lineOf(getObject(equalsGreaterThanToken).end) &&
            !directiveLines.has(lineOf(startOf(body))) && !directiveLines.has(lineOf(getObject(body).end))) {
            put(startOf(body), startOf(body), '(\n');
            put(getObject(body).end, getObject(body).end, '\n)');
        }
    };

    const layoutBinary = (node) => {
        if (!typescript.isBinaryExpression(node)) return;

        const { left = {}, operatorToken = {}, right = {} } = node;
        const logical = [getSyntaxKinds(typescript).AmpersandAmpersandToken, getSyntaxKinds(typescript).BarBarToken].includes(getObject(operatorToken).kind);
        const tail = code.slice(getObject(node).end, code.indexOf('\n', getObject(node).end));
        const split = !tail.includes('eslint-disable-line') &&
            (lineOf(getObject(left).end) !== lineOf(startOf(right)) || lineLength(startOf(node)) > 180);

        if (split) {
            whitespace(getObject(left).end, startOf(operatorToken), logical ? ' ' : '\n');
            whitespace(getObject(operatorToken).end, startOf(right), logical ? '\n' : ' ');
        }
    };

    const layoutDeclaration = (node) => {
        if (!(typescript.isVariableDeclaration(node) && getObject(node).initializer)) return;

        const { initializer = {} } = node;
        const equals = node.getChildren(source).find(({ kind = 0 }) => kind === getSyntaxKinds(typescript).EqualsToken);
        const split = equals && (lineOf(getObject(equals).end) !== lineOf(startOf(initializer)) ||
            typescript.isLiteralExpression(initializer) && lineLength(startOf(node)) > 180);

        if (!split) return;

        const [comment = {}] = typescript.getLeadingCommentRanges(code, getObject(initializer).pos) || [];
        const { pos: commentStart = -1, kind: commentKind = 0 } = comment;
        const nextStart = commentStart >= 0 ? commentStart : startOf(initializer);

        if (commentKind === getSyntaxKinds(typescript).SingleLineCommentTrivia) return;

        before(equals);

        if (commentKind !== getSyntaxKinds(typescript).SingleLineCommentTrivia) whitespace(getObject(equals).end, nextStart, ' ');
    };

    const layoutArray = (node) => {
        if (!typescript.isArrayLiteralExpression(node)) return;

        const { elements = [] } = getObject(node);
        multilineList(node, elements);
        const last = elements.at(-1);
        const { hasTrailingComma = false } = elements;

        if (!last || typescript.isOmittedExpression(last) || !hasTrailingComma) return;

        const comma = tokens.find(token => getObject(token).kind === getSyntaxKinds(typescript).CommaToken &&
            startOf(token) >= getObject(last).end && getObject(token).end < getObject(node).end);

        if (comma) put(startOf(comma), getObject(comma).end, '');
    };

    // A paired endpoint can overflow an otherwise retained physical line.
    // Move only the closing comment, never a diagnostic-bearing token or a
    // disable-line comment. The enabled region still starts before the next
    // executable token, and the original line keeps every owned operation.
    const endpointEdits = commentPayloads.flatMap(({ start = 0, end = 0 }) => {
        const text = code.slice(start, end);
        const lineStart = code.lastIndexOf('\n', start - 1) + 1;
        const nextLine = code.indexOf('\n', end);
        const lineEnd = nextLine < 0 ? code.length : nextLine;
        const prefix = code.slice(lineStart, start);
        const [indent = ''] = prefix.match(/^ */u) || [];
        const gap = start - (prefix.match(/ *$/u) || [''])[0].length;

        if (!/^\/\*\s*eslint-enable\b[^\n]*\*\/$/u.test(text) ||
            !prefix.trim() || lineEnd - lineStart <= 200 ||
            code.slice(end, lineEnd).trim() || indent.length + text.length > 200) return [];

        return [{ start: gap, end: start, replacement: `\n${indent}` }];
    });

    if (endpointEdits.length) return applyEdits(code, endpointEdits);

    // A multiline block comment inside parentheses already separates the
    // enclosing physical line. Give its expression a separate gap without
    // changing comment bytes or directive scope.
    nodes.filter(node => typescript.isParenthesizedExpression(node)).forEach((node) => {
        const { expression = {} } = getObject(node);
        const leading = [...typescript.getLeadingCommentRanges(code, getObject(expression).pos) || [],
            ...typescript.getTrailingCommentRanges(code, getObject(expression).pos) || []];
        const lastLeading = leading.at(-1);
        const commentText = lastLeading ? code.slice(getObject(lastLeading).pos, getObject(lastLeading).end) : '';

        if (lastLeading && commentText.includes('\n') && !/eslint-disable-(?:next-)?line\b/u.test(commentText) &&
            !code.slice(getObject(lastLeading).end, startOf(expression)).includes('\n')) {
            whitespace(getObject(lastLeading).end, startOf(expression), '\n');
        }
    });
    // Re-read physical lengths after separating comment-owned expressions.
    const commentEdits = [...edits.values()].filter(({ start = 0, end = 0, replacement = '' }) => code.slice(start, end) !== replacement);

    if (commentEdits.length) return applyEdits(code, commentEdits);

    nodes.forEach((node) => {
        layoutArrow(node);

        if (typescript.isNamedImports(node) || typescript.isNamedExports(node) || typescript.isObjectBindingPattern(node)) {
            multilineList(node, getObject(node).elements);
        }

        const { arguments: args = [] } = getObject(node);

        if ((typescript.isCallExpression(node) || typescript.isNewExpression(node)) && args.length > 1) multilineList(node, args);

        if (typescript.isObjectLiteralExpression(node)) multilineList(node, getObject(node).properties);

        layoutArray(node);

        layoutBinary(node);

        layoutDeclaration(node);

        if (typescript.isConditionalExpression(node) && (lineLength(startOf(node)) > 180 || lineOf(startOf(node)) !== lineOf(getObject(node).end))) {
            before(getObject(node).questionToken);
            before(getObject(node).colonToken);
        }

        if (typescript.isClassDeclaration(node) || typescript.isClassExpression(node)) {
            getObject(node).members.slice(1).forEach((member, index) => {
                const [previous = {}] = getObject(node).members.slice(index, index + 1);
                const [comment = {}] = typescript.getLeadingCommentRanges(code, getObject(member).pos) || [];
                const { pos: position = startOf(member) } = comment;
                const trailing = typescript.getTrailingCommentRanges(code, getObject(previous).end) || [];
                const { end = getObject(previous).end } = getObject(trailing.at(-1));
                whitespace(end, position, '\n\n');
            });
        }

        const statements = typescript.isSourceFile(node) || typescript.isBlock(node) || typescript.isCaseClause(node) || typescript.isDefaultClause(node)
            ? getObject(node).statements : [];
        statements.slice(1).forEach((statement, index) => {
            const [previous = {}] = statements.slice(index, index + 1);
            const relativeImport = candidate => /^\.\.?\//u.test(getObject(getObject(candidate).moduleSpecifier).text || '');
            const importGroup = typescript.isImportDeclaration(previous) && typescript.isImportDeclaration(statement) &&
                relativeImport(previous) !== relativeImport(statement);
            const needsBlank = importGroup || typescript.isIfStatement(previous) || typescript.isIfStatement(statement) || typescript.isReturnStatement(statement);
            const adjacentReturns = typescript.isReturnStatement(previous) && typescript.isReturnStatement(statement);

            if (!needsBlank) return;

            // Leading comments belong to the next statement. Pad ahead of the
            // complete trivia group, never between a directive and its target.
            const leading = typescript.getLeadingCommentRanges(code, getObject(statement).pos) || [];
            const [comment = false] = leading;
            const start = comment ? getObject(comment).pos : startOf(statement);
            const trailing = typescript.getTrailingCommentRanges(code, getObject(previous).end) || [];
            const end = trailing.length ? trailing.at(-1).end : getObject(previous).end;

            whitespace(end, start, adjacentReturns ? '\n' : '\n\n');
        });
    });
    // Drop only punctuation that is optional in these completed list grammars.
    tokens.forEach((token, index) => {
        if (getObject(token).kind !== getSyntaxKinds(typescript).CommaToken) return;

        const [next = false] = tokens.slice(index + 1, index + 2);

        if (!next || ![getSyntaxKinds(typescript).CloseBraceToken, getSyntaxKinds(typescript).CloseParenToken].includes(getObject(next).kind)) return;

        put(startOf(token), getObject(token).end, '');
    });
    const selected = [...edits.values()].toSorted((left, right) => getObject(left).start - getObject(right).start || getObject(left).end - getObject(right).end)
        .filter((edit, index, entries) => !entries.slice(0, index).some(previous => getObject(previous).end > getObject(edit).start));

    return applyEdits(code, selected);
};

const alignDeclarationContinuations = (code, typescript) => {
    const { source = {}, nodes = [], payloads = [] } = readSyntax(code, typescript);
    const edits = [];
    nodes.filter(node => typescript.isVariableDeclaration(node)).forEach((node) => {
        const equals = node.getChildren(source).find(({ kind = 0 }) => kind === getSyntaxKinds(typescript).EqualsToken);

        if (!equals) return;

        const position = equals.getStart(source);
        const lineStart = code.lastIndexOf('\n', position - 1) + 1;
        const ownStart = node.getStart(source);
        const ownLineStart = code.lastIndexOf('\n', ownStart - 1) + 1;
        const [indent = ''] = code.slice(ownLineStart).match(/^ */u) || [];
        const delta = position - lineStart - indent.length;

        if (lineStart === ownLineStart || delta <= 0 || !/^ *$/u.test(code.slice(lineStart, position))) return;

        const lines = code.slice(lineStart, getObject(node).end).split('\n');
        let offset = lineStart;
        lines.forEach((line) => {
            const [spaces = ''] = line.match(/^ */u) || [];
            const start = offset;
            offset += line.length + 1;

            if (spaces.length < delta || payloads.some(range => start > getObject(range).start && start < getObject(range).end)) return;

            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private edit list records disjoint indentation gaps without touching payloads.
            edits.push({ start, end: start + delta, replacement: '' });
        });
    });

    const emptyLoopEdits = nodes.filter(node => typescript.isForStatement(node) &&
        !getObject(node).initializer && !getObject(node).condition && !getObject(node).incrementor).flatMap((node) => {
        const [first = {}, second = {}] = node.getChildren(source).filter(({ kind = 0 }) => kind === getSyntaxKinds(typescript).SemicolonToken);
        const { end: start = 0 } = first;
        const end = second.getStart(source);

        return /^\s*$/u.test(code.slice(start, end)) ? [{ start, end, replacement: '' }] : [];
    });

    return applyEdits(code, [...edits, ...emptyLoopEdits]);
};

// Reconcile the printer's completed synthetic trivia before TypeScript erases
// declarations or inserts runtime statements. Only whitespace belonging to the
// exact statement occurrence is changed; authored-only identical pairs retain
// their original effective scopes.
const placeEmissionBoundaries = (code = '', typescript = {}, placedSource = {}) => {
    if (!getObject(placedSource).kind) return code;

    const { SingleLineCommentTrivia = -1, MultiLineCommentTrivia = -1 } = getSyntaxKinds(typescript);
    const { EmitFlags: { NoLeadingComments = 0 } = {} } = typescript;
    const boundaries = [];
    const counters = new Map();
    const collect = (node) => {
        const { kind: nodeKind = 0 } = getObject(node);
        const statement = typescript.isStatement(node);
        const index = counters.get(nodeKind) || 0;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private counter follows completed printer syntax before compiler insertion or erasure.
        if (statement) counters.set(nodeKind, index + 1);

        if (statement && typescript.getEmitFlags(node) & NoLeadingComments) {
            const comments = typescript.getSyntheticLeadingComments(node) || [];

            comments.slice(0, -1).forEach(({ kind = 0, text = '' }, commentIndex) => {
                const { kind: nextKind = 0, text: nextText = '' } = getObject(comments.at(commentIndex + 1));

                if (kind === MultiLineCommentTrivia && /^\s*eslint-disable-next-line\b/u.test(text) &&
                    [SingleLineCommentTrivia, MultiLineCommentTrivia].includes(nextKind) && /^\s*eslint-disable-next-line\b/u.test(nextText)) {
                    // eslint-disable-next-line resilient/prefer-safe-transformations -- Completed trivia and syntax occurrence select the generated boundary; authored-only pairs retain their scopes.
                    boundaries.push({ kind: nodeKind, index, generated: `/*${text}*/`,
                        authored: nextKind === MultiLineCommentTrivia ? `/*${nextText}*/` : `//${nextText}` });
                }
            });
        }

        typescript.forEachChild(node, collect);
    };

    collect(placedSource);

    if (!boundaries.length) return code;

    const { source = {}, nodes = [], commentPayloads = [] } = readSyntax(code, typescript,
        getObject(placedSource).scriptKind || getObject(getObject(typescript).ScriptKind).TS);
    const printedCounters = new Map();
    const owners = nodes.filter(node => typescript.isStatement(node)).map((node) => {
        const { kind = 0 } = getObject(node);
        const index = printedCounters.get(kind) || 0;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private printer counter follows the same completed statement traversal without changing AST metadata.
        printedCounters.set(kind, index + 1);

        return { kind, index, start: node.getStart(source), end: getObject(node).end };
    });
    const edits = commentPayloads.flatMap(({ start = 0, end = 0 }, commentIndex) => {
        const { start: nextStart = -1, end: nextEnd = -1 } = getObject(commentPayloads.at(commentIndex + 1));
        const matches = boundaries.some(({ kind = 0, index = -1, generated = '', authored = '' }) => owners.some(({ kind: ownerKind = 0, index: ownerIndex = -1, start: ownerStart = -1 }) => (
            ownerKind === kind && ownerIndex === index && ownerStart >= nextEnd &&
                /^\s*$/u.test(code.slice(nextEnd, ownerStart)))) &&
            code.slice(start, end).replace(/\n[ \t]*/gu, '\n') === generated.replace(/\n[ \t]*/gu, '\n') &&
            code.slice(nextStart, nextEnd) === authored);

        return matches && /^\s*\n\s*$/u.test(code.slice(end, nextStart))
            ? [{ start: end, end: nextStart, replacement: ' ' }] : [];
    });

    return applyEdits(code, edits);
};

// A generated disable-line already owns the complete emitted physical line.
// Move it ahead of that same line only after compiler emission; neither an
// expression boundary nor a compiler list may enlarge or shrink its coverage.
// Existing synthetic trivia supplies provenance. Authored-identical payloads,
// duplicated emission and lines beginning inside payloads remain untouched.
const placeInlineEmissionBoundaries = (code = '', typescript = {}, placedSource = {}) => {
    if (!getObject(placedSource).kind) return code;

    const completed = new Map();
    const collect = (node) => {
        (typescript.getSyntheticTrailingComments(node) || []).forEach(({ text = '' }) => {
            const [, names = '', reason = ''] = text.trim().match(/^eslint-disable-line\s+([^\n]+?)\s+--\s+(\S[^\n]*)$/u) || [];

            if (!names || !reason) return;

            const prior = completed.get(text.trim()) || { count: 0, rules: names.split(',').map(name => name.trim()), reason };
            // eslint-disable-next-line resilient/prefer-safe-transformations -- Private count admits only completed synthetic trivia with unchanged compiler emission multiplicity.
            completed.set(text.trim(), { ...prior, count: getObject(prior).count + 1 });
        });
        typescript.forEachChild(node, collect);
    };

    collect(placedSource);

    if (!completed.size) return code;

    const original = typescript.getOriginalNode(placedSource);
    const { text: authoredText = '', scriptKind = getObject(getObject(typescript).ScriptKind).TS } = getObject(original);
    const { commentPayloads: authored = [] } = readSyntax(authoredText, typescript, scriptKind);
    const { source = {}, tokens = [], commentPayloads = [], payloads = [], invalid = false } = readSyntax(code, typescript);
    const content = (text, { start = 0, end = 0 }) => text.slice(start + 2, end).replace(/\*\/$/u, '').trim();
    const eligible = [...completed].filter(([text = '', { count = 0 } = {}] = []) => (
        !authored.some(range => content(authoredText, range) === text) &&
        commentPayloads.filter(range => content(code, range) === text).length === count
    ));

    if (invalid || !eligible.length) return code;

    const lines = new Map();
    commentPayloads.forEach((range) => {
        const entry = eligible.find(([text = ''] = []) => text === content(code, range));

        if (!entry) return;

        const { start = 0, end = 0 } = range;
        const { line = 0 } = source.getLineAndCharacterOfPosition(start);

        if (source.getLineAndCharacterOfPosition(end).line !== line) return;

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private line group unions only already coincident emitted directive scopes.
        lines.set(line, [...lines.get(line) || [], { ...range, ...getObject(entry.at(1)) }]);
    });
    const wrap = (text, width) => text.split(/ +/u).reduce((parts, word) => {
        const last = parts.at(-1) || '';

        return last.length + word.length < width
            ? [...parts.slice(0, -1), `${last}${last ? ' ' : ''}${word}`] : [...parts, word];
    }, ['']).join('\n');
    const edits = [...lines].flatMap(([line = 0, entries = []] = []) => {
        const start = source.getPositionOfLineAndCharacter(line, 0);
        const next = code.indexOf('\n', start);
        const end = next < 0 ? code.length : next;
        const [indent = ''] = code.slice(start, end).match(/^ */u) || [];
        const preceding = commentPayloads.filter(range => /eslint-disable-next-line\b/u.test(content(code, range)) &&
            source.getLineAndCharacterOfPosition(getObject(range).end).line + 1 === line);
        const multilinePredecessor = preceding.some(range => source.getLineAndCharacterOfPosition(getObject(range).start).line !== line - 1);
        const sharedPredecessor = preceding.length && tokens.some(token => source.getLineAndCharacterOfPosition(token.getStart(source)).line === line - 1);
        const position = preceding.length ? source.getPositionOfLineAndCharacter(line - 1, 0) : start;
        const contributed = entries.flatMap(({ rules: names = [] }) => [...new Set(names)]);
        const conflicting = preceding.some((range) => {
            const { rules: names = [] } = readDirectiveComment(content(code, range));

            return !names.length || names.some(name => contributed.includes(name));
        });
        const earlierInline = commentPayloads.some((range) => {
            const { start: begin = 0, end: limit = 0 } = getObject(range);
            const { action = '', rules: names = [] } = readDirectiveComment(content(code, range));
            const sameLine = source.getLineAndCharacterOfPosition(begin).line === line;

            return sameLine && action === 'disable-line' &&
                entries.some(({ start: entryStart = 0, rules: namesOwned = [] }) => limit <= entryStart &&
                    (!names.length || names.some(name => namesOwned.includes(name))));
        });

        if (payloads.some(range => [start, position].some(offset => getObject(range).start < offset && getObject(range).end > offset)) || multilinePredecessor ||
            conflicting || earlierInline || sharedPredecessor || new Set(contributed).size !== contributed.length) return [];

        const rules = [...new Set(contributed)];
        const header = `/* eslint-disable-next-line ${rules.join(', ')} --`;

        if (indent.length + header.length > 200) return [];

        const reasons = [...new Set(entries.map(({ reason = '' }) => reason))];
        const explanation = reasons.join('; ');
        const directive = `eslint-disable-next-line ${rules.join(', ')} -- ${explanation}`;
        const block = preceding.length || indent.length + directive.length > 180;
        const replacement = block
            ? `${indent}${header}\n${wrap(explanation, Math.max(1, 180 - indent.length)).split('\n').map(text => indent + text).join('\n')}\n${indent}*/${preceding.length ? ' ' : '\n'}`
            : `${indent}// ${directive}\n`;

        return [{ start: position, end: position, replacement },
            ...entries.map(({ start: begin = 0, end: limit = 0 }) => {
                const [before = ''] = code.slice(start, begin).match(/ *$/u) || [];
                const [after = ''] = code.slice(limit, end).match(/^ */u) || [];

                return { start: begin - before.length, end: limit,
                    replacement: after.length || limit === end ? '' : ' ' };
            })];
    });

    return applyEdits(code, edits);
};

const formatResilientOutput = (code = '', typescript = {}, placedSource = {}) => {
    const { createLanguageService = false } = typescript;

    if (typeof createLanguageService !== 'function') return code;

    const { nodes = [], invalid = false } = readSyntax(code, typescript);

    if (invalid) return code;

    let result = placeEmissionBoundaries(code, typescript, placedSource);
    // Nested completed constructs can expose further layout on later passes.
    // Require a fixed point, including continuation alignment, before returning.
    // eslint-disable-next-line resilient/prefer-prototype-methods -- Each layout pass consumes its predecessor; the syntax-size bound rejects nonconvergence without returning partial layout.
    for (let pass = 0; pass <= nodes.length; pass += 1) {
        const next = alignDeclarationContinuations(formatWhitespace(layoutSyntax(result, typescript), typescript), typescript);
        const { invalid: invalidOutput = false } = readSyntax(next, typescript);

        if (invalidOutput) throw new Error('Emission layout produced invalid JavaScript.');

        if (next === result) return next;

        result = next;
    }

    throw new Error('Emission layout did not converge.');
};

export { formatResilientOutput, placeEmissionBoundaries, placeInlineEmissionBoundaries, readDirectiveComment };
