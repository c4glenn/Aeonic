import { useDraggable } from '@dnd-kit/core';
import { CalendarPlus, GripVertical, X } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ImportanceMark, TagChip, UrgencyMark } from '@/components/marks';
import type { Task } from '@todo/client';
import type { Urgency } from '@todo/domain';
import { cn } from '@/lib/utils';

interface Props {
  task: Task;
  urgency: Urgency | null | undefined;
  days: string[];
  today: string;
  /** Show the project name (week view). */
  projectName?: string;
  scheduled?: boolean;
  onOpen: (t: Task) => void;
  onPick: (t: Task, date: string) => void;
  onToggleDone: (t: Task) => void;
  onUnschedule?: (t: Task) => void;
}

const dayLabel = (d: string, today: string) =>
  d === today ? 'Today' : new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

export function TaskChip({ task, urgency, days, today, projectName, scheduled, onOpen, onPick, onToggleDone, onUnschedule }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, data: { task } });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group flex items-start gap-1.5 rounded-md border bg-secondary/60 px-1.5 py-1.5 text-sm transition-colors hover:bg-secondary',
        task.hardDue && 'border-l-[3px] border-l-hard',
        !task.hardDue && task.softDue && 'border-l-[3px] border-dashed border-l-soft',
        isDragging && 'opacity-40',
        task.done && 'opacity-60',
      )}
    >
      <button
        type="button"
        aria-label={`Drag ${task.title}`}
        className="-ml-0.5 mt-0.5 flex h-6 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        {...listeners}
        {...attributes}
      >
        <GripVertical className="size-4" />
      </button>
      <Checkbox
        checked={task.done}
        onCheckedChange={() => onToggleDone(task)}
        aria-label={`Mark ${task.title} done`}
        className="mt-1"
      />
      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
        <span className={cn('block break-words leading-snug', task.done && 'line-through')}>{task.title}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          {projectName && <span className="text-[11px] text-muted-foreground">{projectName}</span>}
          <ImportanceMark level={task.importance} />
          <UrgencyMark urgency={urgency} />
          {task.tags.map((t) => (
            <TagChip key={t} tag={t} />
          ))}
        </span>
      </button>
      {scheduled ? (
        onUnschedule && (
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Unschedule ${task.title}`} onClick={() => onUnschedule(task)}>
            <X className="size-4" />
          </Button>
        )
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Schedule ${task.title}`}>
              <CalendarPlus className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            <p className="px-2 py-1 text-xs text-muted-foreground">Schedule on…</p>
            {days.map((d) => (
              <PopoverClose key={d} date={d} label={dayLabel(d, today)} onPick={() => onPick(task, d)} />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function PopoverClose({ date, label, onPick }: { date: string; label: string; onPick: () => void }) {
  return (
    <PopoverPrimitive.Close asChild>
      <button type="button" onClick={onPick} className="flex min-h-11 w-full items-center justify-between rounded-sm px-2 text-left text-sm hover:bg-accent">
        {label}
        <span className="text-xs text-muted-foreground">{date.slice(5)}</span>
      </button>
    </PopoverPrimitive.Close>
  );
}
