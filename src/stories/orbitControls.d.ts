declare namespace JSX {
  import { ReactThreeFiber } from 'react-three-fiber';

  interface IntrinsicElements {
    orbitControls: ReactThreeFiber.Object3DNode<
      OrbitControls,
      typeof OrbitControls
    >;
  }
}
