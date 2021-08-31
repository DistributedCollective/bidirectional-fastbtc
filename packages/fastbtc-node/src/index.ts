function main(foo: number) {
    console.log(`Hello ${foo + 1}`);
}

export default main;

if (require.main == module) {
    main(1336);
}
