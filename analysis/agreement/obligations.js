import { append, put, takeLast, retain } from './collections.js';
import { solve } from './dependencies.js';
import { visitFields } from './field-evidence.js';
import { factData, familyFacet } from './knowledge.js';
import { work } from './observation.js';
import { conjunction, familyOutcome } from './requirements.js';

// Decompose consumer requirements without redefining producer evidence.
const contentFacet = Object.freeze({ kind: 'content', key: 'content' });

// A field contribution may serve several owners or requirements in one request.
// Share traversal only when the child obligation and absence policy both match.
const fieldVisits = (fields, required, optional) => {
    if (!fields) return new Set();

    const policies = fields.get(required) || put(fields, required, new Map());

    return policies.get(optional) || put(policies, optional, new Set());
};

const requirementPlan = ({ owner = false, required = {}, observation = {}, fields = false } = {}) => {
    const { kind = '', name = '', requirements = [], required: child = false, optional = false } = required;

    if (kind === 'all') {
        work(observation, 'requirement-expansion');

        return { tasks: requirements.map(item => ({ owner, required: item })), outcomes: [], facts: [] };
    }

    const familyFact = solve({ owner, facet: familyFacet, observation });
    const familyData = factData(familyFact);
    const expectedFamily = kind === 'field' ? 'object' : name;
    const agreement = familyOutcome(familyData, expectedFamily);

    if (kind === 'family' || agreement === 'contradiction') return { tasks: [], outcomes: [agreement], facts: [familyFact] };

    if (kind === 'content') {
        const contentFact = solve({ owner, facet: contentFacet, observation });
        const { observations = [], incomplete = false } = factData(contentFact);
        const outcomes = observations.map(({ family: actual = '', nonempty = false } = {}) => actual === name && nonempty ? 'agreement' : 'contradiction');

        return { tasks: [], outcomes: [agreement, ...outcomes, ...(incomplete ? ['unknown'] : [])], facts: [familyFact, contentFact] };
    }

    const fieldFact = solve({ owner, facet: { kind: 'field', key: `field:${name}`, name }, observation });
    const absence = optional ? 'agreement' : 'contradiction';
    const tasks = [];
    const outcomes = [agreement];

    visitFields({ data: factData(fieldFact), visited: fieldVisits(fields, child, optional), observation },
        ({ state = '', owner: target = false } = {}) => {
            if (state === 'present') {
                append(tasks, { owner: target, required: child });

                return;
            }

            append(outcomes, state === 'absent' ? absence : 'unknown');
        });

    return { tasks, outcomes, facts: [familyFact, fieldFact] };
};

export const evaluate = ({ owner = false, required = {}, observation = {} } = {}) => {
    const first = requirementPlan({ owner, required, observation });

    const { tasks = [], outcomes: initialOutcomes = [], facts: initialFacts = [] } = first;

    if (!tasks.length) return { outcome: conjunction(initialOutcomes), facts: initialFacts };

    const pending = tasks.toReversed();
    const outcomes = new Set(initialOutcomes);
    const facts = new Set(initialFacts);
    const evaluated = new Map([[owner, new Set([required])]]);
    const fields = new Map();

    // eslint-disable-next-line resilient/prefer-prototype-methods -- A private worklist composes deep conjunctions without recursion or copying every ancestor's facts.
    while (pending.length) {
        const task = takeLast(pending);
        const { owner: source = false, required: requirement = false } = task;
        const requirements = evaluated.get(source) || put(evaluated, source, new Set());

        if (requirements.has(requirement)) continue;

        retain(requirements, requirement);

        const { outcomes: nextOutcomes = [], facts: nextFacts = [], tasks: nextTasks = [] } = requirementPlan({ ...task, observation, fields });

        nextOutcomes.forEach(outcome => retain(outcomes, outcome));
        nextFacts.forEach(fact => retain(facts, fact));
        nextTasks.toReversed().forEach(child => append(pending, child));
    }

    return { outcome: conjunction([...outcomes]), facts: [...facts] };
};
