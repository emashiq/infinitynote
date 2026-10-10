/** Part names of Open Packaging Conventions packages (Office files), shared by main's text reader and the editors. */

/** The relationships part of a part (`ppt/slides/_rels/slide1.xml.rels` for `ppt/slides/slide1.xml`). */
export function relsPartOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** The part a relationship target of `source` names: relative to the source's folder, or absolute from the root. */
export function resolveTarget(source: string, target: string): string {
  const out = target.startsWith('/') ? [] : source.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/** The relative target from `source` to `part`, as Office writes it (`../notesSlides/notesSlide1.xml`). */
export function relativeTarget(source: string, part: string): string {
  const from = source.split('/').slice(0, -1);
  const to = part.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1;
  return [...Array<string>(from.length - common).fill('..'), ...to.slice(common)].join('/');
}
