'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import ComposeHeader from './ComposeHeader';
import FromField from './FromField';
import RecipientInput from './RecipientInput';
import LeadUploader from './LeadUploader';
import SubjectInput from './SubjectInput';
import EmailEditorField from './EmailEditorField';
import ScheduleSettings from './ScheduleSettings';
import ScheduleButton from './ScheduleButton';
import ScheduleSummary from './ScheduleSummary';
import AttachmentUploader from './AttachmentUploader';
import { useComposeEmail } from '@/hooks/useComposeEmail';
import { useToast } from '@/components/ui/Toast';

export default function ComposePage() {
  const compose = useComposeEmail();
  const {
    user,
    state,
    config,
    load,
    recipientStats,
    fieldErrors,
    submitError,
    isParsing,
    isSubmitting,
    isSuccess,
    success,
    setField,
    addRecipient,
    removeRecipient,
    handleFile,
    addAttachments,
    removeAttachment,
    submit,
    retryLoad,
    reset,
  } = compose;
  const { toast } = useToast();

  useEffect(() => {
    if (isSuccess && success) {
      toast('success', `${success.validRecipients} recipients scheduled.`);
    }
  }, [isSuccess, success, toast]);

  useEffect(() => {
    if (submitError) toast('error', submitError);
  }, [submitError, toast]);

  const cfg = config!;

  // Non-blocking error banner — form stays usable with FALLBACK_CONFIG
  const configErrorBanner = load.error ? (
    <div className="compose-load-error">
      <p>{load.error}</p>
      <button type="button" className="schedule-retry" onClick={retryLoad}>
        Retry
      </button>
    </div>
  ) : null;

  const bodyHasContent = (() => {
    const text = state.body
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
    return text.length > 0;
  })();

  const delayNum = Number(state.delaySeconds);
  const limitNum = Number(state.hourlyLimit);
  const startOk =
    state.startTime !== '' && !Number.isNaN(new Date(state.startTime).getTime());

  const canSubmit =
    state.recipients.length > 0 &&
    state.subject.trim() !== '' &&
    bodyHasContent &&
    startOk &&
    Number.isFinite(delayNum) &&
    delayNum >= 1 &&
    !isParsing &&
    !isSubmitting &&
    (state.hourlyLimit.trim() === '' || (Number.isInteger(limitNum) && limitNum >= 1));

  if (isSuccess && success) {
    return (
      <div className="compose-success">
        <div className="compose-success-icon">✓</div>
        <h2>Batch scheduled successfully</h2>
        <p>{success.validRecipients} recipients scheduled.</p>
        <Link href="/dashboard" className="compose-success-btn">
          Back to dashboard
        </Link>
        <button type="button" className="compose-success-again" onClick={reset}>
          Compose another email
        </button>
      </div>
    );
  }

  return (
    <div className="compose-page">
      <ComposeHeader />
      {configErrorBanner}

      <div className="compose-layout">
        <div className="compose-main">
          <section className="compose-card">
            <div className="compose-card-head">
              <span className="compose-card-index">01</span>
              <div>
                <h3>Recipients</h3>
                <p>Add people you want to reach</p>
              </div>
            </div>
            <FromField user={user} />
            <RecipientInput recipients={state.recipients} onAdd={addRecipient} onRemove={removeRecipient} error={fieldErrors.recipients} />
            <LeadUploader isParsing={isParsing} stats={recipientStats} onFile={handleFile} />
          </section>

          <section className="compose-card">
            <div className="compose-card-head">
              <span className="compose-card-index">02</span>
              <div>
                <h3>Message</h3>
                <p>Subject and body — supports rich text</p>
              </div>
            </div>
            <SubjectInput value={state.subject} onChange={(subject) => setField('subject', subject)} maxLength={cfg.subjectMaxLength} error={fieldErrors.subject} />
            <EmailEditorField value={state.body} onChange={(body) => setField('body', body)} maxLength={cfg.bodyMaxLength} error={fieldErrors.body} />
          </section>

          <section className="compose-card">
            <div className="compose-card-head">
              <span className="compose-card-index">03</span>
              <div>
                <h3>Attachments</h3>
                <p>Optional files for every recipient</p>
              </div>
            </div>
            <AttachmentUploader attachments={state.attachments} limits={cfg.attachments} onAdd={addAttachments} onRemove={removeAttachment} error={fieldErrors.attachments} />
          </section>
        </div>

        <aside className="compose-side">
          <div className="compose-card compose-card--sticky">
            <ScheduleSettings
              startTime={state.startTime}
              delaySeconds={state.delaySeconds}
              hourlyLimit={state.hourlyLimit}
              maxDelaySeconds={cfg.maxDelayMs / 1000}
              defaultDelaySeconds={cfg.defaultDelayMs / 1000}
              maxEmailsPerHour={cfg.maxEmailsPerHour}
              onChange={(field, value) => setField(field, value)}
              errors={{ startTime: fieldErrors.startTime, delaySeconds: fieldErrors.delaySeconds, hourlyLimit: fieldErrors.hourlyLimit }}
            />
            <div className="compose-side-divider" />
            <ScheduleSummary recipientCount={state.recipients.length} stats={recipientStats} submitError={submitError} isSuccess={isSuccess} success={success} onRetry={submit} />
            <ScheduleButton isSubmitting={isSubmitting} disabled={!canSubmit} onClick={submit} />
            <p className="compose-footnote">Emails are scheduled on the server. You can close this tab after scheduling.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}