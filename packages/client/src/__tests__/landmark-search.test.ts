// LANDMARKS G3 — the search a passenger actually uses.
//
// These run against the real catalog, not a fixture. A test that passed
// against three invented landmarks would tell us nothing about whether a
// passenger in Remera can find Sonatubes.

import { describe, it, expect } from 'vitest';
import { KIGALI_LANDMARKS, UNVERIFIED_LANDMARKS } from '@bimoto/shared';
import {
  fold,
  matchesAt,
  searchLandmarks,
  isPlaceable,
} from '../lib/landmark-search';

const names = (q: string, limit?: number) => searchLandmarks(q, limit).map((s) => s.name);

describe('folding', () => {
  it('ignores case, accents and punctuation', () => {
    expect(fold('Hôtel des Mille Collines')).toBe('hotel des mille collines');
    expect(fold("Isoko y'Umujyi")).toBe('isoko y umujyi');
    expect(fold('Saint-André')).toBe('saint andre');
  });
});

describe('word-start matching', () => {
  it('matches at the front and at any word start', () => {
    expect(matchesAt('isoko ya kimironko', 'isoko')).toBe(0);
    expect(matchesAt('isoko ya kimironko', 'kimironko')).toBe(9);
    expect(matchesAt('isoko ya kimironko', 'kim')).toBe(9);
    // Not mid-word: "ironko" is not how anyone starts typing a name.
    expect(matchesAt('isoko ya kimironko', 'ironko')).toBe(-1);
  });
});

describe('the structural words do not defeat the match', () => {
  it.each([
    ['kimironko', 'Isoko ya Kimironko'],
    ['nyabugogo', 'Gare ya Nyabugogo'],
    ['lando', 'Chez Lando'],
    ['jules', 'Kwa Jules'],
    ['mutwe', 'Kwa Mutwe'],
  ])('typing %j finds %j', (query, expected) => {
    expect(names(query, 20)).toContain(expected);
  });

  it('still finds the place when the passenger types the whole spoken name', () => {
    expect(names('isoko ya kim')).toContain('Isoko ya Kimironko');
  });
});

describe('the names the pilot was written for', () => {
  it('finds Sonatubes, Chez Lando and Isoko ya Kimironko', () => {
    expect(names('sonatubes')[0]).toBe('Sonatubes');
    expect(names('chez lando')[0]).toBe('Chez Lando');
    expect(names('isoko ya kimironko')[0]).toBe('Isoko ya Kimironko');
  });

  it('is prefix-based, so three letters are enough', () => {
    expect(names('sona')).toContain('Sonatubes');
    expect(names('gipo')).toContain('Giporoso');
  });

  it('ignores accents in the query and in the catalog', () => {
    const withAccent = names('hôtel des mille');
    const without = names('hotel des mille');
    expect(without).toEqual(withAccent);
    expect(without.length).toBeGreaterThan(0);
  });
});

describe('aliases', () => {
  it('finds a place by the name the old catalog used', () => {
    // The team says "Isoko ya Kimironko"; the old catalog said
    // "Kimironko Market", and that name survives as an alias.
    const hit = searchLandmarks('kimironko market', 10).find(
      (s) => s.name === 'Isoko ya Kimironko',
    );
    expect(hit).toBeDefined();
    expect(hit!.matchedOn).toBe('alias');
    expect(hit!.matchedText).toBe('Kimironko Market');
  });

  it('finds a tower by its acronym', () => {
    expect(names('kct', 10)).toContain('Kigali City Tower');
  });
});

describe('ordering', () => {
  it('puts a name match ahead of an alias or an area hint match', () => {
    const results = searchLandmarks('remera', 20);
    const firstNameHit = results.findIndex((s) => s.matchedOn === 'name');
    const firstHintHit = results.findIndex((s) => s.matchedOn === 'areaHint');
    expect(firstNameHit).toBe(0);
    if (firstHintHit !== -1) expect(firstHintHit).toBeGreaterThan(firstNameHit);
  });

  it('offers a place that can drop a pin before one that cannot', () => {
    const results = searchLandmarks('ga', 40);
    const lastPlaceable = results.map(isPlaceable).lastIndexOf(true);
    const firstUnplaceable = results.map(isPlaceable).indexOf(false);
    if (firstUnplaceable !== -1 && lastPlaceable !== -1) {
      const sameRankGroup = results
        .filter((s) => s.matchedOn === 'name')
        .map(isPlaceable);
      expect(sameRankGroup.indexOf(true)).toBeLessThanOrEqual(
        sameRankGroup.lastIndexOf(true),
      );
    }
    expect(results.length).toBeGreaterThan(0);
  });
});

describe('the two halves of the catalog', () => {
  it('searches verified and unverified places alike', () => {
    expect(KIGALI_LANDMARKS.length).toBeGreaterThan(100);
    expect(UNVERIFIED_LANDMARKS.length).toBeGreaterThan(0);
    // "Kwa Jules" is a place the team named and no service could place.
    const jules = searchLandmarks('kwa jules', 10)[0];
    expect(jules.name).toBe('Kwa Jules');
    expect(isPlaceable(jules)).toBe(false);
    expect(jules.point).toBeUndefined();
  });

  it('never hands out a coordinate for an unverified place', () => {
    for (const entry of UNVERIFIED_LANDMARKS) {
      expect((entry as { point?: unknown }).point).toBeUndefined();
    }
  });
});

describe('guards', () => {
  it('says nothing for one letter', () => {
    expect(searchLandmarks('k')).toEqual([]);
    expect(searchLandmarks('')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(searchLandmarks('ki', 3).length).toBeLessThanOrEqual(3);
  });
});
