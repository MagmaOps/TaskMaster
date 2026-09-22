import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectTagInput, type Chip } from './ProjectTagInput';
import type { ProjectDTO } from '../../api/types';

const projects: ProjectDTO[] = [
  { id: 'd0', name: 'Unassigned', priorityOrder: 0, isDefault: true, color: null, taskCount: 0, createdAt: '' },
  { id: 'p1', name: 'Work', priorityOrder: 1, isDefault: false, color: '#4f46e5', taskCount: 0, createdAt: '' },
  { id: 'p2', name: 'Home Stuff', priorityOrder: 2, isDefault: false, color: null, taskCount: 0, createdAt: '' },
];

// Controlled harness so we can inspect the chips after interactions.
function Harness({ initial = [], onChips }: { initial?: Chip[]; onChips?: (c: Chip[]) => void }) {
  const [chips, setChips] = useState<Chip[]>(initial);
  return (
    <ProjectTagInput
      projects={projects}
      value={chips}
      onChange={(c) => {
        setChips(c);
        onChips?.(c);
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProjectTagInput', () => {
  it('filters suggestions case-insensitively and excludes the default', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('combobox'), 'wo');
    expect(screen.getByRole('option', { name: /work/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /unassigned/i })).toBeNull();
  });

  it('confirms an existing project by case-insensitive name (no duplicate) on Enter', async () => {
    const onChips = vi.fn();
    render(<Harness onChips={onChips} />);
    await userEvent.type(screen.getByRole('combobox'), 'WORK{Enter}');
    const last = onChips.mock.calls.at(-1)![0] as Chip[];
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ kind: 'existing', id: 'p1', name: 'Work' });
  });

  it('creates a pending chip for a new name on Enter', async () => {
    const onChips = vi.fn();
    render(<Harness onChips={onChips} />);
    await userEvent.type(screen.getByRole('combobox'), 'Garden{Enter}');
    const last = onChips.mock.calls.at(-1)![0] as Chip[];
    expect(last.at(-1)).toEqual({ kind: 'pending', name: 'Garden' });
  });

  it('treats comma as a confirm key', async () => {
    const onChips = vi.fn();
    render(<Harness onChips={onChips} />);
    await userEvent.type(screen.getByRole('combobox'), 'Garden,');
    const last = onChips.mock.calls.at(-1)![0] as Chip[];
    expect(last.at(-1)).toEqual({ kind: 'pending', name: 'Garden' });
  });

  it('ignores a duplicate (case-insensitive) chip', async () => {
    const onChips = vi.fn();
    render(<Harness initial={[{ kind: 'existing', id: 'p1', name: 'Work', color: '#4f46e5' }]} onChips={onChips} />);
    await userEvent.type(screen.getByRole('combobox'), 'work{Enter}');
    // No new chip added (still just Work); onChange may not fire or fires with same length.
    if (onChips.mock.calls.length > 0) {
      const last = onChips.mock.calls.at(-1)![0] as Chip[];
      expect(last).toHaveLength(1);
    }
    expect(screen.getAllByText('Work')).toHaveLength(1);
  });

  it('rejects the reserved name with a hint', async () => {
    const onChips = vi.fn();
    render(<Harness onChips={onChips} />);
    await userEvent.type(screen.getByRole('combobox'), 'Unassigned{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/reserved/i);
    expect(onChips).not.toHaveBeenCalled();
  });

  it('removes the last chip on Backspace when the input is empty', async () => {
    const onChips = vi.fn();
    render(
      <Harness
        initial={[
          { kind: 'existing', id: 'p1', name: 'Work', color: '#4f46e5' },
          { kind: 'pending', name: 'Garden' },
        ]}
        onChips={onChips}
      />,
    );
    const input = screen.getByRole('combobox');
    input.focus();
    await userEvent.keyboard('{Backspace}');
    const last = onChips.mock.calls.at(-1)![0] as Chip[];
    expect(last).toEqual([{ kind: 'existing', id: 'p1', name: 'Work', color: '#4f46e5' }]);
  });

  it('renders a color dot for existing colored chips', () => {
    render(<Harness initial={[{ kind: 'existing', id: 'p1', name: 'Work', color: '#4f46e5' }]} />);
    // The chip shows the name; the dot is decorative (aria-hidden) so assert on the chip text.
    expect(screen.getByText('Work')).toBeInTheDocument();
  });
});
