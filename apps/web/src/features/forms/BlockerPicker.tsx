import { useState } from 'react';
import { CalendarCheck, Check, Lock, Plus, X } from 'lucide-react';
import type { Project, Task } from '@aeonic/client';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Props {
  /** Tasks that may be picked (callers exclude the task itself and anything downstream of it). */
  candidates: Task[];
  /** Everything, to resolve already-selected ids (including done ones) back to titles. */
  taskById: ReadonlyMap<string, Task>;
  projectById: ReadonlyMap<string, Project>;
  value: string[];
  onChange: (ids: string[]) => void;
}

/** A blocker's state in words (never color alone). */
function status(t: Task | undefined): { text: string; icon: typeof Lock } {
  if (!t) return { text: 'deleted', icon: X };
  if (t.done) return { text: 'done', icon: Check };
  if (t.scheduledDate) return { text: 'scheduled', icon: CalendarCheck };
  return { text: 'not scheduled yet', icon: Lock };
}

/**
 * Pick any number of blockers — from any project. Selected blockers are listed as removable rows with
 * their state; a task unlocks only once ALL of them are scheduled or done.
 */
export function BlockerPicker({ candidates, taskById, projectById, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  const groups = new Map<string, Task[]>();
  for (const t of candidates) {
    if (selected.has(t.id)) continue;
    groups.set(t.projectId, [...(groups.get(t.projectId) ?? []), t]);
  }

  const pending = value.filter((id) => {
    const t = taskById.get(id);
    return t && !t.done && !t.scheduledDate;
  }).length;

  return (
    <div className="flex flex-col gap-2" data-testid="blocker-picker">
      {value.length > 0 && (
        <>
          <ul className="flex flex-col gap-1" aria-label="Blocked by">
            {value.map((id) => {
              const t = taskById.get(id);
              const s = status(t);
              const Icon = s.icon;
              return (
                <li key={id} className="flex items-center gap-2 rounded-md border bg-muted px-2 py-1 text-sm" data-blocker={id}>
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t?.title ?? 'Deleted task'}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {t ? projectById.get(t.projectId)?.name : ''} · {s.text}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    aria-label={`Remove blocker ${t?.title ?? 'deleted task'}`}
                    onClick={() => onChange(value.filter((x) => x !== id))}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className={cn('text-xs', pending ? 'text-muted-foreground' : 'text-foreground')} data-testid="blocker-summary">
            {pending === 0
              ? 'Every blocker is scheduled or done — this task is available.'
              : `Locked — ${pending} of ${value.length} blocker${value.length === 1 ? ' is' : 's are'} not scheduled yet.`}
          </p>
        </>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="h-11 justify-start gap-2 font-normal text-muted-foreground">
            <Plus className="size-4" />
            {value.length ? 'Add another blocker…' : 'Add a blocker… (none — available now)'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
          {/* plain substring match — cmdk's default fuzzy scoring surfaces unrelated tasks */}
          <Command filter={(v, q) => (v.toLowerCase().includes(q.trim().toLowerCase()) ? 1 : 0)}>
            <CommandInput placeholder="Search tasks in any project…" />
            <CommandList>
              <CommandEmpty>No tasks to add</CommandEmpty>
              {[...groups].map(([projectId, tasks]) => (
                <CommandGroup key={projectId} heading={projectById.get(projectId)?.name ?? 'Project'}>
                  {tasks.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${projectById.get(projectId)?.name ?? ''} ${t.title} ${t.id}`}
                      onSelect={() => {
                        onChange([...value, t.id]);
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{status(t).text}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
