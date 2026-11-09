import { REPLY_TEMPLATES, type ReplyTemplateKey } from './config';

/**
 * Looks up a reply template and substitutes a single ${id} token if present.
 * Pure function — used by handlers and dispatcher to keep template resolution
 * in one place.
 */
export function compose(key: ReplyTemplateKey, id?: string): string {
  const tpl = REPLY_TEMPLATES[key];
  if (!id) return tpl;
  return tpl.replace('${id}', id);
}
