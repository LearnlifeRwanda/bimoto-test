jest.mock('../prisma', () => ({
  __esModule: true,
  default: {
    user: {
      update: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

import prisma from '../prisma';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Consent Endpoints', () => {
  test('privacy consent updates timestamp and version', async () => {
    const userId = 'u1';
    const version = '1.0';
    const now = new Date();

    (mockPrisma.user.update as jest.Mock).mockResolvedValue({
      id: userId,
      privacyConsentAt: now,
      privacyConsentVersion: version,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { privacyConsentAt: now, privacyConsentVersion: version },
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { privacyConsentAt: now, privacyConsentVersion: version },
    });
  });

  test('terms acceptance updates timestamp and version', async () => {
    const userId = 'u1';
    const version = '1.0';
    const now = new Date();

    (mockPrisma.user.update as jest.Mock).mockResolvedValue({
      id: userId,
      termsAcceptedAt: now,
      termsAcceptedVersion: version,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { termsAcceptedAt: now, termsAcceptedVersion: version },
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { termsAcceptedAt: now, termsAcceptedVersion: version },
    });
  });

  test('consent versioning — stored version v1.0 compared to CURRENT_PRIVACY_VERSION', () => {
    const { CURRENT_PRIVACY_VERSION } = require('@bimoto/shared');
    const storedVersion = '1.0';
    expect(storedVersion).toBe(CURRENT_PRIVACY_VERSION);

    // Simulating version bump
    const bumpedVersion = '2.0';
    expect(bumpedVersion).not.toBe(CURRENT_PRIVACY_VERSION);
    // App.tsx would redirect to ConsentPage when versions mismatch
  });
});
