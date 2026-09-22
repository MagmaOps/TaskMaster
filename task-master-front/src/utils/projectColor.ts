/** Shared project color palette. Single source for the project form + tag input. */
export const PALETTE: readonly string[] = [
  '#4f46e5',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#8b5cf6',
  '#64748b',
];

/** Pick a random color from the palette (used when creating a project inline). */
export function randomPaletteColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}
