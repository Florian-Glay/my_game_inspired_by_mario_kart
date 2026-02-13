import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';

type TextureDebugProps = {
  onReady?: () => void;
};

export default function TextureDebug({ onReady }: TextureDebugProps) {
  const { gl, scene } = useThree();
  const readySentRef = useRef(false);

  useEffect(() => {
    try {
      const ctx = (gl.getContext && (gl.getContext() as WebGLRenderingContext | null)) || null;
      if (ctx) {
        console.log('MAX_TEXTURE_IMAGE_UNITS:', ctx.getParameter(ctx.MAX_TEXTURE_IMAGE_UNITS));
      } else {
        console.warn('Impossible de récupérer le contexte WebGL');
      }
    } catch (e) {
      console.warn('Impossible de lire MAX_TEXTURE_IMAGE_UNITS', e);
    }

    const set = new Set<any>();
    scene.traverse((obj: any) => {
      if (obj.isMesh) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m: any) => {
          if (!m) return;
          ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','bumpMap','displacementMap','alphaMap','envMap','lightMap']
            .forEach(k => m[k] && set.add(m[k]));
        });
      }
    });
    console.log('Unique textures in scene:', set.size);

    if (!readySentRef.current) {
      readySentRef.current = true;
      onReady?.();
    }
  }, [gl, onReady, scene]);

  return null;
}
