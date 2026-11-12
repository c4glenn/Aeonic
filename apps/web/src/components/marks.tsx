import { Flag, Hourglass, Lock } from 'lucide-react';
import type { Urgency } from '@aeonic/domain';
import { cn } from '@/lib/utils';

export const IMPORTANCE_LABELS = ['', 'Low', 'Normal', 'High', 'Critical'] as const;

/** Four ascending bars; the count of filled bars + the label carry the meaning (never color alone). */
export function ImportanceMark({ level, withLabel = false, className }: { level: number; withLabel?: boolean; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground', className)}
      title={`Importance: ${IMPORTANCE_LABELS[level]}`}
    >
      <span className="inline-flex items-end gap-px" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            style={{ height: 4 + i * 2.5 }}
            className={cn('w-[3px] rounded-[1px]', i <= level ? 'bg-primary' : 'bg-border')}
          />
        ))}
      </span>
      {withLabel ? <span>{IMPORTANCE_LABELS[level]}</span> : <span className="sr-only">{IMPORTANCE_LABELS[level]} importance</span>}
    </span>
  );
}

// Okabe–Ito hues. The dot is decoration only: the tag name is always printed next to it.
const TAG_COLORS = ['bg-oi-sky', 'bg-oi-orange', 'bg-oi-green', 'bg-oi-pink', 'bg-oi-yellow', 'bg-oi-vermillion'];
function tagColor(tag: string) {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length]!;
}

export function TagChip({ tag, className }: { tag: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-px text-[11px] leading-4 text-secondary-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', tagColor(tag))} aria-hidden />
      {tag}
    </span>
  );
}

const shortDate = (d: string) =>
  new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Hard = solid heavy border + flag + "Due". Soft = dashed light border + hourglass + "Target". */
export function DueMark({ kind, date, className }: { kind: 'hard' | 'soft'; date: string; className?: string }) {
  const hard = kind === 'hard';
  const Icon = hard ? Flag : Hourglass;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1.5 py-px text-[11px] leading-4',
        hard ? 'border-2 border-solid border-hard font-semibold text-hard' : 'border border-dashed border-soft text-soft',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {hard ? 'Due' : 'Target'} {shortDate(date)}
    </span>
  );
}

export function UrgencyMark({ urgency, className }: { urgency: Urgency | null | undefined; className?: string }) {
  if (!urgency) return null;
  const hard = urgency.kind === 'hard';
  const Icon = hard ? Flag : Hourglass;
  const d = urgency.days;
  const text = d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `${d}d`;
  return (
    <span
      title={`${hard ? 'Hard deadline' : 'Soft target'} ${d < 0 ? 'passed' : 'in'} ${Math.abs(d)} day(s), counting dependent tasks`}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-sm px-1 py-px text-[11px] leading-4',
        hard ? 'border-2 border-solid border-hard font-semibold text-hard' : 'border border-dashed border-soft text-soft',
        d < 0 && 'underline decoration-wavy underline-offset-2',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {text}
    </span>
  );
}

export function LockMark({ names }: { names: string[] }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={`Waiting on: ${names.join(', ')}`}>
      <Lock className="size-3" aria-hidden />
      {names.length ? `after ${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}` : 'locked'}
    </span>
  );
}
