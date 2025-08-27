export const JS_SOLUTION_OK = `// LANG: js
module.exports = {
  add: (a,b) => a + b,
  sum: (arr) => arr.reduce((s,x) => s + x, 0)
};`;

export const JS_TESTS_OK = `// LANG: js
describe('math', () => {
  test('add works', () => { expect(add(1, 2)).toBe(3); });
  test('sum works', () => { expect(sum([1,2,3])).toEqual(6); });
});`;

export const JS_TESTS_FAIL = `// LANG: js
describe('math failing', () => {
  test('intentional fail', () => { expect(add(1, 1)).toBe(3); });
});`;
