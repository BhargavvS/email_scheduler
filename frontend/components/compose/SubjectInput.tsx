'use client';

interface SubjectInputProps {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  error?: string;
}

export default function SubjectInput({ value, onChange, maxLength, error }: SubjectInputProps) {
  return (
    <div className="compose-field">
      <div className="compose-label-row">
        <label className="compose-label" htmlFor="subject-input">Subject line</label>
        <span className="compose-count">{value.length}/{maxLength}</span>
      </div>
      <div className="compose-input-wrap has-icon">
        <span className="compose-input-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16" /><path d="M4 7l8 7 8-7" /><rect x="4" y="7" width="16" height="10" rx="2" /></svg>
        </span>
        <input
          id="subject-input"
          className="compose-input"
          type="text"
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Quick intro — loved your work at Acme"
        />
      </div>
      {error ? <div className="compose-error">{error}</div> : null}
    </div>
  );
}