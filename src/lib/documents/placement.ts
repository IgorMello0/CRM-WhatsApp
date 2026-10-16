import type { SignaturePlacement } from './types';

export function constrainPlacement(p: SignaturePlacement): SignaturePlacement {
  const width = Math.max(0.08, Math.min(0.8, p.width));
  const height = Math.max(0.025, Math.min(0.4, p.height));
  return {
    ...p,
    width,
    height,
    x: Math.max(0, Math.min(1 - width, p.x)),
    y: Math.max(0, Math.min(1 - height, p.y)),
  };
}
export function visiblePointToPdf(
  x: number,
  y: number,
  box: { x: number; y: number; width: number; height: number },
  rotation: number
) {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: box.x + y * box.width, y: box.y + x * box.height };
    case 180:
      return { x: box.x + (1 - x) * box.width, y: box.y + y * box.height };
    case 270:
      return {
        x: box.x + (1 - y) * box.width,
        y: box.y + (1 - x) * box.height,
      };
    default:
      return { x: box.x + x * box.width, y: box.y + (1 - y) * box.height };
  }
}
