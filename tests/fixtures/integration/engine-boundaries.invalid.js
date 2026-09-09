const updateInput = (state = {}) => {
    state.count += 1;

    return state;
};

const updateResponse = async (resp) => {
    const response = await resp.json();
    response.fields.red = 'blue';

    return response;
};

const collect = (items = []) => {
    const result = [];

    items.forEach(item => result.push(item));

    return result;
};

const collectWithSwitch = (items = []) => {
    const result = [];

    for (const item of items) {
        switch (item.kind) {
            case 'done':
                break;
            default:
                result.push(item);
        }
    }

    return result;
};

const map = new Map();
map.get('key').add('value');
const getTarget = () => ({ count: 0 });
getTarget().count = 1;
getTarget().count++;
delete getTarget().count;
Object.assign(getTarget(), { count: 2 });

void [updateInput, updateResponse, collect, collectWithSwitch];
