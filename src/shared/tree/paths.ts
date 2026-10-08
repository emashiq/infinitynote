import { COMMON_LABEL, normalizeName } from '../names';

export interface PathProject {
  id: string;
  name: string;
  createdAt: number;
}
export interface PathFolder {
  id: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  createdAt: number;
}

/** Project or folder id -> display path segments. */
export type PathIndex = ReadonlyMap<string, string[]>;

export const MAX_PATH_DEPTH = 64;

type Named = { id: string; name: string; createdAt: number };

/** Returns id -> display segment, adding " (2)", " (3)" to later siblings with the same normalized name. */
function disambiguate(siblings: Named[]): Map<string, string> {
  const groups = new Map<string, Named[]>();
  for (const s of siblings) {
    const key = normalizeName(s.name).toLocaleLowerCase();
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    g.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    g.forEach((s, i) => out.set(s.id, i === 0 ? s.name : `${s.name} (${i + 1})`));
  }
  return out;
}

/**
 * Builds id -> path for every project and folder. A project path is [segment]; a folder path is
 * [project segment or "Common", ...ancestor folder segments, own segment].
 */
export function buildPathIndex(projects: readonly PathProject[], folders: readonly PathFolder[]): PathIndex {
  const segments = new Map<string, string>();
  for (const [id, seg] of disambiguate([...projects])) segments.set(id, seg);

  const byScope = new Map<string, Named[]>();
  for (const f of folders) {
    const key = `${f.projectId ?? 'common'}|${f.parentId ?? 'root'}`;
    const list = byScope.get(key);
    if (list) list.push(f);
    else byScope.set(key, [f]);
  }
  for (const list of byScope.values()) for (const [id, seg] of disambiguate(list)) segments.set(id, seg);

  const folderById = new Map(folders.map((f) => [f.id, f]));
  const index = new Map<string, string[]>();
  for (const p of projects) index.set(p.id, [segments.get(p.id) ?? p.name]);
  for (const f of folders) {
    const chain: string[] = [];
    let cur: PathFolder | undefined = f;
    let depth = 0;
    while (cur && depth < MAX_PATH_DEPTH) {
      chain.unshift(segments.get(cur.id) ?? cur.name);
      if (cur.parentId === null) break;
      cur = folderById.get(cur.parentId);
      depth += 1;
    }
    const root = f.projectId === null ? COMMON_LABEL : (segments.get(f.projectId) ?? '');
    index.set(f.id, [root, ...chain]);
  }
  return index;
}

/** Path of a note or new-item location: its folder's path, else the scope root. */
export function pathOf(index: PathIndex, location: { projectId: string | null; folderId: string | null }): string[] {
  if (location.folderId !== null) {
    const p = index.get(location.folderId);
    if (p) return p;
  }
  if (location.projectId !== null) {
    const p = index.get(location.projectId);
    if (p) return p;
  }
  return [COMMON_LABEL];
}
