import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createApiClient, unwrap, type Calendar, type CalendarEvent, type Project, type Task } from '@aeonic/client';

export const api = createApiClient({ browser: true });

export const qk = {
  tasks: ['tasks'] as const,
  projects: ['projects'] as const,
  tags: ['tags'] as const,
  tokens: ['tokens'] as const,
  webhooks: ['webhooks'] as const,
  calendars: ['calendars'] as const,
  calendarEvents: ['calendar-events'] as const,
  now: ['now'] as const,
};

export const useTasksQuery = () =>
  useQuery({
    queryKey: qk.tasks,
    queryFn: async (): Promise<Task[]> =>
      (await unwrap(api.GET('/api/v1/tasks', { params: { query: { status: 'all', limit: 500 } } }))).items,
  });

export const useProjectsQuery = () =>
  useQuery({
    queryKey: qk.projects,
    queryFn: async (): Promise<Project[]> => (await unwrap(api.GET('/api/v1/projects', { params: { query: {} } }))).items,
  });

export const useTagsQuery = () =>
  useQuery({
    queryKey: qk.tags,
    queryFn: async () => (await unwrap(api.GET('/api/v1/tags'))).items,
  });

const NO_EVENTS: CalendarEvent[] = [];

/** Current / next timed item (task or calendar event). Task wall-clock times are read in the browser's zone. */
export const useNowQuery = () => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQuery({
    queryKey: [...qk.now, tz],
    staleTime: 10_000,
    refetchInterval: 60_000,
    queryFn: async () => unwrap(api.GET('/api/v1/now', { params: { query: { tz } } })),
  });
};

export const useCalendarsQuery = () =>
  useQuery({
    queryKey: qk.calendars,
    queryFn: async (): Promise<Calendar[]> => (await unwrap(api.GET('/api/v1/calendars'))).items,
  });

/** Events from subscribed ICS calendars for local dates from..to (inclusive). */
export function useCalendarEvents(from: string, to: string, enabled = true): CalendarEvent[] {
  const q = useQuery({
    enabled,
    queryKey: [...qk.calendarEvents, from, to],
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => (await unwrap(api.GET('/api/v1/calendar-events', { params: { query: { from, to } } }))).items,
  });
  return q.data ?? NO_EVENTS;
}

const EVENT_TYPES = [
  'calendar.updated',
  'task.created', 'task.updated', 'task.deleted', 'task.scheduled', 'task.unscheduled', 'task.completed',
  'project.created', 'project.updated', 'project.deleted', 'import.completed',
];

/** Keep every open tab/device in sync through server-sent events. */
export function useLiveSync(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/v1/events', { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: qk.tasks });
        void qc.invalidateQueries({ queryKey: qk.projects });
        void qc.invalidateQueries({ queryKey: qk.tags });
        void qc.invalidateQueries({ queryKey: qk.calendars });
        void qc.invalidateQueries({ queryKey: qk.calendarEvents });
        void qc.invalidateQueries({ queryKey: qk.now });
      }, 120);
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, refresh);
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [enabled, qc]);
}

export async function login(password: string): Promise<boolean> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'aeonic-web' },
    body: JSON.stringify({ password }),
    credentials: 'include',
  });
  return res.ok;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include', headers: { 'x-requested-with': 'aeonic-web' } });
}
