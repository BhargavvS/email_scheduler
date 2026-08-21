'use client';

interface ScheduleSettingsProps {
  startTime: string;
  delaySeconds: string;
  hourlyLimit: string;
  maxDelaySeconds: number;
  defaultDelaySeconds: number;
  maxEmailsPerHour: number;
  onChange: (field: 'startTime' | 'delaySeconds' | 'hourlyLimit', value: string) => void;
  errors: { startTime?: string; delaySeconds?: string; hourlyLimit?: string };
}

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function setToNextHour(d: Date): string {
  const next = new Date(d);
  next.setMinutes(60, 0, 0);
  return toLocalInputValue(next);
}

export default function ScheduleSettings({
  startTime,
  delaySeconds,
  hourlyLimit,
  maxDelaySeconds,
  defaultDelaySeconds,
  maxEmailsPerHour,
  onChange,
  errors,
}: ScheduleSettingsProps) {
  const now = new Date();
  const minValue = toLocalInputValue(now);
  const todayValue = setToNextHour(new Date());
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowValue = setToNextHour(tomorrow);

  return (
    <div className="schedule-settings-new">
      <div className="schedule-card-head">
        <span className="schedule-card-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg></span>
        <span className="schedule-card-title">Scheduling</span>
        <span className="schedule-card-sub">When and how fast to send</span>
      </div>

      <label className="compose-label" htmlFor="start-input">Start time</label>
      <div className="start-time-row">
        <input
          id="start-input"
          className="compose-input compose-input-datetime"
          type="datetime-local"
          min={minValue}
          value={startTime}
          onChange={(e) => onChange('startTime', e.target.value)}
        />
        <div className="start-time-quick">
          <button type="button" className="start-time-btn" onClick={() => onChange('startTime', todayValue)}>Today</button>
          <button type="button" className="start-time-btn" onClick={() => onChange('startTime', tomorrowValue)}>Tomorrow</button>
        </div>
      </div>
      {errors.startTime ? <div className="compose-error">{errors.startTime}</div> : <div className="compose-hint">Must be in the future</div>}

      <div className="schedule-grid">
        <div className="schedule-row">
          <label className="compose-label" htmlFor="delay-input">Delay</label>
          <div className="compose-input-wrap with-suffix">
            <input
              id="delay-input"
              className="compose-input compose-input-num"
              type="number"
              min={1}
              max={maxDelaySeconds}
              step={1}
              value={delaySeconds}
              placeholder={String(defaultDelaySeconds)}
              onChange={(e) => onChange('delaySeconds', e.target.value)}
            />
            <span className="input-suffix">sec</span>
          </div>
          <div className="compose-hint">Between emails</div>
          {errors.delaySeconds ? <div className="compose-error">{errors.delaySeconds}</div> : null}
        </div>

        <div className="schedule-row">
          <label className="compose-label" htmlFor="limit-input">Hourly limit</label>
          <div className="compose-input-wrap with-suffix">
            <input
              id="limit-input"
              className="compose-input compose-input-num"
              type="number"
              min={1}
              max={maxEmailsPerHour}
              step={1}
              value={hourlyLimit}
              placeholder="—"
              onChange={(e) => onChange('hourlyLimit', e.target.value)}
            />
            <span className="input-suffix">/ hr</span>
          </div>
          <div className="compose-hint">Max {maxEmailsPerHour}/hr</div>
          {errors.hourlyLimit ? <div className="compose-error">{errors.hourlyLimit}</div> : null}
        </div>
      </div>
    </div>
  );
}