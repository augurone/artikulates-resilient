export const captureJob = (input: { value: number; other: number }) => {
    const { value, ...rest } = input;

    return [input.value, value, rest];
};
