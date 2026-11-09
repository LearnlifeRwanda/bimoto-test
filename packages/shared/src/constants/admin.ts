// Shared admin moderation constants. Both server and client import from here
// so the reason-length minimum stays in sync. The server's runtime value is
// still env-overridable in services/admin/config.ts; this is the floor the
// client UI uses to enable the submit button.

export const ADMIN_REASON_MIN_LENGTH = 10;
