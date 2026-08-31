const externalSource = async () => unknownSource;

const normalize = raw => Array.isArray(raw) ? raw : [];
const render = (items = []) => items.map(Boolean);

const run = async () => {
    const raw = await externalSource();
    const normalized = normalize(raw);
    return render(normalized);
};

run;
