import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Copy, Download, ExternalLink, RefreshCw, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, unwrap, type Calendar } from '@todo/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { api, logout, qk, useCalendarsQuery } from '@/lib/api';
import { calendarColor } from '@/lib/events';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-muted-foreground">{hint}</p>}
      {children}
    </section>
  );
}

function Secret({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-md border border-primary/50 bg-muted p-3 text-sm">
      <p className="mb-1 font-medium">{label} — copy it now, it won’t be shown again.</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all text-xs">{value}</code>
        <Button size="icon" variant="outline" aria-label="Copy" onClick={() => void navigator.clipboard.writeText(value)}>
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function Tokens() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [secret, setSecret] = useState<string | null>(null);
  const list = useQuery({ queryKey: qk.tokens, queryFn: async () => (await unwrap(api.GET('/api/v1/tokens'))).items });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/tokens', { body: { name, scope } })),
    onSuccess: (t) => {
      setSecret(t.token);
      setName('');
      void qc.invalidateQueries({ queryKey: qk.tokens });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/tokens/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
  return (
    <Section title="API tokens" hint="Use as “Authorization: Bearer <token>” from your other tools.">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="flex min-w-40 flex-1 flex-col gap-1.5">
          <Label htmlFor="tok-name">Name</Label>
          <Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. home-assistant" className="h-11" />
        </div>
        <Select value={scope} onValueChange={(v) => setScope(v as 'read' | 'write')}>
          <SelectTrigger className="h-11 w-28" aria-label="Scope"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="write">Read + write</SelectItem>
            <SelectItem value="read">Read only</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" className="h-11" disabled={!name.trim()}>Create</Button>
      </form>
      {secret && <Secret label="New token" value={secret} />}
      <ul className="mt-3 divide-y">
        {list.data?.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              {t.name} <span className="text-xs text-muted-foreground">· {t.scope} · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleDateString()}` : 'never used'}</span>
            </span>
            <Button variant="ghost" size="icon" aria-label={`Revoke ${t.name}`} onClick={() => revoke.mutate(t.id)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Calendars() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const list = useCalendarsQuery();
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: qk.calendars });
    void qc.invalidateQueries({ queryKey: qk.calendarEvents });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? `${e.problem.title ?? 'Error'}: ${e.message}` : 'Something went wrong');

  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/calendars', { body: { name: name.trim(), url: url.trim() } })),
    onSuccess: () => {
      setName('');
      setUrl('');
      toast.success('Calendar added');
      refreshAll();
    },
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      unwrap(api.PATCH('/api/v1/calendars/{id}', { params: { path: { id } }, body: { enabled } })),
    onSuccess: refreshAll,
    onError: fail,
  });
  const refresh = useMutation({
    mutationFn: (id: string) => unwrap(api.POST('/api/v1/calendars/{id}/refresh', { params: { path: { id } } })),
    onSuccess: refreshAll,
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/calendars/{id}', { params: { path: { id } } })),
    onSuccess: refreshAll,
    onError: fail,
  });

  return (
    <Section
      title="Calendars"
      hint="Subscribe to ICS links (Google, Apple, Outlook, Nextcloud…). Events show on every view, read-only, and refresh automatically."
    >
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && url.trim()) add.mutate();
        }}
      >
        <div className="flex flex-col gap-1.5 sm:w-48">
          <Label htmlFor="cal-name">Name</Label>
          <Input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Work" maxLength={80} className="h-11" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="cal-url">ICS link</Label>
          <Input id="cal-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or webcal://…" className="h-11" inputMode="url" autoComplete="off" />
        </div>
        <Button type="submit" className="h-11" disabled={!name.trim() || !url.trim() || add.isPending}>
          {add.isPending ? 'Checking…' : 'Add'}
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        Treat the link like a password — many calendar apps put a secret token in it. It is stored on your server and never shown again.
      </p>

      <ul className="mt-3 divide-y">
        {list.data?.map((c: Calendar) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <CalendarDays className="size-4 shrink-0" style={{ color: calendarColor(c.color) }} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.source} · {c.fetchedAt ? `updated ${new Date(c.fetchedAt).toLocaleString()}` : 'not fetched yet'}
                </span>
                {c.error && (
                  <span role="alert" className="mt-0.5 flex items-start gap-1 text-xs text-destructive">
                    <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden /> {c.error} (showing the last good copy)
                  </span>
                )}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <Checkbox
                id={`cal-show-${c.id}`}
                checked={c.enabled}
                onCheckedChange={(v) => patch.mutate({ id: c.id, enabled: v === true })}
                aria-label={`Show ${c.name}`}
              />
              <Label htmlFor={`cal-show-${c.id}`} className="mr-2 text-xs">Show</Label>
              <Button variant="ghost" size="icon" aria-label={`Refresh ${c.name}`} disabled={refresh.isPending} onClick={() => refresh.mutate(c.id)}>
                <RefreshCw className={refresh.isPending && refresh.variables === c.id ? 'size-4 animate-spin' : 'size-4'} />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${c.name}`} onClick={() => remove.mutate(c.id)}>
                <Trash2 className="size-4" />
              </Button>
            </span>
          </li>
        ))}
        {list.data?.length === 0 && <li className="py-2 text-sm text-muted-foreground">No calendars yet.</li>}
      </ul>
    </Section>
  );
}

