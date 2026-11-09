// Mock the evaluator before the cascade-integration import pulls it in.
jest.mock('../evaluator', () => ({
  evaluateRulesForJourney: jest.fn(),
}));

import {
  _setLoggerForTests,
  evaluateAutoBidsForRingDrivers,
} from '../cascade-integration';
import * as evaluatorMock from '../evaluator';

const mockedEvaluator = evaluatorMock.evaluateRulesForJourney as jest.Mock;

function fakePrisma(): any {
  return {} as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  _setLoggerForTests({ warn: jest.fn() });
});

describe('auto-bid/cascade-integration — evaluateAutoBidsForRingDrivers', () => {
  it('returns one result per driver — 2 fired, 1 no-match', async () => {
    mockedEvaluator
      .mockImplementationOnce(async (_p, driverId, journeyId) => ({
        fired: true,
        bidAmount: 1500,
        bidId: 'b1',
        ruleId: 'r1',
        driverId,
        journeyId,
        reason: 'fired',
      }))
      .mockImplementationOnce(async (_p, driverId, journeyId) => ({
        fired: false,
        bidAmount: null,
        bidId: null,
        ruleId: null,
        driverId,
        journeyId,
        reason: 'no-match',
      }))
      .mockImplementationOnce(async (_p, driverId, journeyId) => ({
        fired: true,
        bidAmount: 2000,
        bidId: 'b3',
        ruleId: 'r3',
        driverId,
        journeyId,
        reason: 'fired',
      }));

    const results = await evaluateAutoBidsForRingDrivers(
      fakePrisma(),
      'j1',
      ['d1', 'd2', 'd3'],
      null,
    );
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.fired)).toHaveLength(2);
    expect(results.find((r) => r.driverId === 'd2')?.reason).toBe('no-match');
  });

  it('one driver throwing does NOT abort the others', async () => {
    mockedEvaluator
      .mockImplementationOnce(async (_p, driverId, journeyId) => ({
        fired: true,
        bidAmount: 1500,
        bidId: 'b1',
        ruleId: 'r1',
        driverId,
        journeyId,
        reason: 'fired',
      }))
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async (_p, driverId, journeyId) => ({
        fired: true,
        bidAmount: 2000,
        bidId: 'b3',
        ruleId: 'r3',
        driverId,
        journeyId,
        reason: 'fired',
      }));

    const results = await evaluateAutoBidsForRingDrivers(
      fakePrisma(),
      'j1',
      ['d1', 'd2', 'd3'],
      null,
    );
    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.fired)).toHaveLength(2);
    // d2 caught the throw and surfaces a no-match fallback.
    expect(results.find((r) => r.driverId === 'd2')?.reason).toBe('no-match');
  });

  it('all three drivers rate-limited returns 3 rate-limited results', async () => {
    mockedEvaluator.mockImplementation(async (_p, driverId, journeyId) => ({
      fired: false,
      bidAmount: null,
      bidId: null,
      ruleId: null,
      driverId,
      journeyId,
      reason: 'rate-limited',
    }));
    const results = await evaluateAutoBidsForRingDrivers(
      fakePrisma(),
      'j1',
      ['d1', 'd2', 'd3'],
      null,
    );
    expect(results.every((r) => r.reason === 'rate-limited')).toBe(true);
  });

  it('empty driver list returns empty array (no evaluator call)', async () => {
    const results = await evaluateAutoBidsForRingDrivers(
      fakePrisma(),
      'j1',
      [],
      null,
    );
    expect(results).toEqual([]);
    expect(mockedEvaluator).not.toHaveBeenCalled();
  });

  it('hung evaluator times out and the batch resolves', async () => {
    process.env.K2_CASCADE_TIMEOUT_MS = '50';
    jest.resetModules();
    // Re-import with the smaller timeout in effect.
    jest.doMock('../evaluator', () => ({
      evaluateRulesForJourney: jest.fn(
        () => new Promise(() => { /* never resolves */ }),
      ),
    }));
    const mod = require('../cascade-integration');
    const warnSpy = jest.fn();
    mod._setLoggerForTests({ warn: warnSpy });
    const results = await mod.evaluateAutoBidsForRingDrivers(
      fakePrisma(),
      'j1',
      ['d1', 'd2'],
      null,
    );
    expect(results).toHaveLength(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[K2] auto-bid cascade-integration timeout',
      expect.objectContaining({ journeyId: 'j1' }),
    );
    delete process.env.K2_CASCADE_TIMEOUT_MS;
  });
});
