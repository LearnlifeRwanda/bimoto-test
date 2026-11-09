import { NOTIFICATION_STRINGS, type NotificationEventKey } from '@bimoto/shared';
import type { Language } from '@prisma/client';
import prisma from '../../prisma';
import type { PushPayload, PushPayloadData } from './types';

const FALLBACK_LANGUAGE: Language = 'en' as Language;

function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined ? match : String(v);
  });
}

export interface BuildPayloadOptions {
  language: Language;
  vars?: Record<string, string | number>;
  data: PushPayloadData;
}

export function buildPushPayload(
  event: NotificationEventKey,
  opts: BuildPayloadOptions,
): PushPayload {
  const langCode = (opts.language ?? FALLBACK_LANGUAGE) as 'en' | 'rw' | 'fr';
  const langStrings =
    NOTIFICATION_STRINGS[langCode] ?? NOTIFICATION_STRINGS[FALLBACK_LANGUAGE as 'en'];
  const eventStrings =
    langStrings[event] ?? NOTIFICATION_STRINGS[FALLBACK_LANGUAGE as 'en'][event];

  return {
    title: interpolate(eventStrings.title, opts.vars),
    body: interpolate(eventStrings.body, opts.vars),
    data: opts.data,
  };
}

// Best-effort lookup of the recipient's language. Falls back to the
// schema default ('en') if the user is gone or the query fails — push
// helpers must never throw out of notification.service.ts.
export async function getUserLanguage(userId: string): Promise<Language> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { language: true },
    });
    return (u?.language ?? FALLBACK_LANGUAGE) as Language;
  } catch {
    return FALLBACK_LANGUAGE;
  }
}
