import { z } from 'zod';
import { Uuid } from './ids';

/** Tags are small search filters (INF-HIER-11, ARCHITECTURE section 3). */
export const MAX_TAGS_PER_NOTE = 20;
export const MAX_TAG_LENGTH = 32;

export const TAG_MESSAGES = {
  invalid: `Use 1-${MAX_TAG_LENGTH} letters or digits without spaces`,
  tooMany: `A note can have at most ${MAX_TAGS_PER_NOTE} tags`,
} as const;

/**
 * The stored form of a tag: trimmed, without a leading "#", lower case, inner spaces as "-", 1-32 characters, no
 * control characters or commas. Null when nothing valid remains.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, '').toLocaleLowerCase('en').replace(/\s+/g, '-');
  if (tag.length < 1 || tag.length > MAX_TAG_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f,#]/.test(tag)) return null;
  return tag;
}

export const TagName = z.string().refine((t) => normalizeTag(t) === t, TAG_MESSAGES.invalid);

export const TagInfo = z.strictObject({ name: TagName, count: z.number().int().min(0) });
export type TagInfoType = z.infer<typeof TagInfo>;

/** With a note: that note's tags; without: every tag with its number of live notes. */
export const TagsListRequest = z.strictObject({ noteId: Uuid.optional() });
export const TagsListResponse = z.strictObject({ tags: z.array(TagInfo) });

export const TagsSetRequest = z.strictObject({ noteId: Uuid, tags: z.array(TagName).max(MAX_TAGS_PER_NOTE) });
export const TagsSetResponse = z.strictObject({ tags: z.array(TagName).max(MAX_TAGS_PER_NOTE) });
