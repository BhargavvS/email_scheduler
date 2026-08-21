'use client';

interface ScheduleButtonProps {
  isSubmitting: boolean;
  disabled: boolean;
  onClick: () => void;
}

export default function ScheduleButton({ isSubmitting, disabled, onClick }: ScheduleButtonProps) {
  return (
    <button type="button" className="schedule-btn-new" disabled={disabled || isSubmitting} onClick={onClick}>
      <span className="schedule-btn-icon">
        {isSubmitting ? (
          <span className="spinner" aria-hidden />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
        )}
      </span>
      {isSubmitting ? 'Scheduling…' : 'Schedule campaign'}
    </button>
  );
}