import { useLayoutEffect, type RefObject } from 'react';

/** Temporary Phase 02 editor (D-048): a plain textarea that Phase 03 replaces with the rich editor. */
export function TempTextEditor({
  text,
  readOnly,
  scrollTop,
  onChange,
  onBlur,
  onScroll,
  textareaRef,
}: {
  text: string;
  readOnly: boolean;
  scrollTop: number;
  onChange: (text: string) => void;
  onBlur: () => void;
  onScroll: (px: number) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  useLayoutEffect(() => {
    if (textareaRef.current && scrollTop > 0) textareaRef.current.scrollTop = scrollTop;
    // restore once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <textarea
      ref={textareaRef}
      aria-label="Note text"
      className="temp-editor"
      value={text}
      readOnly={readOnly}
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onScroll={(e) => onScroll(Math.round((e.target as HTMLTextAreaElement).scrollTop))}
    />
  );
}
