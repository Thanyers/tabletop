import { describe, expect, it } from 'vitest';
import { validateProductionOrigin } from './start.js';

describe('production origin configuration', () => {
  it('requires an HTTPS origin without credentials or an extra path', () => {
    expect(validateProductionOrigin('https://tabletop.example')).toBe('https://tabletop.example');
    expect(() => validateProductionOrigin('http://tabletop.example')).toThrow('PRODUCTION_ORIGIN_MUST_BE_HTTPS_ORIGIN');
    expect(() => validateProductionOrigin('https://user:secret@tabletop.example')).toThrow('PRODUCTION_ORIGIN_MUST_BE_HTTPS_ORIGIN');
    expect(() => validateProductionOrigin('https://tabletop.example/app')).toThrow('PRODUCTION_ORIGIN_MUST_BE_HTTPS_ORIGIN');
  });
});
