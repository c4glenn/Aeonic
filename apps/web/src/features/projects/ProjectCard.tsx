import { ChevronDown, Lock, Pencil, Plus } from 'lucide-react';
import type { Project, Task } from '@aeonic/client';
import { Button } from '@/components/ui/button';
import { ImportanceMark, LockMark, TagChip } from '@/components/marks';
import { TaskChip } from '@/features/week/TaskChip';
import type { Board } from '@/lib/board';

interface Props {
  project: Project;
  board: Board;
  tasks: Task[];
  onOpen: (t: Task) => void;
  onPick: (t: Task, date: string) => void;
  onToggleDone: (t: Task) => void;
  onAddTask: (projectId: string) => void;
  onEdit: (p: Project) => void;
}

export function ProjectCard({ project, board, tasks, onOpen, onPick, onToggleDone, onAddTask, onEdit }: Props) {
  const available = tasks.filter((t) => !t.done && !t.scheduledDate && board.unblocked(t));
  const locked = tasks.filter((t) => !t.done && !t.scheduledDate && !board.unblocked(t));
  const scheduled = tasks.filter((t) => !t.done && t.scheduledDate);
  const done = tasks.filter((t) => t.done);
  const chip = (t: Task, scheduledChip = false) => (
    <li key={t.id}>
      <TaskChip
        task={t}
        scheduled={scheduledChip}
        urgency={board.urgencies.get(t.id)}
        days={board.days}
        today={board.today}
        onOpen={onOpen}
        onPick={onPick}
        onToggleDone={onToggleDone}
      />
    </li>
  );

  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold leading-tight">{project.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <ImportanceMark level={project.importance} withLabel />
            {project.tags.map((t) => (
              <TagChip key={t} tag={t} />
            ))}
          </div>
          {project.description && <p className="mt-1.5 text-xs text-muted-foreground">{project.description}</p>}
        </div>
        <div className="flex shrink-0">
          <Button variant="ghost" size="icon" className="size-9" aria-label={`Edit ${project.name}`} onClick={() => onEdit(project)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="secondary" size="icon" className="size-9" aria-label={`Add subtask to ${project.name}`} onClick={() => onAddTask(project.id)}>
            <Plus className="size-4" />
          </Button>
        </div>
      </header>

      <ul className="flex flex-col gap-1.5">
        {available.map((t) => chip(t))}
        {!available.length && (
          <li className="rounded-md border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
            {tasks.length ? 'Nothing available right now' : 'No subtasks yet'}
          </li>
        )}
      </ul>

      {scheduled.length > 0 && (
        <Group label={`Scheduled (${scheduled.length})`}>
          {scheduled.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm text-muted-foreground">
              <button type="button" className="min-w-0 truncate text-left hover:text-foreground" onClick={() => onOpen(t)}>
                {t.title}
              </button>
              <span className="shrink-0 text-xs tabular-nums">{t.scheduledDate?.slice(5)}</span>
            </li>
          ))}
        </Group>
      )}

      {locked.length > 0 && (
        <Group label={`Locked (${locked.length})`} icon={<Lock className="size-3.5" aria-hidden />}>
          {locked.map((t) => (
            <li key={t.id} className="rounded-md border border-dashed px-2 py-1.5 text-sm">
              <button type="button" className="block w-full text-left" onClick={() => onOpen(t)}>
                <span className="block break-words">{t.title}</span>
                <LockMark names={board.blockerTitles(t)} total={t.blockedBy.length} />
              </button>
            </li>
          ))}
        </Group>
      )}

      {done.length > 0 && (
        <Group label={`Done (${done.length})`}>{done.map((t) => chip(t))}</Group>
      )}
    </article>
  );
}

function Group({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <details className="group/details">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className="size-3.5 transition-transform group-open/details:rotate-180" aria-hidden />
        {icon}
        {label}
      </summary>
      <ul className="mt-1 flex flex-col gap-1.5">{children}</ul>
    </details>
  );
}
