import { useEffect, useState } from 'react';
import { CheckCircle2, ListPlus } from 'lucide-react';
import type { Task } from '@todo/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface PlanTarget {
  task: Task;
  date: string;
}

/** Opens when a task is dropped on (or tap-scheduled to) a day. */
export function PlanDialog({
  target,
  onClose,
  onWhole,
  onGoal,
}: {
  target: PlanTarget | null;
  onClose: () => void;
  onWhole: (t: PlanTarget) => void;
  onGoal: (t: PlanTarget, goal: string) => void;
}) {
  const [goal, setGoal] = useState('');
  useEffect(() => setGoal(''), [target]);
  const dateLabel = target
    ? new Date(target.date + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '';

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What are you planning on doing?</DialogTitle>
          <DialogDescription>
            {dateLabel} · from “{target?.task.title}”
          </DialogDescription>
        </DialogHeader>
        {target && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (goal.trim()) onGoal(target, goal.trim());
            }}
          >
            <Input
              autoFocus
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Outline the first section"
              className="h-11"
              aria-label="What are you planning on doing"
              maxLength={300}
            />
            <Button type="submit" disabled={!goal.trim()} className="h-11">
              <ListPlus className="size-4" /> Add this as a step
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
            </div>
            <Button type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => onWhole(target)}>
              <CheckCircle2 className="size-4 shrink-0" /> Do the whole subtask
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
