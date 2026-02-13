import { useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type { Group, Material } from 'three';
import { Color, DoubleSide, FrontSide } from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils';

type Props = JSX.IntrinsicElements['group'] & { src: string; isDome?: boolean; emissiveIntensity?: number };

type ModelProps = Props & {
  hiddenMeshNamePrefixes?: string[];
  onReady?: (group: Group) => void;
  optimizeStatic?: boolean;
  forceFrontSideOpaque?: boolean;
};

export default function Model({
  src,
  isDome = false,
  emissiveIntensity = 0.6,
  hiddenMeshNamePrefixes = [],
  onReady,
  optimizeStatic = false,
  forceFrontSideOpaque = false,
  ...props
}: ModelProps) {
  const { scene } = useGLTF(src) as unknown as { scene: Group };

  // Clone the glTF scene so multiple instances can be placed independently.
  const cloned = useMemo(() => SkeletonUtils.clone(scene) as Group, [scene]);
  const normalizedHiddenPrefixes = useMemo(
    () => hiddenMeshNamePrefixes.map((prefix) => prefix.toLowerCase()),
    [hiddenMeshNamePrefixes],
  );

  useEffect(() => {
    cloned.traverse((child: any) => {
      if (optimizeStatic && child !== cloned) {
        child.matrixAutoUpdate = false;
      }

      const lowerName = typeof child.name === 'string' ? child.name.toLowerCase() : '';
      const shouldHide = normalizedHiddenPrefixes.some((prefix) => lowerName.startsWith(prefix));
      if (shouldHide) {
        child.visible = false;
        if (child.isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
        }
        return;
      }

      if (child.isMesh) {
        child.frustumCulled = true;

        if (isDome) {
          // Interior dome: visible from inside, emissive and no shadows.
          child.castShadow = false;
          child.receiveShadow = false;

          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat: any) => {
            if (!mat) return;
            try {
              mat.side = DoubleSide;
            } catch {
              // Ignore materials that do not support side.
            }
            if (mat.emissive === undefined) mat.emissive = new Color('#ffffff');
            else mat.emissive = mat.emissive || new Color('#ffffff');
            mat.emissiveIntensity = emissiveIntensity;
          });
        } else {
          if (optimizeStatic) {
            child.castShadow = false;
            child.receiveShadow = false;
          } else {
            child.castShadow = true;
            child.receiveShadow = true;
          }

          if (optimizeStatic && forceFrontSideOpaque) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat: Material | null | undefined) => {
              if (!mat) return;
              if ((mat as any).transparent) return;
              if (typeof (mat as any).alphaTest === 'number' && (mat as any).alphaTest > 0) return;
              mat.side = FrontSide;
            });
          }
        }
      }
    });

    if (optimizeStatic) {
      cloned.updateMatrixWorld(true);
    }

    onReady?.(cloned);

    return () => {
      // no-op for now
    };
  }, [cloned, emissiveIntensity, forceFrontSideOpaque, isDome, normalizedHiddenPrefixes, onReady, optimizeStatic]);

  return <primitive object={cloned} {...props} />;
}

// helper for preloading
export const preloadModel = (url: string) => useGLTF.preload(url);
