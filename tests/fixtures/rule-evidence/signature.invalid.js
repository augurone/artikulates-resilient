export const separateInputs = input => {
    const { first = '' } = input;
    const read = input => {
        const { later = '' } = input;

        return later;
    };

    return [first, read];
};
