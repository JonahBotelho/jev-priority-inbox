// Connected mailbox contracts. Credentials are accepted only during connection.
import type { Tier } from './types.js';

export interface ServerSettings { host: string; port: number; user: string; password: string }
export interface ManualSettings { email: string; imap: ServerSettings; smtp: ServerSettings }
export interface MailCard { id: string; subject: string; receivedAt: string; tier: Tier | null; handled: boolean; preview?: string }
export interface MailDetail { subject: string; text: string; from: string; receivedAt: string;
  replyTo?: string; messageId?: string; references?: string[]; threadId?: string }
export interface ComposeInput { submissionId: string; to: string; cc: string; bcc: string; subject: string;
  text: string; replyToId?: string }
export interface SendResult { status: 'sending' | 'sent' | 'partial' | 'failed' | 'unknown'; rejected?: string[] }
export interface MailStatus { id: string; email: string; error: string | null; lastSync: string | null; hasOlder: boolean }
