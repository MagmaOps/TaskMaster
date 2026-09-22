import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ProjectDTO } from '../../api/types';
import { ProjectRow } from './ProjectRow';

/**
 * Pure reorder computation: given the current order and a drag from `activeId`
 * to `overId`, return the new ordered id list, or null if it's a no-op.
 * Exported for deterministic testing (jsdom lacks layout for dnd-kit sensors).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function computeReorder(
  order: ProjectDTO[],
  activeId: string,
  overId: string,
): string[] | null {
  if (activeId === overId) return null;
  const oldIndex = order.findIndex((p) => p.id === activeId);
  const newIndex = order.findIndex((p) => p.id === overId);
  if (oldIndex === -1 || newIndex === -1) return null;
  return arrayMove(order, oldIndex, newIndex).map((p) => p.id);
}

interface ProjectListProps {
  /** Real (non-default) projects, in current order. */
  projects: ProjectDTO[];
  onReorder: (orderedRealIds: string[]) => Promise<void>;
  onEdit: (project: ProjectDTO) => void;
  onDelete: (project: ProjectDTO) => void;
}

/**
 * Sortable list of real projects. Keeps a local optimistic order for a smooth
 * drag; on reorder failure the parent's promise rejects and we revert to the
 * incoming server order.
 */
export function ProjectList({ projects, onReorder, onEdit, onDelete }: ProjectListProps) {
  const [order, setOrder] = useState<ProjectDTO[]>(projects);

  // Keep the local order in sync when the server list changes (load, revert, edit).
  useEffect(() => {
    setOrder(projects);
  }, [projects]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const nextIds = computeReorder(order, String(active.id), String(over.id));
    if (!nextIds) return;

    const previous = order;
    const next = nextIds.map((id) => order.find((p) => p.id === id)!);
    setOrder(next); // optimistic
    void onReorder(nextIds).catch(() => {
      setOrder(previous); // revert on failure (parent also re-fetches)
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div>
          {order.map((project) => (
            <ProjectRow key={project.id} project={project} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
