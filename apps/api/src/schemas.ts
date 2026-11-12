import { z } from '@hono/zod-openapi';

export const DateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .openapi({ example: '2026-11-14', description: 'Calendar date, YYYY-MM-DD (no timezone)' });
export const Importance = z.number().int().min(1).max(4).openapi({ description: '1 = low … 4 = critical' });
export const Tags = z.array(z.string().min(1).max(40)).max(30);
export const Id = z.string().min(1);
export const TimeStr = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .openapi({ example: '14:30', description: 'Wall-clock time, HH:MM (no timezone)' });
export const Duration = z.number().int().min(5).max(1440).openapi({ description: 'Minutes; defaults to 30 when a start time is given' });

export const Urgency = z
  .object({
    days: z.number().int().openapi({ description: 'Days to the soonest due date in this task’s downstream tree; negative = overdue' }),
    kind: z.enum(['hard', 'soft']),
    sourceTaskId: z.string(),
  })
  .nullable();

export const TaskSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    parentId: z.string().nullable(),
    title: z.string(),
    importance: Importance,
    hardDue: DateStr.nullable(),
    softDue: DateStr.nullable(),
    scheduledDate: DateStr.nullable(),
    startTime: TimeStr.nullable(),
    durationMinutes: Duration.nullable(),
    done: z.boolean(),
    tags: z.array(z.string()),
    blockedBy: z.array(z.string()),
    version: z.number().int(),
    createdAt: z.string(),
    unblocked: z.boolean().openapi({ description: 'True when every blocker is scheduled or done' }),
    blockers: z.array(z.object({ id: z.string(), title: z.string() })).openapi({ description: 'Blockers still preventing scheduling' }),
    blocks: z.array(z.string()).openapi({ description: 'Ids of tasks directly blocked by this one' }),
    urgency: Urgency,
  })
  .openapi('Task');

export const TaskCreate = z
  .object({
    projectId: Id,
    title: z.string().min(1).max(300),
    importance: Importance.optional(),
    hardDue: DateStr.nullable().optional(),
    softDue: DateStr.nullable().optional(),
    scheduledDate: DateStr.nullable().optional(),
    tags: Tags.optional(),
    blockedBy: z.array(Id).optional(),
    parentId: Id.nullable().optional(),
  })
  .openapi('TaskCreate');

export const TaskPatch = z
  .object({
    title: z.string().min(1).max(300),
    importance: Importance,
    hardDue: DateStr.nullable(),
    softDue: DateStr.nullable(),
    done: z.boolean(),
    tags: Tags,
    projectId: Id,
  })
  .partial()
  .openapi('TaskPatch');

export const ProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    importance: Importance,
    archived: z.boolean(),
    tags: z.array(z.string()),
    version: z.number().int(),
    createdAt: z.string(),
    openTasks: z.number().int(),
  })
  .openapi('Project');

export const ProjectCreate = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    importance: Importance.optional(),
    tags: Tags.optional(),
  })
  .openapi('ProjectCreate');

export const ProjectPatch = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullable(),
    importance: Importance,
    archived: z.boolean(),
    tags: Tags,
  })
  .partial()
  .openapi('ProjectPatch');

export const Problem = z
  .object({ type: z.string(), title: z.string(), status: z.number().int(), detail: z.string().optional() })
  .passthrough()
  .openapi('Problem');

export const ScheduleResult = z
  .object({
    task: TaskSchema,
    scheduledDependents: z.array(TaskSchema).openapi({
      description: 'After unscheduling: dependents still scheduled even though their blocker no longer is',
    }),
  })
  .openapi('ScheduleResult');

export const ScheduleBody = z
  .object({
    date: DateStr,
    startTime: TimeStr.nullable().optional().openapi({ description: 'Omit or null for an untimed (all-day style) task' }),
    durationMinutes: Duration.nullable().optional(),
  })
  .openapi('ScheduleBody');

