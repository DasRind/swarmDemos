import { ChangeDetectionStrategy, Component, OnDestroy } from '@angular/core';
import { Canvas } from '../canvas/canvas';
import { CanvasController } from '../interfaces/canvas';
import { Vector2, WorldDimensions } from '../interfaces/primitives';

@Component({
  selector: 'app-swarm-insights',
  standalone: true,
  imports: [Canvas],
  templateUrl: './swarm-insights.html',
  styleUrl: './swarm-insights.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwarmInsights implements OnDestroy {
  readonly insightWorld: WorldDimensions = { width: 48, height: 30 };
  readonly canvasBackground = '#020817';
  readonly transparentBackground = '#020817';

  private readonly scenes = new Map<SceneKey, SceneRuntime>();
  private frameHandle: number | null = null;
  private lastTimestamp: number | null = null;

  handleCanvasReady(key: SceneKey, controller: CanvasController) {
    this.scenes.set(key, {
      controller,
      state: this.createSceneState(key),
    });
    this.requestFrame();
  }

  ngOnDestroy(): void {
    if (this.frameHandle !== null) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.scenes.clear();
  }

  private createSceneState(key: SceneKey): SceneState {
    switch (key) {
      case 'explore':
        return {
          type: 'explore',
          ant: {
            position: { x: 16, y: this.insightWorld.height / 2 },
            direction: Math.PI * 0.1,
            speed: 6,
            carrying: false,
          },
          targetDirection: Math.PI * 0.2,
          changeTimer: 0,
          nextChange: this.randomBetween(0.6, 1.6),
          trail: [],
          distanceAccumulator: 0,
          sensorPhase: 0,
        };
      case 'pheromones': {
        const nest = { x: 10, y: 18 };
        const food = { x: 38, y: 12 };
        const pathPoints: Vector2[] = [
          { x: nest.x, y: nest.y },
          { x: 16, y: 22 },
          { x: 24, y: 19 },
          { x: 32, y: 16 },
          { x: food.x, y: food.y },
        ];
        const path = this.createPath(pathPoints);
        return {
          type: 'pheromones',
          nest,
          food,
          path,
          pulse: 0,
          forager: {
            progress: 0,
            direction: 1,
            speed: 8,
            carrying: false,
          },
          carrier: {
            progress: 1,
            direction: -1,
            speed: 8.5,
            carrying: true,
          },
        };
      }
      case 'home': {
        const nest = { x: this.insightWorld.width / 2, y: this.insightWorld.height / 2 };
        const returnPath = this.createPath([
          { x: nest.x + 16, y: nest.y + 8 },
          { x: nest.x + 10, y: nest.y + 4 },
          { x: nest.x + 4, y: nest.y + 1.5 },
          { x: nest.x + 1.5, y: nest.y + 0.8 },
          nest,
        ]);
        return {
          type: 'home',
          nest,
          haloPhase: 0,
          orbitAngle: 0,
          returnProgress: 0,
          returnPath,
          returnSpeed: 7.5,
        };
      }
    }
  }

  private requestFrame() {
    if (this.frameHandle !== null) {
      return;
    }
    this.frameHandle = requestAnimationFrame((timestamp) => this.handleFrame(timestamp));
  }

  private handleFrame(timestamp: number) {
    if (!this.scenes.size) {
      this.frameHandle = null;
      this.lastTimestamp = null;
      return;
    }

    const delta =
      this.lastTimestamp === null ? 0 : Math.min(0.08, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;

    for (const runtime of this.scenes.values()) {
      this.updateScene(runtime.state, delta);
      this.renderScene(runtime.controller, runtime.state);
    }

    this.frameHandle = requestAnimationFrame((next) => this.handleFrame(next));
  }

  private updateScene(state: SceneState, delta: number) {
    if (delta <= 0) {
      return;
    }

    switch (state.type) {
      case 'explore':
        this.updateExploreScene(state, delta);
        break;
      case 'pheromones':
        this.updatePheromoneScene(state, delta);
        break;
      case 'home':
        this.updateHomeScene(state, delta);
        break;
    }
  }

  private renderScene(controller: CanvasController, state: SceneState) {
    controller.clear(this.canvasBackground);
    controller.withWorldSpace((ctx) => {
      this.drawBackdrop(ctx, this.insightWorld);
      switch (state.type) {
        case 'explore':
          this.renderExploreScene(ctx, state);
          break;
        case 'pheromones':
          this.renderPheromoneScene(ctx, state);
          break;
        case 'home':
          this.renderHomeScene(ctx, state);
          break;
      }
    });
  }

  private updateExploreScene(state: ExploreSceneState, delta: number) {
    state.changeTimer += delta;
    if (state.changeTimer >= state.nextChange) {
      state.changeTimer = 0;
      state.nextChange = this.randomBetween(0.7, 1.4);
      state.targetDirection = this.wrapAngle(
        state.ant.direction + (Math.random() - 0.5) * (Math.PI / 1.6)
      );
    }

    const directionBlend = Math.min(1, delta * 2);
    state.ant.direction = this.lerpAngle(state.ant.direction, state.targetDirection, directionBlend);

    const forward = {
      x: Math.cos(state.ant.direction),
      y: Math.sin(state.ant.direction),
    };

    state.ant.position.x += forward.x * state.ant.speed * delta;
    state.ant.position.y += forward.y * state.ant.speed * delta;
    state.sensorPhase = (state.sensorPhase + delta * 1.8) % (Math.PI * 2);

    const margin = 3.5;
    const width = this.insightWorld.width;
    const height = this.insightWorld.height;

    if (state.ant.position.x < margin || state.ant.position.x > width - margin) {
      state.ant.position.x = this.clamp(state.ant.position.x, margin, width - margin);
      state.targetDirection = this.wrapAngle(Math.PI - state.ant.direction);
    }

    if (state.ant.position.y < margin || state.ant.position.y > height - margin) {
      state.ant.position.y = this.clamp(state.ant.position.y, margin, height - margin);
      state.targetDirection = this.wrapAngle(-state.ant.direction);
    }

    state.distanceAccumulator += state.ant.speed * delta;
    if (state.distanceAccumulator >= 0.45) {
      state.distanceAccumulator = 0;
      state.trail.push({ x: state.ant.position.x, y: state.ant.position.y });
      if (state.trail.length > 120) {
        state.trail.shift();
      }
    }
  }

  private renderExploreScene(ctx: CanvasRenderingContext2D, state: ExploreSceneState) {
    const { trail, ant, sensorPhase } = state;

    if (trail.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 0.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(trail[0]!.x, trail[0]!.y);
      for (let i = 1; i < trail.length; i++) {
        ctx.lineTo(trail[i]!.x, trail[i]!.y);
      }
      ctx.stroke();
      ctx.restore();
    }

    this.drawSensorArcs(ctx, ant, sensorPhase);
    this.drawAnt(ctx, ant, 1.8);
  }

  private updatePheromoneScene(state: PheromoneSceneState, delta: number) {
    state.pulse = (state.pulse + delta * 1.4) % (Math.PI * 2);
    this.advanceWalker(state.forager, delta, state.path);
    this.advanceWalker(state.carrier, delta, state.path);
  }

  private renderPheromoneScene(ctx: CanvasRenderingContext2D, state: PheromoneSceneState) {
    const intensity = 0.4 + 0.25 * (Math.sin(state.pulse) * 0.5 + 0.5);

    this.drawPheromoneTrail(ctx, state.path, 'rgba(37, 99, 235, 1)', 1.8, intensity * 0.85);
    this.drawPheromoneTrail(ctx, state.path, 'rgba(16, 185, 129, 1)', 1.2, intensity);

    this.drawNest(ctx, state.nest, 3.4, state.pulse);
    this.drawFood(ctx, state.food, 2.8, 1);

    const foragerPose = this.samplePath(state.path, state.forager.progress);
    this.drawAnt(
      ctx,
      {
        position: foragerPose.position,
        direction: foragerPose.direction,
        speed: 0,
        carrying: state.forager.carrying,
      },
      1.6
    );

    const carrierPose = this.samplePath(state.path, state.carrier.progress);
    this.drawAnt(
      ctx,
      {
        position: carrierPose.position,
        direction: carrierPose.direction,
        speed: 0,
        carrying: state.carrier.carrying,
      },
      1.6
    );
  }

  private updateHomeScene(state: HomeSceneState, delta: number) {
    state.haloPhase = (state.haloPhase + delta * 0.8) % (Math.PI * 2);
    state.orbitAngle = this.wrapAngle(state.orbitAngle + delta * 0.9);
    const distance = state.returnSpeed * delta;
    const pathLength = state.returnPath.totalLength || 1;
    state.returnProgress = this.wrapProgress(state.returnProgress + distance / pathLength);
  }

  private renderHomeScene(ctx: CanvasRenderingContext2D, state: HomeSceneState) {
    const haloAlpha = 0.25 + 0.2 * (Math.sin(state.haloPhase) + 1) * 0.5;
    this.drawNest(ctx, state.nest, 4.2, state.haloPhase, haloAlpha);

    const outerRadius = 9;
    const midRadius = 6.5;
    this.drawPheromoneHalo(ctx, state.nest, outerRadius, 0.22);
    this.drawPheromoneHalo(ctx, state.nest, midRadius, 0.28);

    const scoutPos: Vector2 = {
      x: state.nest.x + Math.cos(state.orbitAngle) * outerRadius,
      y: state.nest.y + Math.sin(state.orbitAngle) * (outerRadius * 0.6),
    };
    const scoutDirection = this.wrapAngle(state.orbitAngle + Math.PI / 2);
    this.drawAnt(
      ctx,
      {
        position: scoutPos,
        direction: scoutDirection,
        speed: 0,
        carrying: false,
      },
      1.4
    );

    const returnPose = this.samplePath(state.returnPath, state.returnProgress);
    this.drawAnt(
      ctx,
      {
        position: returnPose.position,
        direction: returnPose.direction,
        speed: 0,
        carrying: true,
      },
      1.7
    );
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, world: WorldDimensions) {
    const gradient = ctx.createLinearGradient(0, 0, 0, world.height);
    gradient.addColorStop(0, '#0b1220');
    gradient.addColorStop(1, '#04070f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, world.width, world.height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 0.25;
    ctx.strokeRect(0.4, 0.4, world.width - 0.8, world.height - 0.8);
  }

  private drawSensorArcs(ctx: CanvasRenderingContext2D, ant: InsightAnt, phase: number) {
    ctx.save();
    const sweep = Math.PI / 3.5 + Math.sin(phase) * 0.25;
    const reach = 4.6;
    const baseDirection = ant.direction;
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
    ctx.lineWidth = 0.28;
    ctx.lineCap = 'round';

    for (const sign of [-1, 1]) {
      const angle = baseDirection + sweep * sign;
      const tip = {
        x: ant.position.x + Math.cos(angle) * reach,
        y: ant.position.y + Math.sin(angle) * reach,
      };
      ctx.beginPath();
      ctx.moveTo(ant.position.x, ant.position.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 0.5, 0, Math.PI * 2);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = 'rgba(129, 140, 248, 0.85)';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawAnt(ctx: CanvasRenderingContext2D, ant: InsightAnt, scale: number) {
    ctx.save();
    const forward = { x: Math.cos(ant.direction), y: Math.sin(ant.direction) };
    const perpendicular = { x: -forward.y, y: forward.x };

    const abdomenRadius = 0.42 * scale;
    const thoraxRadius = 0.34 * scale;
    const headRadius = 0.28 * scale;

    const thoraxCenter = {
      x: ant.position.x + forward.x * 0.3 * scale,
      y: ant.position.y + forward.y * 0.3 * scale,
    };
    const abdomenCenter = {
      x: thoraxCenter.x - forward.x * 0.8 * scale,
      y: thoraxCenter.y - forward.y * 0.8 * scale,
    };
    const headCenter = {
      x: thoraxCenter.x + forward.x * 0.9 * scale,
      y: thoraxCenter.y + forward.y * 0.9 * scale,
    };

    const legReach = 0.75 * scale;
    const legOffsets = [-0.35, 0, 0.35];

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.8)';
    ctx.lineWidth = 0.22 * scale;

    for (const offset of legOffsets) {
      const attachment = {
        x: thoraxCenter.x + forward.x * offset * scale,
        y: thoraxCenter.y + forward.y * offset * scale,
      };
      const leftFoot = {
        x: attachment.x + perpendicular.x * legReach,
        y: attachment.y + perpendicular.y * legReach,
      };
      const rightFoot = {
        x: attachment.x - perpendicular.x * legReach,
        y: attachment.y - perpendicular.y * legReach,
      };

      ctx.beginPath();
      ctx.moveTo(attachment.x, attachment.y);
      ctx.lineTo(leftFoot.x, leftFoot.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(attachment.x, attachment.y);
      ctx.lineTo(rightFoot.x, rightFoot.y);
      ctx.stroke();
    }

    const bodyFill = ant.carrying ? '#f97316' : '#f8fafc';
    const strokeColor = 'rgba(15, 23, 42, 0.85)';

    ctx.fillStyle = bodyFill;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.24 * scale;

    this.drawEllipse(ctx, abdomenCenter, abdomenRadius, 0.8, ant.direction);
    this.drawEllipse(ctx, thoraxCenter, thoraxRadius, 0.92, ant.direction);
    this.drawEllipse(ctx, headCenter, headRadius, 0.95, ant.direction);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.lineWidth = 0.16 * scale;
    const antennaBase = {
      x: headCenter.x + forward.x * headRadius * 0.6,
      y: headCenter.y + forward.y * headRadius * 0.6,
    };
    const antennaLength = headRadius * 1.9;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(antennaBase.x, antennaBase.y);
      ctx.lineTo(
        antennaBase.x + (forward.x + perpendicular.x * 0.5 * sign) * antennaLength,
        antennaBase.y + (forward.y + perpendicular.y * 0.5 * sign) * antennaLength
      );
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawEllipse(
    ctx: CanvasRenderingContext2D,
    center: Vector2,
    radius: number,
    aspectRatio: number,
    rotation: number
  ) {
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radius, radius * aspectRatio, rotation, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawPheromoneTrail(
    ctx: CanvasRenderingContext2D,
    path: PathData,
    color: string,
    width: number,
    alpha: number
  ) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path.points[0]!.x, path.points[0]!.y);
    for (let i = 1; i < path.points.length; i++) {
      ctx.lineTo(path.points[i]!.x, path.points[i]!.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawNest(
    ctx: CanvasRenderingContext2D,
    position: Vector2,
    radius: number,
    phase: number,
    haloAlpha = 0.35
  ) {
    const glow = 0.7 + 0.3 * (Math.sin(phase) + 1) * 0.5;
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 0.32;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.globalAlpha = haloAlpha;
    ctx.fillStyle = 'rgba(253, 224, 71, 0.4)';
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius + 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = glow * 0.4;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(252, 211, 77, 0.6)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.restore();
  }

  private drawFood(ctx: CanvasRenderingContext2D, position: Vector2, radius: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#22c55e';
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 0.28;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, alpha + 0.25);
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius + 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.5)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
    ctx.restore();
  }

  private drawPheromoneHalo(ctx: CanvasRenderingContext2D, position: Vector2, radius: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.55)';
    ctx.lineWidth = 0.38;
    ctx.beginPath();
    ctx.arc(position.x, position.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private advanceWalker(walker: PathWalker, delta: number, path: PathData) {
    if (!path.totalLength) {
      return;
    }
    const distance = walker.speed * delta * walker.direction;
    walker.progress = this.wrapProgress(walker.progress + distance / path.totalLength);
  }

  private samplePath(path: PathData, progress: number): PathPose {
    if (!path.segments.length) {
      const fallback = path.points[0] ?? { x: 0, y: 0 };
      return { position: fallback, direction: 0 };
    }

    const distance = this.wrapProgress(progress) * path.totalLength;
    let accumulated = 0;
    for (const segment of path.segments) {
      const next = accumulated + segment.length;
      if (distance <= next) {
        const ratio = segment.length === 0 ? 0 : (distance - accumulated) / segment.length;
        const position = {
          x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
          y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
        };
        const direction = Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x);
        return { position, direction };
      }
      accumulated = next;
    }

    const lastSegment = path.segments[path.segments.length - 1]!;
    return {
      position: { ...lastSegment.to },
      direction: Math.atan2(
        lastSegment.to.y - lastSegment.from.y,
        lastSegment.to.x - lastSegment.from.x
      ),
    };
  }

  private createPath(points: Vector2[]): PathData {
    const segments: PathSegment[] = [];
    let totalLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i]!;
      const to = points[i + 1]!;
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      totalLength += length;
      segments.push({ from, to, length });
    }

    return { points, segments, totalLength };
  }

  private wrapAngle(angle: number): number {
    const pi2 = Math.PI * 2;
    return angle - Math.floor((angle + Math.PI) / pi2) * pi2;
  }

  private wrapProgress(value: number): number {
    return ((value % 1) + 1) % 1;
  }

  private lerpAngle(a: number, b: number, t: number): number {
    const shortest = this.normalizeAngle(b - a);
    return a + shortest * t;
  }

  private normalizeAngle(angle: number): number {
    const pi2 = Math.PI * 2;
    return ((angle + Math.PI) % pi2) - Math.PI;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }
}

type SceneKey = 'explore' | 'pheromones' | 'home';

interface SceneRuntime {
  controller: CanvasController;
  state: SceneState;
}

type SceneState = ExploreSceneState | PheromoneSceneState | HomeSceneState;

interface InsightAnt {
  position: Vector2;
  direction: number;
  speed: number;
  carrying: boolean;
}

interface ExploreSceneState {
  type: 'explore';
  ant: InsightAnt;
  targetDirection: number;
  changeTimer: number;
  nextChange: number;
  trail: Vector2[];
  distanceAccumulator: number;
  sensorPhase: number;
}

interface PathData {
  points: Vector2[];
  segments: PathSegment[];
  totalLength: number;
}

interface PathSegment {
  from: Vector2;
  to: Vector2;
  length: number;
}

interface PathWalker {
  progress: number;
  direction: 1 | -1;
  speed: number;
  carrying: boolean;
}

interface PathPose {
  position: Vector2;
  direction: number;
}

interface PheromoneSceneState {
  type: 'pheromones';
  nest: Vector2;
  food: Vector2;
  path: PathData;
  pulse: number;
  forager: PathWalker;
  carrier: PathWalker;
}

interface HomeSceneState {
  type: 'home';
  nest: Vector2;
  haloPhase: number;
  orbitAngle: number;
  returnProgress: number;
  returnPath: PathData;
  returnSpeed: number;
}
