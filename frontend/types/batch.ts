export interface Sender {
  id: string;
  name: string;
  email: string;
}

export interface AttachmentLimits {
  maxFiles: number;
  maxFileSizeBytes: number;
  maxTotalSizeBytes: number;
  allowedTypes: string[];
}

export interface SchedulerConfig {
  minDelayMs: number;
  maxDelayMs: number;
  defaultDelayMs: number;
  maxRecipientsPerBatch: number;
  maxEmailsPerHour: number;
  maxEmailsPerHourPerSender: number;
  subjectMaxLength: number;
  bodyMaxLength: number;
  attachments: AttachmentLimits;
}

export interface AttachmentItem {
  name: string;
  contentType: string;
  size: number;
  dataBase64: string;
}

export interface CreateBatchRequest {
  recipients: string[];
  subject: string;
  body: string;
  startTime: string;
  delayMs: number;
  hourlyLimit?: number;
  attachments?: AttachmentItem[];
}

export interface CreateBatchResponse {
  batchId: string;
  status: 'scheduled' | 'partially_enqueued';
  totalRecipients: number;
  validRecipients: number;
  invalidEmailsSkipped: number;
  duplicatesRemoved: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  idempotent: boolean;
}

export type EmailJobStatus = 'pending' | 'queued' | 'processing' | 'sent' | 'failed';

export interface EmailSenderRef {
  id: string;
  name: string;
  email: string;
}

export interface EmailJob {
  id: string;
  batchId: string;
  senderId: string | null;
  recipient: string;
  subject: string;
  body: string;
  fromEmail: string | null;
  attachments: AttachmentItem[] | null;
  scheduledAt: string;
  status: EmailJobStatus;
  bullmqJobId: string | null;
  sentAt: string | null;
  error: string | null;
  attempts: number;
  rescheduleCount: number;
  previewUrl: string | null;
  createdAt: string;
  updatedAt: string;
  sender: EmailSenderRef | null;
}

export interface EmailJobsPage {
  data: EmailJob[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}