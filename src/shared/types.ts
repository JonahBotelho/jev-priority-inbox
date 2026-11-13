// Shared API contracts. Provider scores never cross the inbox API boundary.
export type Tier = 'Emergency' | 'Urgent' | 'Routine';
export interface Probabilities { Emergency: number; Urgent: number; Routine: number }
export interface Card { id: string; tier: Tier; subject: string; receivedAt: string }
export interface Snapshot { cards: Card[]; processing: { pending: number; failed: number } }
export interface Message { subject: string; text: string; from: string; receivedAt: string }
export interface ClassificationInput { subject: string; text: string; receivedAt: string; role: string; timeZone: string }
