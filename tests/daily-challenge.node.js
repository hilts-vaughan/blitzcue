import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATEGORIES, challengeFor } from '../src/game.js';

test('daily challenges contain ten distinct categories and are deterministic', () => {
  for (let offset = 0; offset < 3653; offset++) {
    const day = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
    const challenge = challengeFor(day);
    assert.equal(challenge.categories.length, 10, day);
    assert.equal(new Set(challenge.categories).size, 10, day);
    assert.deepEqual(challengeFor(day), challenge, day);
  }
});

test('duplicate entries in the category list cannot repeat a daily category', () => {
  const originalLength = CATEGORIES.length;
  try {
    CATEGORIES.push(...CATEGORIES);
    for (let offset = 0; offset < 366; offset++) {
      const day = new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
      const challenge = challengeFor(day);
      assert.equal(new Set(challenge.categories).size, 10, day);
    }
  } finally {
    CATEGORIES.length = originalLength;
  }
});
