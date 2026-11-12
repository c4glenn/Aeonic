import { z } from 'zod';

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');
export const importanceSchema = z.number().int().min(1).max(4);
/** 1 = low … 4 = critical */
export type Importance = z.infer<typeof importanceSchema>;

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  parentId: z.string().nullable(),
  title: z.string().min(1).max(300),
  importance: importanceSchema,
  hardDue: dateString.nullable(),
  softDue: dateString.nullable(),
  scheduledDate: dateString.nullable(),
  /** Wall-clock start (HH:MM) when the task is a timed block; null = untimed. */
  startTime: timeString.nullable(),
  durationMinutes: z.number().int().min(5).max(1440).nullable(),
  done: z.boolean(),
  tags: z.array(z.string()),
  blockedBy: z.array(z.string()),
});
export type Task = z.infer<typeof taskSchema>;

export const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  importance: importanceSchema,
  archived: z.boolean(),
  tags: z.array(z.string()),
});
export type Project = z.infer<typeof projectSchema>;

export type DueKind = 'hard' | 'soft';
export interface Urgency {
  /** Days until the soonest due date in the task's downstream tree; negative = overdue. */
  days: number;
  kind: DueKind;
  /** Task whose due date drives this urgency (may be the task itself). */
  sourceTaskId: string;
}
