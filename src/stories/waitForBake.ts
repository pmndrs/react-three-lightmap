import { expect, waitFor, within } from 'storybook/test';

import { BAKE_COMPLETE_TEST_ID } from './BakeCompleteMarker';

// baking runs over many rAF-driven passes and can take 40+ seconds for
// larger scenes (e.g. the glTF story), so give it a generous timeout
const BAKE_TIMEOUT_MS = 60000;

export async function waitForBake(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(
    () => expect(canvas.getByTestId(BAKE_COMPLETE_TEST_ID)).toBeInTheDocument(),
    { timeout: BAKE_TIMEOUT_MS }
  );
}
