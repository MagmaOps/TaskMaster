import { describe, it, expect } from 'vitest';
import { PALETTE, randomPaletteColor } from './projectColor';

describe('projectColor', () => {
  it('has a non-empty palette of hex colors', () => {
    expect(PALETTE.length).toBeGreaterThan(0);
    PALETTE.forEach((c) => expect(c).toMatch(/^#[0-9a-fA-F]{6}$/));
  });

  it('randomPaletteColor returns a palette member', () => {
    for (let i = 0; i < 20; i++) {
      expect(PALETTE).toContain(randomPaletteColor());
    }
  });
});
