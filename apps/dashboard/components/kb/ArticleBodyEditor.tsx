'use client';

import { useEffect, useRef } from 'react';

/**
 * contenteditable body field. innerHTML is written only when `initialHtml`
 * changes from the server — never from the live onInput value. Re-applying
 * innerHTML on every keystroke resets the caret to the start of the node, so
 * typed English appears to grow rightward from a stuck left-edge cursor.
 */
export function ArticleBodyEditor({
  initialHtml,
  onChange,
}: {
  initialHtml?: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const applied = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialHtml === undefined || applied.current === initialHtml) return;
    applied.current = initialHtml;
    if (ref.current && ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml;
    }
  }, [initialHtml]);

  return (
    <div className="border-divider rounded-large border">
      <div className="border-divider bg-content2 flex flex-wrap gap-1 border-b p-2">
        {(['bold', 'italic', 'underline'] as const).map((cmd) => (
          <button
            key={cmd}
            type="button"
            className="rounded px-2 py-1 text-sm hover:bg-content3"
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand(cmd);
            }}
          >
            {cmd === 'bold' ? <b>B</b> : cmd === 'italic' ? <i>I</i> : <u>U</u>}
          </button>
        ))}
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-content3"
          onMouseDown={(e) => {
            e.preventDefault();
            document.execCommand('insertUnorderedList');
          }}
        >
          • List
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-sm hover:bg-content3"
          onMouseDown={(e) => {
            e.preventDefault();
            document.execCommand('insertOrderedList');
          }}
        >
          1. List
        </button>
      </div>
      <div
        ref={ref}
        dir="ltr"
        className="prose min-h-64 p-4 text-left text-sm focus:outline-none"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Write your article here…"
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
      />
    </div>
  );
}
