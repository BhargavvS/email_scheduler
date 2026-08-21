'use client';

import { useRef } from 'react';

import type { AttachmentItem, AttachmentLimits } from '@/types/batch';
import { PaperclipIcon } from '@/components/ui/Icons';

interface AttachmentUploaderProps {
  attachments: AttachmentItem[];
  limits: AttachmentLimits;
  onAdd: (files: FileList | File[]) => void;
  onRemove: (name: string) => void;
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentUploader({
  attachments,
  limits,
  onAdd,
  onRemove,
  error,
}: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const maxMb = Math.round(limits.maxFileSizeBytes / 1024 / 1024);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) onAdd(files);
    e.target.value = '';
  }

  return (
    <div className="compose-field">
      <div className="compose-label-row">
        <label className="compose-label">Attachments</label>
        <span className="compose-count">{attachments.length}/{limits.maxFiles} · {maxMb} MB max</span>
      </div>
      <div className="attachment-uploader-new">
        <input ref={inputRef} type="file" multiple className="attachment-upload-input" onChange={handleChange} />
        <button type="button" className="attachment-drop" onClick={() => inputRef.current?.click()} disabled={attachments.length >= limits.maxFiles}>
          <PaperclipIcon size={16} />
          <span>{attachments.length >= limits.maxFiles ? 'Limit reached' : 'Drop files or click to attach'}</span>
        </button>
      </div>

      {attachments.length > 0 ? (
        <ul className="attachment-list">
          {attachments.map((a) => (
            <li key={a.name} className="attachment-item">
              <PaperclipIcon size={14} />
              <span className="attachment-name" title={a.name}>
                {a.name}
              </span>
              <span className="attachment-size">{formatSize(a.size)}</span>
              <button
                type="button"
                className="attachment-remove"
                aria-label={`Remove ${a.name}`}
                onClick={() => onRemove(a.name)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <div className="compose-error">{error}</div> : null}
    </div>
  );
}