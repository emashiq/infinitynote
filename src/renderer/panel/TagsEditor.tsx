import { X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { MAX_TAGS_PER_NOTE, normalizeTag, TAG_MESSAGES } from '../../shared/contracts/tags';
import { useServices } from '../state/use-store';

/** The note's tags in the Info section (INF-HIER-11): chips with Remove, and an input that adds on Enter. */
export function TagsEditor({ noteId }: { noteId: string }) {
  const { bridge, notices } = useServices();
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  useEffect(() => {
    let stale = false;
    void bridge.tags.list({ noteId }).then((res) => {
      if (!stale && res.ok) setTags(res.data.tags.map((t) => t.name));
    });
    return () => {
      stale = true;
    };
  }, [bridge, noteId]);

  const save = async (next: string[]) => {
    const res = await bridge.tags.set({ noteId, tags: next });
    if (res.ok) setTags(res.data.tags);
    else notices.push(res.error.message, 'error');
  };

  const add = () => {
    const tag = normalizeTag(draft);
    if (tag === null) {
      setError(TAG_MESSAGES.invalid);
      return;
    }
    setDraft('');
    if (tags.includes(tag)) return;
    if (tags.length >= MAX_TAGS_PER_NOTE) {
      setError(TAG_MESSAGES.tooMany);
      return;
    }
    void save([...tags, tag]);
  };

  return (
    <div className="tags-editor">
      <label htmlFor={inputId} className="field-label">
        Tags
      </label>
      {tags.length > 0 ? (
        <ul className="tag-list" aria-label="Tags">
          {tags.map((tag) => (
            <li key={tag} className="tag-chip">
              <span>#{tag}</span>
              <button type="button" className="tag-remove" aria-label={`Remove tag ${tag}`} title={`Remove tag ${tag}`} onClick={() => void save(tags.filter((t) => t !== tag))}>
                <X size={12} strokeWidth={1.75} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <input
        id={inputId}
        className="text-input"
        value={draft}
        placeholder="Add tag"
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (draft.trim() !== '') add();
          }
        }}
      />
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
