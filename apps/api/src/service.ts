import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  activeBlockers,
  addDays,
  computeUrgencies,
  dependentsMap,
  indexTasks,
  isUnblocked,
  isWeekend,
  matchesFilter,
  scheduledDependents,
  sortTasks,
  todayIn,
  weekFrom,
  wouldCreateCycle,
  type Project,
  type SortKey,
  type Task,
  type TaskFilter,
  type Urgency,
} from '@todo/domain';
import type { Config } from './env';
import type { Db } from './db';
import { schema } from './db';
import type { Bus } from './events';
import { HttpError, notFound } from './problem';

export interface TaskView extends Task {
  version: number;
  createdAt: string;
  unblocked: boolean;
  blockers: { id: string; title: string }[];
  blocks: string[];
  urgency: Urgency | null;
}
export interface ProjectView extends Project {
  version: number;
  createdAt: string;
  openTasks: number;
}

type TaskRow = typeof schema.tasks.$inferSelect;
type ProjectRow = typeof schema.projects.$inferSelect;

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  projectId: r.projectId,
  parentId: r.parentId,
  title: r.title,
  importance: r.importance,
  hardDue: r.hardDue,
  softDue: r.softDue,
  scheduledDate: r.scheduledDate,
  done: r.done,
  tags: r.tags,
  blockedBy: r.blockedBy,
});
const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  importance: r.importance,
  archived: r.archived,
  tags: r.tags,
});

const normTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];

export interface TaskQuery extends TaskFilter {
  status?: 'open' | 'done' | 'all';
  unblocked?: boolean;
  scheduledFrom?: string;
  scheduledTo?: string;
  dueBefore?: string;
  sort?: SortKey;
  limit?: number;
  cursor?: string;
}

export class Store {
  constructor(
    public db: Db,
    public cfg: Config,
    public bus: Bus,
    public clock: () => Date = () => new Date(),
  ) {}

  today() {
    return todayIn(this.cfg.timeZone, this.clock());
  }
  private now() {
    return this.clock().toISOString();
  }

  // ---------- reads ----------
  private rawTasks(): TaskRow[] {
    return this.db.select().from(schema.tasks).all();
  }
  private rawProjects(): ProjectRow[] {
    return this.db.select().from(schema.projects).all();
  }

  /** Build enriched views for every task (single-user scale: compute in memory). */
  allTaskViews(): TaskView[] {
    const rows = this.rawTasks();
    const tasks = rows.map(toTask);
    const byId = indexTasks(tasks);
    const dependents = dependentsMap(tasks);
    const urgencies = computeUrgencies(tasks, this.today());
    return rows.map((r) => {
      const t = byId.get(r.id)!;
      return {
        ...t,
        version: r.version,
        createdAt: r.createdAt,
        unblocked: isUnblocked(t, byId),
        blockers: activeBlockers(t, byId).map((b) => ({ id: b.id, title: b.title })),
        blocks: dependents.get(t.id) ?? [],
        urgency: urgencies.get(t.id) ?? null,
      };
    });
  }

  getTaskView(id: string): TaskView {
    const v = this.allTaskViews().find((t) => t.id === id);
    if (!v) throw notFound('Task');
    return v;
  }

