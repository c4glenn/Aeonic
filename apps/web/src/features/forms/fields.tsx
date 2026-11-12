import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ImportanceMark, IMPORTANCE_LABELS, TagChip } from '@/components/marks';
import { useTagsQuery } from '@/lib/api';

export function ImportancePicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={String(value)}
      onValueChange={(v) => v && onChange(Number(v))}
      aria-label="Importance"
      className="w-full"
    >
      {[1, 2, 3, 4].map((n) => (
        <ToggleGroupItem key={n} value={String(n)} className="h-11 flex-1 flex-col gap-0.5 text-[11px]" aria-label={IMPORTANCE_LABELS[n]}>
          <ImportanceMark level={n} />
          {IMPORTANCE_LABELS[n]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const tags = useTagsQuery();
  const [query, setQuery] = useState('');
  const norm = query.trim().toLowerCase();
  const known = (tags.data ?? []).map((t) => t.name);
  const add = (t: string) => {
    if (t && !value.includes(t)) onChange([...value, t]);
    setQuery('');
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center">
            <TagChip tag={t} className="rounded-r-none" />
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => onChange(value.filter((x) => x !== t))}
              className="flex size-[22px] items-center justify-center rounded-r-sm border border-l-0 bg-muted hover:bg-accent"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="h-11 justify-between font-normal text-muted-foreground">
            Add tag…
            <ChevronsUpDown className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search or create…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>Type a name and press Enter</CommandEmpty>
              <CommandGroup>
                {norm && !known.includes(norm) && (
                  <CommandItem value={`create-${norm}`} onSelect={() => add(norm)}>
                    Create “{norm}”
                  </CommandItem>
                )}
                {known
                  .filter((t) => !value.includes(t))
                  .map((t) => (
                    <CommandItem key={t} value={t} onSelect={() => add(t)}>
                      {t}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
}: {
  options: { id: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-11 w-full justify-between font-normal">
          <span className="truncate">
            {value.length ? options.filter((o) => value.includes(o.id)).map((o) => o.label).join(', ') : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>Nothing found</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.id} value={o.label + o.id} onSelect={() => toggle(o.id)}>
                  <Check className={value.includes(o.id) ? 'size-4 opacity-100' : 'size-4 opacity-0'} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
