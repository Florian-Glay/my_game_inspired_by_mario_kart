declare module 'three/examples/jsm/utils/SkeletonUtils' {
  import { Object3D } from 'three';
  export function clone(object: Object3D): Object3D;
  const SkeletonUtils: { clone: (object: Object3D) => Object3D };
  export default SkeletonUtils;
}
