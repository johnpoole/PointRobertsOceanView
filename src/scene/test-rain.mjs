// Run: node src/scene/test-rain.mjs
import assert from 'node:assert/strict';
import { raining } from './rain.js';

// Rain falling is rain drawn, however unlikely the forecast had it.
assert.equal(raining({ precipitation_mm: 0.1, precipitation_probability_percent: 40 }), true);
assert.equal(raining({ precipitation_mm: 6 }), true);

// A dry hour is dry, however likely the forecast had it. This used to rain.
assert.equal(raining({ precipitation_mm: 0, precipitation_probability_percent: 90 }), false);

// No figure draws nothing.
assert.equal(raining({ precipitation_probability_percent: 90 }), false);
assert.equal(raining({ precipitation_mm: null }), false);
assert.equal(raining({}), false);

console.log('PASS: rain is drawn when it is falling and not when it is likely.');
