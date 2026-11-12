import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { SortKey } from '@aeonic/domain';

export interface ViewState {
  tags: string[];
  importance: number[];
  projects: string[];
  sort: SortKey;
  showDone: boolean;
}

const EVT = 'viewstate';
const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

function snapshot() {
  return window.location.search;
}
function subscribe(cb: () => void) {
  window.addEventListener('popstate', cb);
  window.addEventListener(EVT, cb);
  return () => {
    window.removeEventListener('popstate', cb);
    window.removeEventListener(EVT, cb);
  };
}

export function parseViewState(search: string): ViewState {
  const p = new URLSearchParams(search);
  return {
    tags: csv(p.get('tags')),
    importance: csv(p.get('imp')).map(Number).filter((n) => n >= 1 && n <= 4),
    projects: csv(p.get('projects')),
    sort: p.get('sort') === 'importance' ? 'importance' : 'urgency',
    showDone: p.get('done') === '1',
  };
}

/** Filter/sort state lives in the URL so views are linkable and survive reload. */
export function useViewState(): [ViewState, (patch: Partial<ViewState>) => void] {
  const search = useSyncExternalStore(subscribe, snapshot, () => '');
  // memoised on the query string: a fresh object every render would recompute the whole board each time
  const state = useMemo(() => parseViewState(search), [search]);
  const set = useCallback((patch: Partial<ViewState>) => {
    const next = { ...parseViewState(window.location.search), ...patch };
    const p = new URLSearchParams(window.location.search);
    const put = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k));
    put('tags', next.tags.join(','));
    put('imp', next.importance.join(','));
    put('projects', next.projects.join(','));
    put('sort', next.sort === 'urgency' ? '' : next.sort);
    put('done', next.showDone ? '1' : '');
    const qs = p.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    window.dispatchEvent(new Event(EVT));
  }, []);
  return [state, set];
}
