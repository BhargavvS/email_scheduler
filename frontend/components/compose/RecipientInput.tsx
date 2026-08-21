'use client';

import { useState } from 'react';

interface RecipientInputProps {
  recipients: string[];
  onAdd: (email: string) => boolean;
  onRemove: (email: string) => void;
  error?: string;
}

export default function RecipientInput({ recipients, onAdd, onRemove, error }: RecipientInputProps) {
  const [draft, setDraft] = useState('');

  function commit() {
    const ok = onAdd(draft);
    if (ok) setDraft('');
  }

  return (
    <div className="compose-field">
      <div className="compose-label-row">
        <label className="compose-label" htmlFor="recipient-input">
          Recipients
        </label>
        {recipients.length > 0 ? <span className="compose-count pill">{recipients.length} added</span> : <span className="compose-count muted">Add emails or upload a file below</span>}
      </div>
      <div className="recipient-box">
        {recipients.map((email) => (
          <span key={email} className="recipient-chip">
            {email}
            <button
              type="button"
              className="recipient-chip-x"
              aria-label={`Remove ${email}`}
              onClick={() => onRemove(email)}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id="recipient-input"
          className="recipient-input"
          type="email"
          placeholder={recipients.length === 0 ? 'Type an email and press Enter' : 'Add another…'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Backspace' && !draft && recipients.length > 0) {
              onRemove(recipients[recipients.length - 1]);
            }
          }}
          onBlur={() => {
            if (draft.trim()) commit();
          }}
        />
      </div>
      {error ? <div className="compose-error">{error}</div> : null}
    </div>
  );
}