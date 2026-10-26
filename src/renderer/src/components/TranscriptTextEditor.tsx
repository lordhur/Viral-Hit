import { useState } from "react";
import { LuCheck, LuX } from "react-icons/lu";
import { useT } from "../i18n/store";

/** Explicit subtitle correction controls; no hover-only or ambiguous blur save. */
export function TranscriptTextEditor({ initialText, onSave, onCancel }: {
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const t = useT("transcribe");
  const [draft, setDraft] = useState(initialText);
  const save = (): void => { if (draft.trim()) onSave(draft); };

  return (
    <div className="min-w-0 flex-1">
      <textarea
        autoFocus
        aria-label={t("editSegment")}
        value={draft}
        maxLength={8000}
        rows={2}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault(); save();
          }
        }}
        className="min-h-12 w-full resize-y rounded-lg border border-ember/60 bg-panel px-2.5 py-2 text-[13px] leading-relaxed outline-none focus:border-ember"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-[10px] text-mut/70">{t("editKeyboardHint")}</span>
        <button type="button" disabled={!draft.trim()} onClick={save} className="btn-flame inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-40">
          <LuCheck className="h-3 w-3" />{t("saveEdit")}
        </button>
        <button type="button" onClick={onCancel} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-[11px] text-mut hover:text-fg">
          <LuX className="h-3 w-3" />{t("cancelEdit")}
        </button>
      </div>
    </div>
  );
}
