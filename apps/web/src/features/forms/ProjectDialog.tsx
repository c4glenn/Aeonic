import { useEffect, useState } from 'react';
import { Archive, Trash2 } from 'lucide-react';
import type { Project } from '@aeonic/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateProject, useDeleteProject, useUpdateProject } from '@/lib/mutations';
import { ImportancePicker, TagInput } from './fields';

export type ProjectDialogState = { mode: 'create' } | { mode: 'edit'; project: Project } | null;

export function ProjectDialog({ state, onClose }: { state: ProjectDialogState; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [importance, setImportance] = useState(2);
  const [tags, setTags] = useState<string[]>([]);
  const create = useCreateProject();
  const update = useUpdateProject();
  const del = useDeleteProject();
  const editing = state?.mode === 'edit' ? state.project : null;

  useEffect(() => {
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setImportance(editing?.importance ?? 2);
    setTags(editing?.tags ?? []);
  }, [state, editing]);

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = { name: name.trim(), description: description.trim() || null, importance, tags };
            if (editing) await update.mutateAsync({ id: editing.id, patch: body });
            else await create.mutateAsync(body);
            onClose();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Textarea id="p-desc" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Importance</Label>
            <ImportancePicker value={importance} onChange={setImportance} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagInput value={tags} onChange={setTags} />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editing ? (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11"
                  onClick={async () => {
                    await update.mutateAsync({ id: editing.id, patch: { archived: true } });
                    onClose();
                  }}
                >
                  <Archive className="size-4" /> Archive
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 text-destructive"
                  onClick={async () => {
                    if (!window.confirm(`Delete “${editing.name}” and all its subtasks?`)) return;
                    await del.mutateAsync(editing.id);
                    onClose();
                  }}
                >
                  <Trash2 className="size-4" /> Delete
                </Button>
              </div>
            ) : <span />}
            <Button type="submit" className="h-11 px-6" disabled={!name.trim()}>
              {editing ? 'Save' : 'Add project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
