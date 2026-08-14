import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  LIGHTMAP_IGNORE_FLAG,
  LIGHTMAP_READONLY_FLAG,
  traverseSceneItems
} from './workbench';

describe('traverseSceneItems', () => {
  function buildTree() {
    const root = new THREE.Object3D();
    root.name = 'root';

    const child = new THREE.Object3D();
    child.name = 'child';
    root.add(child);

    const grandchild = new THREE.Object3D();
    grandchild.name = 'grandchild';
    child.add(grandchild);

    return { root, child, grandchild };
  }

  it('yields the root and all visible descendants', () => {
    const { root, child, grandchild } = buildTree();

    const visited = [...traverseSceneItems(root)];

    expect(visited).toHaveLength(3);
    expect(new Set(visited)).toEqual(new Set([root, child, grandchild]));
  });

  it('skips invisible objects and their entire subtree', () => {
    const { root, child, grandchild } = buildTree();
    child.visible = false;

    const visited = [...traverseSceneItems(root)];

    expect(visited).toEqual([root]);
    expect(visited).not.toContain(child);
    expect(visited).not.toContain(grandchild);
  });

  it('skips objects flagged as lightmap-ignore, and calls onIgnored for them', () => {
    const { root, child, grandchild } = buildTree();
    child.userData = { [LIGHTMAP_IGNORE_FLAG]: true };

    const ignored: THREE.Object3D[] = [];
    const visited = [...traverseSceneItems(root, false, (o) => ignored.push(o))];

    expect(visited).toEqual([root]);
    expect(ignored).toEqual([child]);
    expect(visited).not.toContain(grandchild);
  });

  it('only skips lightmap-readonly objects when ignoreReadOnly is true', () => {
    const { root, child, grandchild } = buildTree();
    child.userData = { [LIGHTMAP_READONLY_FLAG]: true };

    const includingReadOnly = [...traverseSceneItems(root, false)];
    expect(new Set(includingReadOnly)).toEqual(
      new Set([root, child, grandchild])
    );

    const excludingReadOnly = [...traverseSceneItems(root, true)];
    expect(excludingReadOnly).toEqual([root]);
  });
});
