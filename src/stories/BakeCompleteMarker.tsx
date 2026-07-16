import React from 'react';

// visual-regression tests wait on this marker (rendered as a real DOM
// sibling of the <Canvas>, not inside it) to know a bake has actually
// finished before taking a screenshot
export const BAKE_COMPLETE_TEST_ID = 'bake-complete';

const BakeCompleteMarker: React.FC = () => (
  <div data-testid={BAKE_COMPLETE_TEST_ID} style={{ display: 'none' }} />
);

export default BakeCompleteMarker;
