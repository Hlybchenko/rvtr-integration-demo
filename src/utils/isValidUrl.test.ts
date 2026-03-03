import { describe, it, expect } from 'vitest';
import { isValidUrl } from './isValidUrl';

describe('isValidUrl', () => {
  it.each([
    { input: '', expected: false, label: 'empty string' },
    { input: '   ', expected: false, label: 'whitespace only' },
    { input: 'http://localhost:8080', expected: true, label: 'valid http' },
    { input: 'https://example.com/path', expected: true, label: 'valid https' },
    { input: 'example.com', expected: false, label: 'no protocol' },
    { input: '/some/path', expected: false, label: 'relative path' },
    { input: 'ws://localhost:8888', expected: true, label: 'ws:// protocol' },
    { input: 'http://192.168.1.1:3210/api', expected: true, label: 'with port and path' },
  ])('returns $expected for $label ("$input")', ({ input, expected }) => {
    expect(isValidUrl(input)).toBe(expected);
  });
});
