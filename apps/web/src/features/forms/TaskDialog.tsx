import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { dependentsMap, transitiveDependents } from '@todo/domain';
import type { Task } from '@todo/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Board } from '@/lib/board';
import { useCreateTask, useDeleteTask, useScheduleTask, useSetDependencies, useUnscheduleTask, useUpdateTask } from '@/lib/mutations';
import { ImportancePicker, MultiSelect, TagInput } from './fields';

export type TaskDialogState = { mode: 'create'; projectId: string } | { mode: 'edit'; task: Task } | null;

interface Form {
  title: string;
  projectId: string;
  importance: number;
  hardDue: string;
  softDue: string;
  scheduledDate: string;
  tags: string[];
  blockedBy: string[];
}

function initial(state: NonNullable<TaskDialogState>): Form {
  if (state.mode === 'edit') {
    const t = state.task;
    return {
      title: t.title, projectId: t.projectId, importance: t.importance,
      hardDue: t.hardDue ?? '', softDue: t.softDue ?? '', scheduledDate: t.scheduledDate ?? '', tags: t.tags, blockedBy: t.blockedBy,
    };
  }
  return { title: '', projectId: state.projectId, importance: 2, hardDue: '', softDue: '', scheduledDate: '', tags: [], blockedBy: [] };
}

export function TaskDialog({ state, board, onClose }: { state: TaskDialogState; board: Board; onClose: () => void }) {
  const [f, setF] = useState<Form | null>(null);
  const create = useCreateTask();
  const update = useUpdateTask();
  const del = useDeleteTask();
  const setDeps = useSetDependencies();
  const schedule = useScheduleTask();
  const unschedule = useUnscheduleTask();

  useEffect(() => setF(state ? initial(state) : null), [state]);
  if (!state || !f) return <Dialog open={false} />;

  const editing = state.mode === 'edit' ? state.task : null;
  // Exclude the task itself and anything downstream of it so cycles can't be picked.
  const banned = new Set<string>();
  if (editing) {
    banned.add(editing.id);
    for (const id of transitiveDependents(editing.id, dependentsMap([...board.taskById.values()]))) banned.add(id);
  }
  const blockerOptions = [...board.taskById.values()]
    .filter((t) => !banned.has(t.id) && !t.done && t.projectId === f.projectId)
    .map((t) => ({ id: t.id, label: t.title }));

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const common = {
      title: f.title.trim(), importance: f.importance, tags: f.tags,
      hardDue: f.hardDue || null, softDue: f.softDue || null,
    };
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, patch: { ...common, projectId: f.projectId } });
        if (f.blockedBy.join() !== editing.blockedBy.join()) await setDeps.mutateAsync({ id: editing.id, blockedBy: f.blockedBy });
        if (f.scheduledDate !== (editing.scheduledDate ?? '')) {
          if (f.scheduledDate) await schedule.mutateAsync({ id: editing.id, date: f.scheduledDate });
          else await unschedule.mutateAsync(editing.id);
        }
      } else {
        await create.mutateAsync({ ...common, projectId: f.projectId, blockedBy: f.blockedBy });
      }
      onClose();
    } catch {
      /* mutation hooks already toasted the error; keep the dialog open */
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit subtask' : 'New subtask'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" autoFocus required maxLength={300} value={f.title} onChange={(e) => set('title', e.target.value)} className="h-11" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Project</Label>
            <Select value={f.projectId} onValueChange={(v) => setF({ ...f, projectId: v, blockedBy: [] })}>
              <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {board.projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Importance</Label>
            <ImportancePicker value={f.importance} onChange={(n) => set('importance', n)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-hard">Hard due (deadline)</Label>
              <Input id="t-hard" type="date" value={f.hardDue} onChange={(e) => set('hardDue', e.target.value)} className="h-11" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-soft">Soft due (target)</Label>
              <Input id="t-soft" type="date" value={f.softDue} onChange={(e) => set('softDue', e.target.value)} className="h-11" />
            </div>
          </div>
          {editing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="t-sched">Scheduled for</Label>
              <Input
                id="t-sched"
                type="date"
                value={f.scheduledDate}
                disabled={!editing.scheduledDate && !board.unblocked(editing)}
                onChange={(e) => set('scheduledDate', e.target.value)}
                className="h-11"
              />
              {!editing.scheduledDate && !board.unblocked(editing) && (
                <p className="text-xs text-muted-foreground">Locked until its blockers are scheduled or done.</p>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagInput value={f.tags} onChange={(v) => set('tags', v)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Blocked by</Label>
            <MultiSelect options={blockerOptions} value={f.blockedBy} onChange={(v) => set('blockedBy', v)} placeholder="Nothing — available now" />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                className="h-11 text-destructive"
                onClick={async () => {
                  await del.mutateAsync(editing.id);
                  onClose();
                }}
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            ) : <span />}
            <Button type="submit" className="h-11 px-6" disabled={!f.title.trim()}>
              {editing ? 'Save' : 'Add subtask'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
