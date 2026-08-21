'use client';

import { useRef } from 'react';

import type { RecipientStats } from '@/hooks/useComposeEmail';

interface LeadUploaderProps {
  isParsing: boolean;
  stats: RecipientStats;
  onFile: (file: File) => Promise<void>;
}

export default function LeadUploader({ isParsing, stats, onFile }: LeadUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void onFile(file);
    e.target.value = '';
  }

  return (
    <div className="lead-uploader-new">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="lead-upload-input"
        onChange={handleChange}
      />
      <button
        type="button"
        className="lead-dropzone"
        onClick={() => inputRef.current?.click()}
        disabled={isParsing}
      >
        <span className="lead-dropzone-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><polyline points="9 15 12 12 15 15" /></svg>
        </span>
        <span className="lead-dropzone-text">
          <strong>{isParsing ? 'Reading…' : 'Upload CSV / TXT'}</strong>
          <span>Drag & drop or click to browse — we’ll auto-detect the email column</span>
        </span>
      </button>

      {stats.lastFileName ? (
        <div className={`lead-stat ${stats.missingEmailColumn ? 'is-error' : 'is-ok'}`}>
          <span className="lead-stat-dot" />
          <div>
            <div className="lead-stat-file">{stats.lastFileName}</div>
            {stats.missingEmailColumn ? (
              <div className="lead-stat-detail error">Could not find an email column.</div>
            ) : (
              <div className="lead-stat-detail">
                {stats.valid > 0 ? `${stats.valid} valid` : 'No valid emails'}
                {stats.invalid > 0 ? ` · ${stats.invalid} invalid` : ''}
                {stats.duplicatesRemoved > 0 ? ` · ${stats.duplicatesRemoved} dupes removed` : ''}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}