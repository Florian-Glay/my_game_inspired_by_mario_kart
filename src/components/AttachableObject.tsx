import { useMemo } from 'react';
import type { Vec3 } from '../types/game';
import Model from './Model';

const DEFAULT_VOID_MODEL_PATH = 'models/void.glb';

type AttachableObjectProps = {
  myObject?: number;
  myObjectCharges?: number;
  miniObjectModelPaths: readonly string[];
  objectItemMaxValue: number;
  voidModelPath?: string;
  mushroomModelPath?: string;
  mushroomObjectValue?: number;
  thunderModelPath?: string;
  thunderObjectValue?: number;
  bulletBillModelPath?: string;
  bulletBillObjectValue?: number;
  coinModelPath?: string;
  coinObjectValue?: number;
  bananaModelPath?: string;
  bananaObjectValue?: number;
  tripleBananaObjectValue?: number;
  greenShellModelPath?: string;
  greenShellObjectValue?: number;
  tripleGreenShellObjectValue?: number;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
};

const sanitizeObjectValue = (value: number | undefined) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
};

export const resolveAttachableObjectModelPath = ({
  myObject,
  miniObjectModelPaths,
  objectItemMaxValue,
  voidModelPath,
}: {
  myObject: number | undefined;
  miniObjectModelPaths: readonly string[];
  objectItemMaxValue: number;
  voidModelPath: string;
}) => {
  const normalizedObjectValue = sanitizeObjectValue(myObject);
  if (normalizedObjectValue <= 0) return voidModelPath;
  if (normalizedObjectValue > objectItemMaxValue) return voidModelPath;

  const modelPath = miniObjectModelPaths[normalizedObjectValue - 1];
  return modelPath ?? voidModelPath;
};

export function AttachableObject({
  myObject = 0,
  myObjectCharges = 0,
  miniObjectModelPaths,
  objectItemMaxValue,
  voidModelPath = DEFAULT_VOID_MODEL_PATH,
  mushroomModelPath = 'models/miniObject/itemMushroom.glb',
  mushroomObjectValue = 2,
  thunderModelPath = 'models/miniObject/ItemThunder.glb',
  thunderObjectValue = 10,
  bulletBillModelPath = 'models/miniObject/itemBulletBill.glb',
  bulletBillObjectValue = 11,
  coinModelPath = 'models/miniObject/itemCoin.glb',
  coinObjectValue = 13,
  bananaModelPath = 'models/miniObject/itemBanana.glb',
  bananaObjectValue = 3,
  tripleBananaObjectValue = 4,
  greenShellModelPath = 'models/miniObject/itemGreenShell.glb',
  greenShellObjectValue = 5,
  tripleGreenShellObjectValue = 6,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: AttachableObjectProps) {
  const modelPath = useMemo(
    () =>
      resolveAttachableObjectModelPath({
        myObject,
        miniObjectModelPaths,
        objectItemMaxValue,
        voidModelPath,
      }),
    [miniObjectModelPaths, myObject, objectItemMaxValue, voidModelPath],
  );
  const normalizedCharges = useMemo(
    () => Math.max(0, Math.floor(Number.isFinite(myObjectCharges) ? myObjectCharges : 0)),
    [myObjectCharges],
  );
  const mushroomCount = useMemo(
    () =>
      myObject === mushroomObjectValue ? Math.min(3, Math.max(0, normalizedCharges))
      : 0,
    [mushroomObjectValue, myObject, normalizedCharges],
  );
  const tripleBananaCount = useMemo(
    () =>
      myObject === tripleBananaObjectValue ? Math.min(3, Math.max(0, normalizedCharges))
      : 0,
    [myObject, normalizedCharges, tripleBananaObjectValue],
  );
  const tripleGreenShellCount = useMemo(
    () =>
      myObject === tripleGreenShellObjectValue ? Math.min(3, Math.max(0, normalizedCharges))
      : 0,
    [myObject, normalizedCharges, tripleGreenShellObjectValue],
  );
  const shouldRenderMushroomStack = myObject === mushroomObjectValue;
  const shouldRenderTripleBananaStack = myObject === tripleBananaObjectValue;
  const shouldRenderSingleBanana = myObject === bananaObjectValue;
  const shouldRenderTripleGreenShellStack = myObject === tripleGreenShellObjectValue;
  const shouldRenderSingleGreenShell = myObject === greenShellObjectValue;
  const shouldRenderThunder = myObject === thunderObjectValue;
  const shouldRenderBulletBill = myObject === bulletBillObjectValue;
  const shouldRenderCoin = myObject === coinObjectValue;

  return (
    <group position={position} rotation={rotation}>
      {mushroomCount > 0 ?
        Array.from({ length: mushroomCount }, (_, index) => (
          <group key={`mushroom-charge-${index}`} position={[0, 0, -index * 0.92]}>
            <Model src={mushroomModelPath} scale={scale} />
          </group>
        ))
      : shouldRenderMushroomStack ?
        <Model src={voidModelPath} scale={scale} />
      : tripleBananaCount > 0 ?
        Array.from({ length: tripleBananaCount }, (_, index) => (
          <group key={`triple-banana-charge-${index}`} position={[0, 0, -index * 0.92]}>
            <Model src={bananaModelPath} scale={scale} />
          </group>
        ))
      : shouldRenderTripleBananaStack ?
        <Model src={voidModelPath} scale={scale} />
      : shouldRenderSingleBanana ?
        <Model src={bananaModelPath} scale={scale} />
      : tripleGreenShellCount > 0 ?
        Array.from({ length: tripleGreenShellCount }, (_, index) => (
          <group key={`triple-green-shell-charge-${index}`} position={[0, 0, -index * 0.92]}>
            <Model src={greenShellModelPath} scale={scale} />
          </group>
        ))
      : shouldRenderTripleGreenShellStack ?
        <Model src={voidModelPath} scale={scale} />
      : shouldRenderSingleGreenShell ?
        <Model src={greenShellModelPath} scale={scale} />
      : shouldRenderThunder ?
        <Model src={thunderModelPath} scale={scale} />
      : shouldRenderBulletBill ?
        <Model src={bulletBillModelPath} scale={scale} />
      : shouldRenderCoin ?
        <Model src={coinModelPath} scale={scale} />
      : <Model src={modelPath} scale={scale} />}
    </group>
  );
}
