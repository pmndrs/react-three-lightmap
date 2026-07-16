import path from 'path';
import type { TestRunnerConfig } from '@storybook/test-runner';
import { toMatchImageSnapshot } from 'jest-image-snapshot';

// visual regression is scoped to a small representative slice of stories
// for now (plain geometry, materials, GLTF loading) rather than all of
// them, to keep this first pass's flakiness surface and review overhead
// small - the rest still get exercised (they render or the visit fails),
// just without pixel-diffing
const VISUAL_REGRESSION_STORY_IDS = new Set([
  'simple-scene--main',
  'multi-material-mesh--main',
  'gltf-scene--main',
  'cylinder-scene-polygon-uv--main'
]);

const config: TestRunnerConfig = {
  setup() {
    // `expect` is only available as a global once inside the Jest
    // environment, which isn't the case yet at module-eval time
    expect.extend({ toMatchImageSnapshot });
  },
  async preVisit(page) {
    // fixed viewport so screenshots are deterministic regardless of the
    // environment running the test
    await page.setViewportSize({ width: 1024, height: 768 });
  },
  async postVisit(page, context) {
    if (!VISUAL_REGRESSION_STORY_IDS.has(context.id)) {
      return;
    }

    const image = await page.screenshot();

    // WebGL output has legitimate sub-pixel/AA nondeterminism across
    // machines and GPU drivers, so this compares by overall difference
    // percentage rather than requiring pixel-exact matches
    expect(image).toMatchImageSnapshot({
      customSnapshotsDir: path.join(process.cwd(), '.storybook', '__screenshots__'),
      customSnapshotIdentifier: context.id,
      failureThreshold: 0.005,
      failureThresholdType: 'percent'
    });
  }
};

export default config;