  listTasks(q: TaskQuery): { items: TaskView[]; nextCursor: string | null } {
    const projects = new Map(this.rawProjects().map((p) => [p.id, toProject(p)]));
    const status = q.status ?? 'open';
    let views = this.allTaskViews().filter((t) => {
      if (status === 'open' && t.done) return false;
      if (status === 'done' && !t.done) return false;
      if (!matchesFilter(t, projects.get(t.projectId), { ...q, showDone: true })) return false;
      if (q.unblocked !== undefined && t.unblocked !== q.unblocked) return false;
      if (q.scheduledFrom && (!t.scheduledDate || t.scheduledDate < q.scheduledFrom)) return false;
      if (q.scheduledTo && (!t.scheduledDate || t.scheduledDate > q.scheduledTo)) return false;
      if (q.dueBefore) {
        const due = [t.hardDue, t.softDue].filter((d): d is string => !!d);
        if (!due.some((d) => d <= q.dueBefore!)) return false;
      }
      return true;
    });
    const urg = new Map(views.map((v) => [v.id, v.urgency]));
    views = sortTasks(views, q.sort ?? 'urgency', urg);
    const offset = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString()) || 0 : 0;
    const limit = q.limit ?? 100;
    const items = views.slice(offset, offset + limit);
    const next = offset + limit < views.length ? Buffer.from(String(offset + limit)).toString('base64url') : null;
    return { items, nextCursor: next };
  }

  listProjects(includeArchived = false): ProjectView[] {
    const counts = new Map<string, number>();
    for (const t of this.rawTasks()) if (!t.done) counts.set(t.projectId, (counts.get(t.projectId) ?? 0) + 1);
    return this.rawProjects()
      .filter((p) => includeArchived || !p.archived)
      .map((p) => ({ ...toProject(p), version: p.version, createdAt: p.createdAt, openTasks: counts.get(p.id) ?? 0 }));
  }

  getProject(id: string): ProjectView {
    const p = this.listProjects(true).find((x) => x.id === id);
    if (!p) throw notFound('Project');
    return p;
  }

  listTags(): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const t of [...this.rawTasks(), ...this.rawProjects()]) {
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }

  week(start?: string) {
    const first = start ?? this.today();
    const dates = weekFrom(first);
    const views = this.allTaskViews().filter((t) => !t.done);
    return {
      today: this.today(),
      start: first,
      days: dates.map((date) => ({
        date,
        weekend: isWeekend(date),
        tasks: views.filter((t) => t.scheduledDate === date),
        dueMarkers: views.flatMap((t) => [
          ...(t.hardDue === date ? [{ taskId: t.id, projectId: t.projectId, title: t.title, kind: 'hard' as const }] : []),
          ...(t.softDue === date ? [{ taskId: t.id, projectId: t.projectId, title: t.title, kind: 'soft' as const }] : []),
        ]),
      })),
    };
  }

  // ---------- projects ----------
  createProject(input: {
    name: string;
    description?: string | null;
    importance?: number;
    tags?: string[];
  }): ProjectView {
    const id = nanoid(12);
    this.db
      .insert(schema.projects)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        importance: input.importance ?? 2,
        archived: false,
        tags: normTags(input.tags ?? []),
        createdAt: this.now(),
      })
      .run();
    this.bus.emit('project.created', { id });
    return this.getProject(id);
  }

  updateProject(
    id: string,
    patch: { name?: string; description?: string | null; importance?: number; archived?: boolean; tags?: string[] },
    ifMatch?: number,
  ): ProjectView {
    const cur = this.getProject(id);
    if (ifMatch !== undefined && ifMatch !== cur.version) throw preconditionFailed();
    this.db
      .update(schema.projects)
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.importance !== undefined && { importance: patch.importance }),
        ...(patch.archived !== undefined && { archived: patch.archived }),
        ...(patch.tags !== undefined && { tags: normTags(patch.tags) }),
        version: cur.version + 1,
      })
      .where(eq(schema.projects.id, id))
      .run();
    this.bus.emit('project.updated', { id });
    return this.getProject(id);
  }

  deleteProject(id: string) {
    this.getProject(id);
    const ids = new Set(this.rawTasks().filter((t) => t.projectId === id).map((t) => t.id));
    this.db.transaction((tx) => {
      for (const t of this.rawTasks()) {
        if (ids.has(t.id)) continue;
        const kept = t.blockedBy.filter((b) => !ids.has(b));
        if (kept.length !== t.blockedBy.length) {
          tx.update(schema.tasks).set({ blockedBy: kept, version: t.version + 1 }).where(eq(schema.tasks.id, t.id)).run();
        }
      }
      tx.delete(schema.tasks).where(eq(schema.tasks.projectId, id)).run();
      tx.delete(schema.projects).where(eq(schema.projects.id, id)).run();
    });
    this.bus.emit('project.deleted', { id });
  }

  // ---------- tasks ----------
  private assertBlockers(taskId: string | null, blockedBy: string[], all: Task[]) {
    const ids = new Set(all.map((t) => t.id));
    const missing = blockedBy.filter((b) => !ids.has(b));
    if (missing.length) throw new HttpError(422, 'Unknown blocker', `Unknown task ids: ${missing.join(', ')}`);
    if (taskId && wouldCreateCycle(all, taskId, blockedBy)) {
      throw new HttpError(422, 'Dependency cycle', 'These dependencies would create a cycle');
    }
  }

  createTask(input: {
    projectId: string;
    title: string;
    importance?: number;
    hardDue?: string | null;
    softDue?: string | null;
    scheduledDate?: string | null;
    tags?: string[];
    blockedBy?: string[];
    parentId?: string | null;
  }): TaskView {
    this.getProject(input.projectId);
    const all = this.rawTasks().map(toTask);
    const blockedBy = [...new Set(input.blockedBy ?? [])];
    this.assertBlockers(null, blockedBy, all);
    if (input.parentId && !all.some((t) => t.id === input.parentId)) throw new HttpError(422, 'Unknown parent');
    const id = nanoid(12);
    const draft: Task = {
      id,
      projectId: input.projectId,
      parentId: input.parentId ?? null,
      title: input.title,
      importance: input.importance ?? 2,
      hardDue: input.hardDue ?? null,
      softDue: input.softDue ?? null,
      scheduledDate: input.scheduledDate ?? null,
      done: false,
      tags: normTags(input.tags ?? []),
      blockedBy,
    };
    if (draft.scheduledDate && !isUnblocked(draft, indexTasks(all))) throw this.blockedError(draft, all);
    this.db.insert(schema.tasks).values({ ...draft, createdAt: this.now() }).run();
    this.bus.emit('task.created', { id, projectId: draft.projectId });
    if (draft.scheduledDate) this.bus.emit('task.scheduled', { id, date: draft.scheduledDate });
    return this.getTaskView(id);
  }

  updateTask(
    id: string,
    patch: {
      title?: string;
      importance?: number;
      hardDue?: string | null;
      softDue?: string | null;
      done?: boolean;
      tags?: string[];
      projectId?: string;
    },
    ifMatch?: number,
  ): TaskView {
    const cur = this.getTaskView(id);
    if (ifMatch !== undefined && ifMatch !== cur.version) throw preconditionFailed();
    if (patch.projectId) this.getProject(patch.projectId);
    this.db
      .update(schema.tasks)
      .set({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.importance !== undefined && { importance: patch.importance }),
        ...(patch.hardDue !== undefined && { hardDue: patch.hardDue }),
        ...(patch.softDue !== undefined && { softDue: patch.softDue }),
        ...(patch.done !== undefined && { done: patch.done }),
        ...(patch.tags !== undefined && { tags: normTags(patch.tags) }),
        ...(patch.projectId !== undefined && { projectId: patch.projectId }),
        version: cur.version + 1,
      })
      .where(eq(schema.tasks.id, id))
      .run();
    this.bus.emit('task.updated', { id });
    if (patch.done === true && !cur.done) this.bus.emit('task.completed', { id });
    return this.getTaskView(id);
  }

  deleteTask(id: string) {
    this.getTaskView(id);
    this.db.transaction((tx) => {
      for (const t of this.rawTasks()) {
        if (t.id === id) continue;
        const patch: Partial<TaskRow> = {};
        if (t.blockedBy.includes(id)) patch.blockedBy = t.blockedBy.filter((b) => b !== id);
        if (t.parentId === id) patch.parentId = null;
        if (Object.keys(patch).length) {
          tx.update(schema.tasks).set({ ...patch, version: t.version + 1 }).where(eq(schema.tasks.id, t.id)).run();
        }
      }
      tx.delete(schema.tasks).where(eq(schema.tasks.id, id)).run();
    });
    this.bus.emit('task.deleted', { id });
  }

  private blockedError(task: Task, all: Task[]) {
    const blockers = activeBlockers(task, indexTasks(all)).map((b) => ({ id: b.id, title: b.title }));
    return new HttpError(409, 'Task is blocked', 'Schedule or complete its blockers first', { blockers });
  }

  schedule(id: string, date: string): { task: TaskView; scheduledDependents: TaskView[] } {
    const all = this.rawTasks().map(toTask);
    const t = all.find((x) => x.id === id);
    if (!t) throw notFound('Task');
    if (!isUnblocked(t, indexTasks(all))) throw this.blockedError(t, all);
    this.db.update(schema.tasks).set({ scheduledDate: date }).where(eq(schema.tasks.id, id)).run();
    this.bumpVersion(id);
    this.bus.emit('task.scheduled', { id, date });
    return { task: this.getTaskView(id), scheduledDependents: [] };
  }

  unschedule(id: string): { task: TaskView; scheduledDependents: TaskView[] } {
    this.getTaskView(id);
    this.db.update(schema.tasks).set({ scheduledDate: null }).where(eq(schema.tasks.id, id)).run();
    this.bumpVersion(id);
    this.bus.emit('task.unscheduled', { id });
    const orphans = new Set(scheduledDependents(id, this.rawTasks().map(toTask)).map((t) => t.id));
    return { task: this.getTaskView(id), scheduledDependents: this.allTaskViews().filter((t) => orphans.has(t.id)) };
  }

  /** Drop flow: schedule whole task, or create a scheduled child with the stated goal. */
  plan(id: string, date: string, goal?: string): { task: TaskView; created: boolean; scheduledDependents: TaskView[] } {
    const parent = this.getTaskView(id);
    const trimmed = goal?.trim();
    if (!trimmed) {
      const r = this.schedule(id, date);
      return { ...r, created: false };
    }
    const task = this.createTask({
      projectId: parent.projectId,
      parentId: parent.id,
      title: trimmed,
      importance: parent.importance,
      tags: parent.tags,
      scheduledDate: date,
    });
    return { task, created: true, scheduledDependents: [] };
  }

  setDependencies(id: string, blockedBy: string[]): TaskView {
    const cur = this.getTaskView(id);
    const all = this.rawTasks().map(toTask);
    const unique = [...new Set(blockedBy)];
    this.assertBlockers(id, unique, all);
    this.db
      .update(schema.tasks)
      .set({ blockedBy: unique, version: cur.version + 1 })
      .where(eq(schema.tasks.id, id))
      .run();
    this.bus.emit('task.updated', { id });
    return this.getTaskView(id);
  }

  private bumpVersion(id: string) {
    const row = this.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    if (row) this.db.update(schema.tasks).set({ version: row.version + 1 }).where(eq(schema.tasks.id, id)).run();
  }

  // ---------- export / import ----------
  export() {
    return {
      version: 1 as const,
      exportedAt: this.now(),
      projects: this.rawProjects().map((p) => ({ ...toProject(p), createdAt: p.createdAt })),
      tasks: this.rawTasks().map((t) => ({ ...toTask(t), createdAt: t.createdAt })),
    };
  }

  import(data: { projects: (Project & { createdAt?: string })[]; tasks: (Task & { createdAt?: string })[] }) {
    const ids = new Set(data.tasks.map((t) => t.id));
    for (const t of data.tasks) {
      const missing = t.blockedBy.filter((b) => !ids.has(b));
      if (missing.length) throw new HttpError(422, 'Invalid import', `Task ${t.id} blocked by unknown ${missing.join(',')}`);
    }
    for (const t of data.tasks) {
      if (wouldCreateCycle(data.tasks, t.id, t.blockedBy)) {
        throw new HttpError(422, 'Invalid import', `Dependency cycle involving ${t.id}`);
      }
    }
    const pids = new Set(data.projects.map((p) => p.id));
    if (data.tasks.some((t) => !pids.has(t.projectId))) throw new HttpError(422, 'Invalid import', 'Task references unknown project');
    const now = this.now();
    this.db.transaction((tx) => {
      tx.delete(schema.tasks).run();
      tx.delete(schema.projects).run();
      for (const p of data.projects) {
        tx.insert(schema.projects).values({ ...p, tags: normTags(p.tags), createdAt: p.createdAt ?? now }).run();
      }
      for (const t of data.tasks) {
        tx.insert(schema.tasks).values({ ...t, tags: normTags(t.tags), createdAt: t.createdAt ?? now }).run();
      }
    });
    this.bus.emit('import.completed', { projects: data.projects.length, tasks: data.tasks.length });
    return { projects: data.projects.length, tasks: data.tasks.length };
  }

  // ---------- seed ----------
  seedIfEmpty() {
    if (this.rawProjects().length) return;
    const today = this.today();
    const p = this.createProject({ name: 'Launch the garden shed', description: 'Sample project — delete me', importance: 3, tags: ['home'] });
    const plan = this.createTask({ projectId: p.id, title: 'Sketch layout', importance: 3, tags: ['design'] });
    const buy = this.createTask({ projectId: p.id, title: 'Buy materials', blockedBy: [plan.id], softDue: addDays(today, 3) });
    this.createTask({ projectId: p.id, title: 'Build frame', importance: 4, blockedBy: [buy.id], hardDue: addDays(today, 5) });
    this.createTask({ projectId: p.id, title: 'Measure the lot', tags: ['design'] });
  }

}


function preconditionFailed() {
  return new HttpError(412, 'Precondition Failed', 'The resource changed; refetch and retry');
}
