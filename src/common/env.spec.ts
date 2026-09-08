import { envInt, envList } from './env';

describe('envInt', () => {
  it('parses a positive integer', () => {
    expect(envInt('42', 7)).toBe(42);
  });

  it('falls back when the variable is unset or empty', () => {
    expect(envInt(undefined, 7)).toBe(7);
    expect(envInt('', 7)).toBe(7);
  });

  it('falls back on a non-numeric value', () => {
    expect(envInt('many', 7)).toBe(7);
  });

  it('falls back on zero and negatives, which are meaningless for every knob', () => {
    expect(envInt('0', 7)).toBe(7);
    expect(envInt('-3', 7)).toBe(7);
  });

  it('truncates a decimal rather than rejecting it', () => {
    expect(envInt('12.9', 7)).toBe(12);
  });
});

describe('envList', () => {
  it('splits on commas and trims', () => {
    expect(envList('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list when unset or empty', () => {
    expect(envList(undefined)).toEqual([]);
    expect(envList('')).toEqual([]);
    expect(envList('  ')).toEqual([]);
  });

  it('drops empty entries from stray commas', () => {
    expect(envList('a,,b,')).toEqual(['a', 'b']);
  });
});
