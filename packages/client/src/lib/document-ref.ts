// DOC-GUARD G2 — turning a stored document URL into a route key.
//
// The API reports a document's location as it is recorded in the
// database, which is one of two shapes:
//
//   /api/documents/<uuid>              stored by DOC-GUARD onwards
//   /uploads/verification/<id>/<file>  stored before it
//
// Both are read through the single endpoint `GET /api/documents/:key`.
// A pre-dispatch path becomes `legacy.<base64url of the path>`; the
// server decodes it and then matches it against the URL columns before
// reading anything, so the encoding grants no access on its own.
//
// Keeping it to one endpoint is also what keeps the call statically
// visible: DocumentLink can write `apiFetch(`/api/documents/${ref}`)`,
// a literal the wiring audit can match to the route. A second route for
// the legacy shape could only ever have been called with a whole URL
// held in a variable, and would have shown up as an orphan.

const DOCUMENT_PREFIX = '/api/documents/';

/** base64url, without a Buffer (this runs in the WebView). */
function base64Url(value: string): string {
  // btoa is byte-oriented; encodeURIComponent first so non-ASCII in a
  // path cannot throw.
  const bytes = encodeURIComponent(value).replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  return btoa(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The `:key` to request for a document at this stored URL.
 */
export function documentRef(storedUrl: string): string {
  if (storedUrl.startsWith(DOCUMENT_PREFIX)) {
    return storedUrl.slice(DOCUMENT_PREFIX.length);
  }
  return `legacy.${base64Url(storedUrl)}`;
}
