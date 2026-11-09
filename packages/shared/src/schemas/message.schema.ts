import { z } from 'zod';
import { MAX_MESSAGE_LENGTH } from '../constants/config.js';

export const createMessageSchema = z.object({
  journeyId: z.string().uuid(),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  isQuickMessage: z.boolean().optional().default(false),
  quickMessageId: z.string().optional(),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;
