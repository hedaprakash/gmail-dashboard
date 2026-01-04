import { useRef, useState, useCallback } from 'react';
import type { EmailPattern } from '../../hooks/useEmails';
import { formatDateRange } from '../../hooks/useEmails';

interface PatternItemProps {
  pattern: EmailPattern;
  showSender?: boolean;
  onKeep: (selectedText?: string) => void;
  onDelete: (selectedText?: string) => void;
  onDelete1d: (selectedText?: string) => void;
  onDelete10d: (selectedText?: string) => void;
}

export default function PatternItem({ pattern, showSender = false, onKeep, onDelete, onDelete1d, onDelete10d }: PatternItemProps) {
  const dateDisplay = formatDateRange(pattern.minDate, pattern.maxDate, pattern.count);
  const subjectRef = useRef<HTMLSpanElement>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // Get selected text within the subject element
  const getSelectedText = useCallback((): string | undefined => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return undefined;

    const selectedText = selection.toString().trim();
    if (!selectedText) return undefined;

    // Verify selection is within our subject element
    if (subjectRef.current) {
      const range = selection.getRangeAt(0);
      if (subjectRef.current.contains(range.commonAncestorContainer)) {
        return selectedText;
      }
    }
    return undefined;
  }, []);

  // Handle selection change
  const handleSelectionChange = useCallback(() => {
    const selected = getSelectedText();
    setHasSelection(!!selected);
  }, [getSelectedText]);

  // Handle button clicks - use selected text if available
  const handleKeep = () => {
    const selected = getSelectedText();
    onKeep(selected);
    window.getSelection()?.removeAllRanges();
    setHasSelection(false);
  };

  const handleDelete = () => {
    const selected = getSelectedText();
    onDelete(selected);
    window.getSelection()?.removeAllRanges();
    setHasSelection(false);
  };

  const handleDelete1d = () => {
    const selected = getSelectedText();
    onDelete1d(selected);
    window.getSelection()?.removeAllRanges();
    setHasSelection(false);
  };

  const handleDelete10d = () => {
    const selected = getSelectedText();
    onDelete10d(selected);
    window.getSelection()?.removeAllRanges();
    setHasSelection(false);
  };

  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 pattern-item">
      {/* Category Badge */}
      <div
        className="flex flex-col items-center min-w-[50px]"
        style={{ color: pattern.categoryColor }}
      >
        <span className="text-xl">{pattern.categoryIcon}</span>
        <span className="text-xs font-medium">{pattern.category.slice(0, 4)}</span>
      </div>

      {/* Subject - selectable */}
      <div className="flex-1 min-w-0">
        {showSender && pattern.sender && (
          <span className="text-xs text-blue-600 font-medium mr-2">
            {pattern.sender}@
          </span>
        )}
        <span
          ref={subjectRef}
          className={`text-sm text-gray-900 select-text cursor-text inline-block max-w-full ${hasSelection ? 'bg-yellow-100' : ''}`}
          title={`${pattern.subject}\n\nTip: Select text to use partial match`}
          onMouseUp={handleSelectionChange}
          onKeyUp={handleSelectionChange}
        >
          {pattern.subject || '(all emails from domain)'}
        </span>
        {hasSelection && (
          <span className="ml-2 text-xs text-yellow-600 font-medium">
            (using selection)
          </span>
        )}
      </div>

      {/* Count & Date */}
      <div className="text-right min-w-[100px]">
        <a
          href={pattern.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          {pattern.count} email{pattern.count !== 1 ? 's' : ''} 🔗
        </a>
        <div className="text-xs text-gray-500">{dateDisplay}</div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-1">
        <button
          onClick={handleKeep}
          className="btn btn-keep"
          title={hasSelection ? "Keep (selected text)" : "Keep (full subject)"}
        >
          K
        </button>
        <button
          onClick={handleDelete}
          className="btn btn-delete"
          title={hasSelection ? "Delete (selected text)" : "Delete (full subject)"}
        >
          D
        </button>
        <button
          onClick={handleDelete1d}
          className="btn btn-delete-1d"
          title={hasSelection ? "Delete 1d (selected text)" : "Delete after 1 day (full subject)"}
        >
          1d
        </button>
        <button
          onClick={handleDelete10d}
          className="btn btn-delete-10d"
          title={hasSelection ? "Delete 10d (selected text)" : "Delete after 10 days (full subject)"}
        >
          10d
        </button>
      </div>
    </div>
  );
}