export const PlanBody = z
  .object({
    date: DateStr,
    startTime: TimeStr.nullable().optional(),
    durationMinutes: Duration.nullable().optional(),
    goal: z.string().max(300).optional().openapi({
      description: 'Omit to schedule the whole task; provide to create a scheduled child subtask with this goal',
    }),
  })
  .openapi('PlanBody');
export const PlanResult = z
  .object({ task: TaskSchema, created: z.boolean(), scheduledDependents: z.array(TaskSchema) })
  .openapi('PlanResult');

export const WeekSchema = z
  .object({
    today: DateStr,
    start: DateStr,
    days: z.array(
      z.object({
        date: DateStr,
        weekend: z.boolean(),
        tasks: z.array(TaskSchema),
        dueMarkers: z.array(
          z.object({ taskId: z.string(), projectId: z.string(), title: z.string(), kind: z.enum(['hard', 'soft']) }),
        ),
      }),
    ),
  })
  .openapi('Week');

export const TokenSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scope: z.enum(['read', 'write']),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
  })
  .openapi('Token');

export const WebhookSchema = z
  .object({
    id: z.string(),
    url: z.string().url(),
    events: z.array(z.string()),
    createdAt: z.string(),
  })
  .openapi('Webhook');

export const ExportSchema = z
  .object({
    version: z.literal(1),
    exportedAt: z.string().optional(),
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        importance: Importance,
        archived: z.boolean(),
        tags: z.array(z.string()),
        createdAt: z.string().optional(),
      }),
    ),
    tasks: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        parentId: z.string().nullable(),
        title: z.string(),
        importance: Importance,
        hardDue: DateStr.nullable(),
        softDue: DateStr.nullable(),
        scheduledDate: DateStr.nullable(),
        startTime: TimeStr.nullable().optional(),
        durationMinutes: Duration.nullable().optional(),
        done: z.boolean(),
        tags: z.array(z.string()),
        blockedBy: z.array(z.string()),
        createdAt: z.string().optional(),
      }),
    ),
  })
  .openapi('Export');

export const CalendarColor = z.enum(['sky', 'orange', 'green', 'pink', 'yellow', 'vermillion']);

export const CalendarSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    source: z.string().openapi({ description: 'Host of the ICS link. The full URL is never returned (it often contains a secret).' }),
    color: CalendarColor,
    enabled: z.boolean(),
    fetchedAt: z.string().nullable(),
    error: z.string().nullable().openapi({ description: 'Last refresh error; previous data is kept while set' }),
  })
  .openapi('Calendar');

export const CalendarEventSchema = z
  .object({
    id: z.string(),
    calendarId: z.string(),
    calendarName: z.string(),
    color: CalendarColor,
    uid: z.string(),
    title: z.string(),
    start: z.string().openapi({ description: 'All-day: YYYY-MM-DD. Timed: ISO-8601 instant (UTC).' }),
    end: z.string().openapi({ description: 'All-day: exclusive YYYY-MM-DD (as in ICS). Timed: ISO-8601 instant (UTC).' }),
    allDay: z.boolean(),
    location: z.string().nullable(),
  })
  .openapi('CalendarEvent');

export const NowItemSchema = z
  .object({
    kind: z.enum(['task', 'event']),
    id: z.string(),
    title: z.string(),
    start: z.string().openapi({ description: 'ISO-8601 instant (UTC)' }),
    end: z.string().openapi({ description: 'ISO-8601 instant (UTC)' }),
    projectName: z.string().nullable().openapi({ description: 'Set for tasks' }),
    calendarName: z.string().nullable().openapi({ description: 'Set for calendar events' }),
    calendarColor: z.string().nullable().openapi({ description: 'Calendar color key for events' }),
  })
  .openapi('NowItem');

export const NowSchema = z
  .object({
    now: z.string(),
    current: NowItemSchema.nullable().openapi({ description: 'Happening right now; the soonest-ending one if several overlap' }),
    next: NowItemSchema.nullable().openapi({ description: 'Next thing to start after now (also given while something is current)' }),
  })
  .openapi('Now');
