import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  generatePixelAreaLookup,
  setBlendedNormal,
  setUpProbeSide,
  setUpProbeUp
} from './lightProbe';

describe('generatePixelAreaLookup', () => {
  it('produces a probeTargetSize^2 lookup table', () => {
    const lookup = generatePixelAreaLookup(4);
    expect(lookup).toHaveLength(16);
  });

  it('gives the center pixel the highest area weight', () => {
    const size = 8;
    const lookup = generatePixelAreaLookup(size);

    const centerIndex = Math.floor(size / 2) * size + Math.floor(size / 2);
    const centerValue = lookup[centerIndex];

    for (let i = 0; i < lookup.length; i += 1) {
      if (i !== centerIndex) {
        expect(lookup[i]).toBeLessThanOrEqual(centerValue);
      }
    }
  });

  it('only ever produces values in (0, 1]', () => {
    const lookup = generatePixelAreaLookup(5);
    for (const value of lookup) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('setBlendedNormal', () => {
  it('returns the vertex normal directly at a triangle corner', () => {
    const origNormalArray = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const origIndexArray = [0, 1, 2];

    const out = new THREE.Vector3();
    // barycentric (pU=0, pV=0) => fully at the origin vertex (index 0)
    setBlendedNormal(out, origNormalArray, origIndexArray, 0, 0, 0);

    expect(out.x).toBeCloseTo(1);
    expect(out.y).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(0);
  });

  it('blends and normalizes normals at the triangle centroid', () => {
    const origNormalArray = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const origIndexArray = [0, 1, 2];

    const out = new THREE.Vector3();
    setBlendedNormal(out, origNormalArray, origIndexArray, 0, 1 / 3, 1 / 3);

    // equal blend of the three orthogonal unit axes, then normalized
    const expected = new THREE.Vector3(1, 1, 1).normalize();
    expect(out.x).toBeCloseTo(expected.x);
    expect(out.y).toBeCloseTo(expected.y);
    expect(out.z).toBeCloseTo(expected.z);
    expect(out.length()).toBeCloseTo(1);
  });
});

describe('setUpProbeUp', () => {
  it('positions the camera at the origin, oriented along uDir with normal as forward', () => {
    const mesh = new THREE.Mesh();
    mesh.updateMatrixWorld();

    const probeCam = new THREE.PerspectiveCamera();
    const origin = new THREE.Vector3(1, 2, 3);
    const normal = new THREE.Vector3(0, 0, 1);
    const uDir = new THREE.Vector3(0, 1, 0);

    setUpProbeUp(probeCam, mesh, origin, normal, uDir);

    expect(probeCam.position.x).toBeCloseTo(1);
    expect(probeCam.position.y).toBeCloseTo(2);
    expect(probeCam.position.z).toBeCloseTo(3);

    // camera looks toward origin + normal, i.e. along +Z from its own position
    const forward = new THREE.Vector3();
    probeCam.getWorldDirection(forward);
    expect(forward.x).toBeCloseTo(0);
    expect(forward.y).toBeCloseTo(0);
    expect(forward.z).toBeCloseTo(1);
  });
});

describe('setUpProbeSide', () => {
  it('looks toward origin offset along direction by directionSign', () => {
    const mesh = new THREE.Mesh();
    mesh.updateMatrixWorld();

    const probeCam = new THREE.PerspectiveCamera();
    const origin = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const direction = new THREE.Vector3(1, 0, 0);

    setUpProbeSide(probeCam, mesh, origin, normal, direction, 1);

    const forwardPositive = new THREE.Vector3();
    probeCam.getWorldDirection(forwardPositive);
    expect(forwardPositive.x).toBeCloseTo(1);

    setUpProbeSide(probeCam, mesh, origin, normal, direction, -1);

    const forwardNegative = new THREE.Vector3();
    probeCam.getWorldDirection(forwardNegative);
    expect(forwardNegative.x).toBeCloseTo(-1);
  });
});
