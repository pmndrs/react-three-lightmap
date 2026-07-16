import { describe, expect, it } from 'vitest';

import { findVertex, guessOrthogonalOrigin } from './AutoUV2';

describe('findVertex', () => {
  it('returns the vertex index itself when no earlier match exists', () => {
    const posArray = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const normalArray = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    const groupIndexArray = [0, 0, 0];

    expect(findVertex(posArray, normalArray, groupIndexArray, 0)).toBe(0);
    expect(findVertex(posArray, normalArray, groupIndexArray, 1)).toBe(1);
    expect(findVertex(posArray, normalArray, groupIndexArray, 2)).toBe(2);
  });

  it('returns the earliest vertex with the same position, normal and group', () => {
    // vertex 2 duplicates vertex 0's position and normal, same group
    const posArray = [0, 0, 0, 1, 0, 0, 0, 0, 0];
    const normalArray = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    const groupIndexArray = [0, 0, 0];

    expect(findVertex(posArray, normalArray, groupIndexArray, 2)).toBe(0);
  });

  it('does not merge vertices sharing position but not normal', () => {
    // vertex 2 shares position with vertex 0 but has a different normal
    const posArray = [0, 0, 0, 1, 0, 0, 0, 0, 0];
    const normalArray = [0, 0, 1, 0, 0, 1, 0, 1, 0];
    const groupIndexArray = [0, 0, 0];

    expect(findVertex(posArray, normalArray, groupIndexArray, 2)).toBe(2);
  });

  it('does not merge vertices sharing position/normal but not group', () => {
    // vertex 2 shares position and normal with vertex 0 but is in a different group
    const posArray = [0, 0, 0, 1, 0, 0, 0, 0, 0];
    const normalArray = [0, 0, 1, 0, 0, 1, 0, 0, 1];
    const groupIndexArray = [0, 0, 1];

    expect(findVertex(posArray, normalArray, groupIndexArray, 2)).toBe(2);
  });
});

describe('guessOrthogonalOrigin', () => {
  it('picks the vertex with the most perpendicular pair of edges (right triangle)', () => {
    // right triangle in the XY plane: right angle is at vertex 0
    const posArray = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const indexArray = [0, 1, 2];

    expect(guessOrthogonalOrigin(indexArray, 0, posArray)).toBe(0);
  });

  it('is invariant to which face-local slot the right-angle vertex occupies', () => {
    const posArray = [0, 0, 0, 1, 0, 0, 0, 1, 0];

    // same triangle, but right-angle vertex (index 0) rotated into each slot
    expect(guessOrthogonalOrigin([0, 1, 2], 0, posArray)).toBe(0);
    expect(guessOrthogonalOrigin([1, 2, 0], 0, posArray)).toBe(2);
    expect(guessOrthogonalOrigin([2, 0, 1], 0, posArray)).toBe(1);
  });

  it('reads the face starting at the given offset into the index array', () => {
    // pad the index array with an unrelated leading face
    const posArray = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    const indexArray = [0, 1, 2, 0, 1, 2];

    expect(guessOrthogonalOrigin(indexArray, 3, posArray)).toBe(0);
  });
});
