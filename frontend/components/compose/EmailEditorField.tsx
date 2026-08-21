'use client';

import EmailEditor from './EmailEditor';

interface EmailEditorFieldProps {
  value: string;
  onChange: (html: string) => void;
  maxLength: number;
  error?: string;
}

export default function EmailEditorField({ value, onChange, maxLength, error }: EmailEditorFieldProps) {
  return (
    <div className="compose-field">
      <label className="compose-label">Email Body</label>
      <EmailEditor value={value} onChange={onChange} maxLength={maxLength} />
      {error ? <div className="compose-error">{error}</div> : null}
    </div>
  );
}