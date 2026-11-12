import { useDraggable } from '@dnd-kit/core';
import type { Task } from '@todo/client';
import { cn } from '@/lib/utils';

/** Compact draggable task label for dense grids (month view). */
export function MiniChip({ task, project, onOpen }: { task: Task; project?: string; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onOpen(task)}
      title={project ? `${task.title} — ${project}` : task.title}
      className={cn(
        'block w-full touch-none truncate rounded-sm border bg-secondary px-1.5 py-0.5 text-left text-[11px] leading-4 hover:bg-accent',
        task.hardDue && 'border-l-[3px] border-l-hard',
        !task.hardDue && task.softDue && 'border-l-[3px] border-dashed border-l-soft',
        isDragging && 'opacity-40',
      )}
      {...listeners}
      {...attributes}
    >
      {task.title}
    </button>
  );
}
