import { ArrowDownWideNarrow, Flag, ListFilter, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { IMPORTANCE_LABELS } from '@/components/marks';
import { MultiSelect } from '@/features/forms/fields';
import { useTagsQuery } from '@/lib/api';
import type { Board } from '@/lib/board';
import type { ViewState } from '@/lib/view-state';

export function Toolbar({
  view,
  setView,
  board,
  onAddProject,
}: {
  view: ViewState;
  setView: (p: Partial<ViewState>) => void;
  board: Board;
  onAddProject: () => void;
}) {
  const tags = useTagsQuery();
  const active = view.tags.length + view.importance.length + view.projects.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        value={view.sort}
        onValueChange={(v) => v && setView({ sort: v as ViewState['sort'] })}
        aria-label="Sort tasks by"
      >
        <ToggleGroupItem value="urgency" className="h-10 gap-1.5 px-3">
          <Flag className="size-4" /> Urgency
        </ToggleGroupItem>
        <ToggleGroupItem value="importance" className="h-10 gap-1.5 px-3">
          <ArrowDownWideNarrow className="size-4" /> Importance
        </ToggleGroupItem>
      </ToggleGroup>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-10 gap-1.5">
            <ListFilter className="size-4" /> Filter
            {active > 0 && <Badge className="ml-0.5 h-5 px-1.5">{active}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(92vw,22rem)] space-y-4">
          <div className="space-y-1.5">
            <Label>Tags (any of)</Label>
            <MultiSelect
              placeholder="All tags"
              options={(tags.data ?? []).map((t) => ({ id: t.name, label: `${t.name} (${t.count})` }))}
              value={view.tags}
              onChange={(v) => setView({ tags: v })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Importance</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              className="w-full"
              value={view.importance.map(String)}
              onValueChange={(v) => setView({ importance: v.map(Number) })}
            >
              {[1, 2, 3, 4].map((n) => (
                <ToggleGroupItem key={n} value={String(n)} className="h-10 flex-1 text-xs">
                  {IMPORTANCE_LABELS[n]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="space-y-1.5">
            <Label>Projects</Label>
            <MultiSelect
              placeholder="All projects"
              options={board.projects.map((p) => ({ id: p.id, label: p.name }))}
              value={view.projects}
              onChange={(v) => setView({ projects: v })}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="show-done" checked={view.showDone} onCheckedChange={(c) => setView({ showDone: c === true })} />
            <Label htmlFor="show-done">Show completed</Label>
          </div>
          {active > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setView({ tags: [], importance: [], projects: [] })}>
              <X className="size-4" /> Clear filters
            </Button>
          )}
        </PopoverContent>
      </Popover>

      <Button className="ml-auto h-10 gap-1.5" onClick={onAddProject}>
        <Plus className="size-4" /> Project
      </Button>
    </div>
  );
}
