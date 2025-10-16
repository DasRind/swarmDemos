import { Vector2, WorldDimensions } from './primitives';

export interface CanvasDimensions {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  devicePixelRatio: number;
  world: WorldDimensions;
}

export interface CanvasDrawingOptions {
  fillStyle?: string | CanvasGradient | CanvasPattern;
  strokeStyle?: string | CanvasGradient | CanvasPattern;
  lineWidth?: number;
  alpha?: number;
}

export interface CanvasController {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  dimensions: CanvasDimensions;
  clear(color?: string): void;
  resize(): void;
  worldToScreen(point: Vector2): Vector2;
  screenToWorld(point: Vector2): Vector2;
  drawCircle(center: Vector2, radius: number, options?: CanvasDrawingOptions): void;
  drawLine(
    start: Vector2,
    end: Vector2,
    options?: CanvasDrawingOptions & { dash?: number[] }
  ): void;
  drawPolygon(points: Vector2[], options?: CanvasDrawingOptions): void;
  withWorldSpace(callback: (ctx: CanvasRenderingContext2D) => void): void;
}

export interface CanvasPointerEvent {
  position: Vector2;
  originalEvent: PointerEvent;
}
