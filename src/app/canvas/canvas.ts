import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  CanvasController,
  CanvasPointerEvent,
  CanvasDimensions,
  CanvasDrawingOptions,
} from '../interfaces/canvas';
import { Vector2, WorldDimensions } from '../interfaces/primitives';

@Component({
  selector: 'app-canvas',
  standalone: true,
  templateUrl: './canvas.html',
  styleUrl: './canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Canvas implements AfterViewInit, OnDestroy, OnChanges {
  @Input({ required: true }) world!: WorldDimensions;
  @Input() devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  @Input() background = '#0f172a';

  @Output() ready = new EventEmitter<CanvasController>();
  @Output() pointerDown = new EventEmitter<CanvasPointerEvent>();
  @Output() pointerMove = new EventEmitter<CanvasPointerEvent>();

  @ViewChild('canvas', { static: true }) private canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('container', { static: true }) private containerRef!: ElementRef<HTMLDivElement>;

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private controller: CanvasController | null = null;
  private dimensions: CanvasDimensions | null = null;
  private scale = 1;
  private offset: Vector2 = { x: 0, y: 0 };
  private destroyed = false;

  private get canvasEl() {
    return this.canvasRef.nativeElement;
  }

  private get containerEl() {
    return this.containerRef.nativeElement;
  }

  ngAfterViewInit(): void {
    this.initContext();
    this.createController();
    this.setupResizeObserver();
    this.emitReady();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.controller) {
      return;
    }

    if (changes['devicePixelRatio']) {
      this.updateSize();
    }

    if (changes['world']) {
      this.updateSize();
      this.emitReady();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    this.controller = null;
    this.ctx = null;
  }

  handlePointerDown(event: PointerEvent) {
    if (!this.controller) return;
    const position = this.clientToWorld(event);
    if (!position) return;
    this.pointerDown.emit({ position, originalEvent: event });
  }

  handlePointerMove(event: PointerEvent) {
    if (!this.controller) return;
    const position = this.clientToWorld(event);
    if (!position) return;
    this.pointerMove.emit({ position, originalEvent: event });
  }

  private initContext() {
    const canvas = this.canvasEl;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('CanvasRenderingContext2D could not be initialised.');
    }
    this.ctx = ctx;
    ctx.imageSmoothingQuality = 'high';
    this.updateSize();
  }

  private createController() {
    if (!this.ctx) return;

    const controller: CanvasController = {
      canvas: this.canvasEl,
      ctx: this.ctx,
      dimensions: this.dimensions ?? this.createFallbackDimensions(),
      clear: (color?: string) => this.clear(color),
      resize: () => this.updateSize(),
      worldToScreen: (point: Vector2) => this.worldToScreen(point),
      screenToWorld: (point: Vector2) => this.screenToWorld(point),
      drawCircle: (center, radius, options) => this.drawCircle(center, radius, options),
      drawLine: (start, end, options) => this.drawLine(start, end, options),
      drawPolygon: (points, options) => this.drawPolygon(points, options),
      withWorldSpace: (callback) => this.withWorldSpace(callback),
    };

    this.controller = controller;
  }

  private emitReady() {
    if (!this.controller || this.destroyed) return;
    this.ready.emit(this.controller);
  }

  private setupResizeObserver() {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', () => this.updateSize(), { passive: true });
      return;
    }

    this.resizeObserver = new ResizeObserver(() => this.updateSize());
    this.resizeObserver.observe(this.containerEl);
  }

  private updateSize() {
    if (!this.ctx) return;
    const containerRect = this.containerEl.getBoundingClientRect();
    const cssWidth = Math.max(1, containerRect.width);
    const cssHeight = Math.max(1, containerRect.height);
    const dpr = this.devicePixelRatio || 1;

    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);

    const canvas = this.canvasEl;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const worldWidth = this.world?.width ?? 100;
    const worldHeight = this.world?.height ?? 100;
    if (worldWidth <= 0 || worldHeight <= 0) {
      throw new Error('World dimensions must be positive.');
    }

    const scaleX = pixelWidth / worldWidth;
    const scaleY = pixelHeight / worldHeight;
    this.scale = Math.min(scaleX, scaleY);
    this.offset = {
      x: (pixelWidth - worldWidth * this.scale) / 2,
      y: (pixelHeight - worldHeight * this.scale) / 2,
    };

    this.dimensions = {
      cssWidth,
      cssHeight,
      pixelWidth,
      pixelHeight,
      devicePixelRatio: dpr,
      world: { width: worldWidth, height: worldHeight },
    };
    if (this.controller) {
      this.controller.dimensions = this.dimensions;
    }

    this.clear(this.background);
  }

  private clear(color?: string) {
    if (!this.ctx || !this.dimensions) return;
    const { ctx } = this;
    const { pixelWidth, pixelHeight } = this.dimensions;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    } else {
      ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    }
    ctx.restore();
  }

  private withWorldSpace(callback: (ctx: CanvasRenderingContext2D) => void) {
    if (!this.ctx) return;
    this.ctx.save();
    this.ctx.setTransform(this.scale, 0, 0, this.scale, this.offset.x, this.offset.y);
    callback(this.ctx);
    this.ctx.restore();
  }

  private drawCircle(center: Vector2, radius: number, options?: CanvasDrawingOptions) {
    this.withWorldSpace((ctx) => {
      ctx.beginPath();
      if (options?.alpha !== undefined) {
        ctx.globalAlpha = options.alpha;
      }
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      if (options?.fillStyle) {
        ctx.fillStyle = options.fillStyle;
        ctx.fill();
      }
      if (options?.strokeStyle || options?.lineWidth) {
        if (options?.strokeStyle) ctx.strokeStyle = options.strokeStyle;
        ctx.lineWidth = options?.lineWidth ?? 1;
        ctx.stroke();
      }
    });
  }

  private drawLine(
    start: Vector2,
    end: Vector2,
    options?: CanvasDrawingOptions & { dash?: number[] }
  ) {
    this.withWorldSpace((ctx) => {
      ctx.beginPath();
      if (options?.alpha !== undefined) {
        ctx.globalAlpha = options.alpha;
      }
      if (options?.strokeStyle) {
        ctx.strokeStyle = options.strokeStyle;
      }
      ctx.lineWidth = options?.lineWidth ?? 1;
      if (options?.dash) {
        ctx.setLineDash(options.dash);
      }
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (options?.dash) {
        ctx.setLineDash([]);
      }
    });
  }

  private drawPolygon(points: Vector2[], options?: CanvasDrawingOptions) {
    if (!points.length) {
      return;
    }
    this.withWorldSpace((ctx) => {
      ctx.beginPath();
      if (options?.alpha !== undefined) {
        ctx.globalAlpha = options.alpha;
      }
      ctx.moveTo(points[0]!.x, points[0]!.y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i]!.x, points[i]!.y);
      }
      ctx.closePath();
      if (options?.fillStyle) {
        ctx.fillStyle = options.fillStyle;
        ctx.fill();
      }
      if (options?.strokeStyle || options?.lineWidth) {
        if (options?.strokeStyle) ctx.strokeStyle = options.strokeStyle;
        ctx.lineWidth = options?.lineWidth ?? 1;
        ctx.stroke();
      }
    });
  }

  private worldToScreen(point: Vector2): Vector2 {
    return {
      x: this.offset.x + point.x * this.scale,
      y: this.offset.y + point.y * this.scale,
    };
  }

  private screenToWorld(point: Vector2): Vector2 {
    return {
      x: (point.x - this.offset.x) / this.scale,
      y: (point.y - this.offset.y) / this.scale,
    };
  }

  private clientToWorld(event: PointerEvent): Vector2 | null {
    if (!this.dimensions) return null;
    const rect = this.canvasEl.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    const pixel = {
      x: cssX * this.dimensions.devicePixelRatio,
      y: cssY * this.dimensions.devicePixelRatio,
    };
    return this.screenToWorld(pixel);
  }

  private createFallbackDimensions(): CanvasDimensions {
    const world = this.world ?? { width: 100, height: 100 };
    return {
      cssWidth: world.width,
      cssHeight: world.height,
      pixelWidth: world.width,
      pixelHeight: world.height,
      devicePixelRatio: 1,
      world,
    };
  }
}
