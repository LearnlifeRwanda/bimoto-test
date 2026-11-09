// DOC-GUARD G5 — the admin review surface reaches documents with the
// admin's credentials.
//
// The three anchors this replaced could not: a browser navigating to an
// href sends no Authorization header, and this client holds its access
// token in memory. The relative href also resolved against the CLIENT
// origin rather than the API's, so it was already broken anywhere the
// two differ.

import { describe, test, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DocumentLink } from '../DocumentLink';
import { documentRef } from '../../../lib/document-ref';

const NEW_URL = '/api/documents/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LEGACY_URL = '/uploads/verification/driver-1/driving-license.jpg';

let fetchMock: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

function mockFetch(type = 'image/jpeg', status = 200) {
  fetchMock = vi.fn(async () => ({
    ok: status === 200,
    status,
    blob: async () => new Blob(['bytes'], { type }),
  }));
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  mockFetch();
  // jsdom implements the URL class but not the object-URL statics.
  // Patched onto the real class rather than replacing it, so the rest
  // of URL keeps working.
  revokeObjectURL = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = revokeObjectURL;
});

afterEach(() => vi.unstubAllGlobals());

describe('documentRef', () => {
  test('passes a DOC-GUARD document through as its bare key', () => {
    expect(documentRef(NEW_URL)).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  test('encodes a pre-dispatch storage path so one endpoint serves both', () => {
    const ref = documentRef(LEGACY_URL);

    expect(ref.startsWith('legacy.')).toBe(true);
    // base64url: no '+', no '/', no padding — it has to survive being a
    // single path segment.
    expect(ref.slice('legacy.'.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(atob(ref.slice('legacy.'.length).replace(/-/g, '+').replace(/_/g, '/'))).toBe(
      LEGACY_URL,
    );
  });
});

describe('DocumentLink', () => {
  test('fetches through the API helper, not a bare anchor', async () => {
    render(<DocumentLink url={NEW_URL} label="License Photo" />);

    fireEvent.click(screen.getByRole('button', { name: /view license photo/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [calledUrl, init] = fetchMock.mock.calls[0];

    // The path the wiring audit matches to GET /api/documents/:key.
    expect(String(calledUrl)).toContain(
      '/api/documents/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
    // apiFetch attaches credentials; an <a href> never could.
    expect((init as RequestInit).credentials).toBe('include');
  });

  test('requests a pre-dispatch document through the same endpoint', async () => {
    render(<DocumentLink url={LEGACY_URL} label="License Photo" />);

    fireEvent.click(screen.getByRole('button', { name: /view license photo/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/api/documents/${documentRef(LEGACY_URL)}`,
    );
  });

  test('renders an image once it arrives', async () => {
    render(<DocumentLink url={NEW_URL} label="License Photo" />);
    fireEvent.click(screen.getByRole('button', { name: /view license photo/i }));

    await waitFor(() => expect(screen.getByAltText('License Photo')).toBeTruthy());
  });

  test('renders a PDF in a frame — the scanner-app licence stays readable', async () => {
    mockFetch('application/pdf');
    render(<DocumentLink url={NEW_URL} label="License Photo" />);
    fireEvent.click(screen.getByRole('button', { name: /view license photo/i }));

    await waitFor(() =>
      expect(screen.getByTitle('License Photo').tagName.toLowerCase()).toBe('iframe'),
    );
  });

  test('says plainly when the document is not available', async () => {
    mockFetch('image/jpeg', 404);
    render(<DocumentLink url={NEW_URL} label="License Photo" />);
    fireEvent.click(screen.getByRole('button', { name: /view license photo/i }));

    // 404 is the server refusing to distinguish "gone" from "not yours",
    // so the copy must not claim to know which.
    await waitFor(() => expect(screen.getByText(/not available/i)).toBeTruthy());
  });

  test('hides the document again, releasing the decrypted bytes', async () => {
    render(<DocumentLink url={NEW_URL} label="License Photo" />);
    fireEvent.click(screen.getByRole('button', { name: /view license photo/i }));
    await waitFor(() => expect(screen.getByAltText('License Photo')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /hide license photo/i }));

    await waitFor(() => expect(screen.queryByAltText('License Photo')).toBeNull());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
  });
});
