import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProjectList, computeReorder } from './ProjectList';
import type { ProjectDTO } from '../../api/types';

function proj(id: string, name: string, order: number): ProjectDTO {
  return { id, name, priorityOrder: order, isDefault: false, color: null, taskCount: 0, createdAt: '' };
}

const three = [proj('p1', 'Work', 1), proj('p2', 'Home', 2), proj('p3', 'Gym', 3)];

describe('ProjectList', () => {
  it('renders the real projects in order with drag handles', () => {
    render(
      <ProjectList
        projects={three.slice(0, 2)}
        onReorder={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByLabelText('Reorder Work')).toBeInTheDocument();
  });
});

describe('computeReorder', () => {
  it('moves an item down to the drop target position', () => {
    // Drag Work (p1) onto Home (p2): Home leads, then Work, then Gym.
    expect(computeReorder(three, 'p1', 'p2')).toEqual(['p2', 'p1', 'p3']);
  });

  it('moves an item up to the drop target position', () => {
    // Drag Gym (p3) onto Work (p1): Gym first.
    expect(computeReorder(three, 'p3', 'p1')).toEqual(['p3', 'p1', 'p2']);
  });

  it('returns null for a no-op (same id) or unknown ids', () => {
    expect(computeReorder(three, 'p1', 'p1')).toBeNull();
    expect(computeReorder(three, 'p1', 'nope')).toBeNull();
  });
});
