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

void [updateInput, updateResponse, collect, collectWithSwitch];