function Webhooks() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const list = useQuery({ queryKey: qk.webhooks, queryFn: async () => (await unwrap(api.GET('/api/v1/webhooks'))).items });
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/webhooks', { body: { url, events: [] } })),
    onSuccess: (h) => {
      setSecret(h.secret);
      setUrl('');
      void qc.invalidateQueries({ queryKey: qk.webhooks });
    },
    onError: () => toast.error('Could not add webhook — check the URL'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/api/v1/webhooks/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.webhooks }),
  });
  return (
    <Section title="Webhooks" hint="Receive task and project events as signed JSON (X-Todo-Signature, HMAC-SHA256).">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url) create.mutate();
        }}
      >
        <Input type="url" aria-label="Webhook URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hook" className="h-11" />
        <Button type="submit" className="h-11" disabled={!url}>Add</Button>
      </form>
      {secret && <Secret label="Signing secret" value={secret} />}
      <ul className="mt-3 divide-y">
        {list.data?.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="min-w-0 truncate">{h.url}</span>
            <Button variant="ghost" size="icon" aria-label={`Delete webhook ${h.url}`} onClick={() => remove.mutate(h.id)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Backup() {
  const qc = useQueryClient();
  const exportAll = async () => {
    const data = await unwrap(api.GET('/api/v1/export'));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `todo-backup-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const importFile = async (file: File) => {
    if (!window.confirm('Importing replaces ALL current projects and tasks. Continue?')) return;
    try {
      const body = JSON.parse(await file.text());
      const r = await unwrap(api.POST('/api/v1/import', { body }));
      toast.success(`Imported ${r.projects} projects, ${r.tasks} tasks`);
      void qc.invalidateQueries();
    } catch {
      toast.error('Import failed — is this a Todo Tool backup?');
    }
  };
  return (
    <Section title="Backup">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="h-11" onClick={() => void exportAll()}>
          <Download className="size-4" /> Export JSON
        </Button>
        <Button variant="outline" className="h-11" asChild>
          <label className="cursor-pointer">
            <Upload className="size-4" /> Import JSON
            <input type="file" accept="application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
          </label>
        </Button>
      </div>
    </Section>
  );
}

export function Settings({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Calendars />
      <Tokens />
      <Webhooks />
      <Backup />
      <Section title="API docs">
        <Button variant="outline" className="h-11" asChild>
          <a href="/api/docs" target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" /> Open interactive docs
          </a>
        </Button>
      </Section>
      <Button
        variant="ghost"
        className="h-11 self-start"
        onClick={async () => {
          await logout();
          onSignOut();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
