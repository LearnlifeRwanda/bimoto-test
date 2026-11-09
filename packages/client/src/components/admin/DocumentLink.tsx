// DOC-GUARD G2 — how the admin review surface opens a document now.
//
// It used to be `<a href={v.drivingLicensePhotoUrl} target="_blank">`.
// Two things made that stop working the moment documents required
// authentication:
//
//   1. A browser navigating to an href sends no Authorization header,
//      and this client authenticates with a Bearer token held in
//      memory (lib/api.ts injects it per request). An anchor cannot
//      carry it, so the request would arrive anonymous — which the new
//      route answers with 404, correctly.
//   2. The href was a RELATIVE path, so it resolved against the client
//      origin, not the API's. That was already broken anywhere the two
//      differ (dev on :5173 vs :3000, and the packaged app); it only
//      ever worked behind the nginx block in docs/DEPLOYMENT.md that
//      proxies /uploads to the API.
//
// So the document is fetched through apiFetch — same token, same
// refresh-on-401 handling as every other call — and rendered from an
// object URL. The reviewer clicks the same words in the same place and
// sees the same document; it opens in the page rather than a tab
// because a popup opened after an await is exactly the thing browsers
// block.

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { documentRef } from '../../lib/document-ref';

interface DocumentLinkProps {
  /** The stored URL, as the API reported it. */
  url: string;
  label: string;
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; objectUrl: string; contentType: string }
  | { status: 'error'; message: string };

export function DocumentLink({ url, label }: DocumentLinkProps) {
  const [state, setState] = useState<State>({ status: 'idle' });

  // An object URL holds the decrypted document in memory until it is
  // revoked. The ref is what the unmount cleanup can still see.
  const objectUrlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  useEffect(() => release, [release]);

  const open = useCallback(async () => {
    // Second click hides it again, and drops the decrypted bytes.
    if (state.status === 'ready') {
      release();
      setState({ status: 'idle' });
      return;
    }
    if (state.status === 'loading') return;

    setState({ status: 'loading' });

    try {
      const res = await apiFetch(`/api/documents/${documentRef(url)}`);
      if (!res.ok) {
        // 404 here means "no such document, or not yours" — the route
        // deliberately does not distinguish them.
        setState({
          status: 'error',
          message:
            res.status === 404
              ? 'Not available (missing, or not permitted).'
              : `Could not load document (${res.status}).`,
        });
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      setState({
        status: 'ready',
        objectUrl,
        contentType: blob.type || 'application/octet-stream',
      });
    } catch {
      setState({ status: 'error', message: 'Could not load document.' });
    }
  }, [url, state.status, release]);

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={open}
        className="text-blue-500 text-sm block underline"
      >
        {state.status === 'ready' ? `Hide ${label}` : `View ${label}`}
      </button>

      {state.status === 'loading' && (
        <div className="text-xs text-gray-500">Loading…</div>
      )}

      {state.status === 'error' && (
        <div className="text-xs text-red-600">{state.message}</div>
      )}

      {state.status === 'ready' &&
        (state.contentType === 'application/pdf' ? (
          // A scanner-app licence arrives as a PDF; it has to be
          // readable in the review surface like any other document.
          <iframe
            src={state.objectUrl}
            title={label}
            className="mt-1 w-full h-96 border rounded"
          />
        ) : (
          <img
            src={state.objectUrl}
            alt={label}
            className="mt-1 max-w-full max-h-96 border rounded"
          />
        ))}
    </div>
  );
}
