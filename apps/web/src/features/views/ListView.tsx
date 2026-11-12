import { Fragment, useState } from 'react';
import { CalendarDays, CalendarPlus, Lock, X } from 'lucide-react';
import { addDays, timeToMinutes } from '@aeonic/domain';
import type { Task } from '@aeonic/client';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DueMark, ImportanceMark, LockMark, TagChip, UrgencyMark } from '@/components/marks';
import type { Board } from '@/lib/board';
import { fmtLong, fmtShort, toISODate } from '@/lib/dates';
import { useCalendarEvents } from '@/lib/api';
import { calendarColor, fmtClock, segmentsFor } from '@/lib/events';
import { cn } from '@/lib/utils';

interface Handlers {
  onOpen: (t: Task) => void;
  onPick: (t: Task, date: string) => void;
  onToggleDone: (t: Task) => void;
  onUnschedule: (t: Task) => void;
}

function ScheduleCell({ task, locked, onPick, onUnschedule }: { task: Task; locked: boolean; onPick: Handlers['onPick']; onUnschedule: Handlers['onUnschedule'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-1">
      {task.scheduledDate ? (
        <>
          <span className="text-sm tabular-nums">
            {fmtShort(task.scheduledDate)}
            {task.startTime && <span className="text-muted-foreground"> · {fmtClock(timeToMinutes(task.startTime))}</span>}
          </span>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Unschedule ${task.title}`} onClick={() => onUnschedule(task)}>
            <X className="size-4" />
          </Button>
        </>
      ) : locked ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden /> Locked
        </span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" aria-label={`Schedule ${task.title}`}>
              <CalendarPlus className="size-4" /> Schedule
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              mode="single"
              onSelect={(d) => {
                if (d) {
                  setOpen(false);
                  onPick(task, toISODate(d));
                }
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function ListView({ board, sort, ...h }: { board: Board; sort: 'urgency' | 'importance' } & Handlers) {
  const [group, setGroup] = useState<'flat' | 'project'>('flat');
  const rows = board.visible;
  const horizon = addDays(board.today, 13);
  const events = useCalendarEvents(board.today, horizon);
  const upcoming = Array.from({ length: 14 }, (_, i) => addDays(board.today, i))
    .map((date) => ({ date, segs: segmentsFor(events, date) }))
    .filter((d) => d.segs.length);

  const renderRow = (t: Task) => {
    const locked = !board.unblocked(t) && !t.done;
    const project = board.projectById.get(t.projectId);
    return (
      <TableRow key={t.id} data-task={t.id} className={cn(t.done && 'opacity-60')}>
        <TableCell className="w-10 pr-0 align-top">
          <Checkbox checked={t.done} onCheckedChange={() => h.onToggleDone(t)} aria-label={`Mark ${t.title} done`} className="mt-1" />
        </TableCell>
        <TableCell className="whitespace-normal align-top">
          <button type="button" onClick={() => h.onOpen(t)} className={cn('block text-left font-medium hover:underline', t.done && 'line-through')}>
            {t.title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 md:hidden">
            <span className="text-xs text-muted-foreground">{project?.name}</span>
            <ImportanceMark level={t.importance} />
            <UrgencyMark urgency={board.urgencies.get(t.id)} />
          </div>
          {locked && <div className="mt-1"><LockMark names={board.blockerTitles(t)} total={t.blockedBy.length} /></div>}
          {t.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1 lg:hidden">
              {t.tags.map((tag) => <TagChip key={tag} tag={tag} />)}
            </div>
          )}
        </TableCell>
        {group === 'flat' && <TableCell className="hidden align-top text-sm md:table-cell">{project?.name}</TableCell>}
        <TableCell className="hidden align-top md:table-cell"><ImportanceMark level={t.importance} withLabel /></TableCell>
        <TableCell className="align-top">
          <div className="flex flex-col items-start gap-1">
            <UrgencyMark urgency={board.urgencies.get(t.id)} className="hidden md:inline-flex" />
            {t.hardDue && <DueMark kind="hard" date={t.hardDue} />}
            {t.softDue && <DueMark kind="soft" date={t.softDue} />}
            {!t.hardDue && !t.softDue && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </TableCell>
        <TableCell className="align-top">
          <ScheduleCell task={t} locked={locked} onPick={h.onPick} onUnschedule={h.onUnschedule} />
        </TableCell>
        <TableCell className="hidden align-top lg:table-cell">
          <div className="flex flex-wrap gap-1">{t.tags.map((tag) => <TagChip key={tag} tag={tag} />)}</div>
        </TableCell>
      </TableRow>
    );
  };

  const colSpan = group === 'flat' ? 7 : 6;
  const byProject = board.projects
    .map((p) => ({ project: p, tasks: rows.filter((t) => t.projectId === p.id) }))
    .filter((g) => g.tasks.length);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} task{rows.length === 1 ? '' : 's'} · sorted by {sort}
        </p>
        <ToggleGroup type="single" variant="outline" value={group} onValueChange={(v) => v && setGroup(v as 'flat' | 'project')} aria-label="Group by">
          <ToggleGroupItem value="flat" className="h-9 px-3">Flat</ToggleGroupItem>
          <ToggleGroupItem value="project" className="h-9 px-3">By project</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><span className="sr-only">Done</span></TableHead>
              <TableHead>Task</TableHead>
              {group === 'flat' && <TableHead className="hidden md:table-cell">Project</TableHead>}
              <TableHead className="hidden md:table-cell">Importance</TableHead>
              <TableHead>Due</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead className="hidden lg:table-cell">Tags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={colSpan} className="py-10 text-center text-muted-foreground">No tasks match the current filters.</TableCell>
              </TableRow>
            )}
            {group === 'flat'
              ? rows.map(renderRow)
              : byProject.map((g) => (
                  <Fragment key={g.project.id}>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableCell colSpan={colSpan} className="font-display font-semibold">
                        {g.project.name} <span className="font-sans text-xs font-normal text-muted-foreground">({g.tasks.length})</span>
                      </TableCell>
                    </TableRow>
                    {g.tasks.map(renderRow)}
                  </Fragment>
                ))}
          </TableBody>
        </Table>
      </div>

      {upcoming.length > 0 && (
        <section className="rounded-xl border bg-card p-3" aria-label="Upcoming calendar events">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-lg font-semibold">
            <CalendarDays className="size-4" aria-hidden /> Calendar events <span className="font-sans text-xs font-normal text-muted-foreground">next 14 days</span>
          </h2>
          <div className="flex flex-col gap-3">
            {upcoming.map(({ date, segs }) => (
              <div key={date}>
                <h3 className="mb-1 font-sans text-xs font-medium text-muted-foreground">{date === board.today ? 'Today · ' : ''}{fmtLong(date)}</h3>
                <ul className="flex flex-col gap-1">
                  {segs.map((sg) => (
                    <li
                      key={`${sg.event.id}-${date}`}
                      className="event-surface flex flex-wrap items-baseline gap-x-3 rounded-sm px-2 py-1 text-sm"
                      style={{ ['--cal' as string]: calendarColor(sg.event.color) }}
                    >
                      <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {sg.allDay ? 'All day' : `${fmtClock(sg.startMin)} – ${fmtClock(sg.endMin)}`}
                      </span>
                      <span className="min-w-0 flex-1 break-words">{sg.event.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {sg.event.calendarName}
                        {sg.event.location ? ` · ${sg.event.location}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
