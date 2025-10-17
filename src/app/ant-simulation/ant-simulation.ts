import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  inject,
  signal,
  WritableSignal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';
import { Canvas } from '../canvas/canvas';
import { SwarmInsights } from '../swarm-insights/swarm-insights';
import { CanvasController, CanvasPointerEvent } from '../interfaces/canvas';
import {
  Ant,
  FoodSource,
  PheromoneGrid,
  SimulationSettings,
  SimulationState,
} from '../interfaces/simulation';
import { Vector2, WorldDimensions } from '../interfaces/primitives';

type SimulationLifecycle = 'idle' | 'running' | 'paused';
type FoodPlacementMode = 'none' | 'click' | 'drag';

interface AntSpawnConfig {
  angleSpread: number;
  directionJitter: number;
}

const WORLD_DIMENSIONS: WorldDimensions = { width: 120, height: 80 };
const NEST_RADIUS = 4;
const FOOD_RADIUS_DEFAULT = 3;
const FOOD_CAPACITY_DEFAULT = 250;
const FOOD_DEPLETION_DEFAULT = 0.05;
const PHEROMONE_CELL_SIZE = 1;
const SIMULATION_STEP = 0.05; // seconds
const MAX_FRAME_DELTA = 0.5; // seconds
const FOOD_RETURN_TIMEOUT = 35; // seconds
const NEST_SIGNAL_DURATION = 6; // seconds
const NEST_SIGNAL_DEPOSIT_INTERVAL = 0.15; // seconds
const NEST_SIGNAL_STRENGTH = 0.45;
const NEST_SIGNAL_DECAY_RATE = 0.28;
const MAX_FOOD_SOURCES = 5;
const FOOD_RESPAWN_MIN_DELAY = 18; // seconds
const FOOD_RESPAWN_MAX_DELAY = 32; // seconds

@Component({
  selector: 'app-ant-simulation',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, Canvas, SwarmInsights],
  templateUrl: './ant-simulation.html',
  styleUrl: './ant-simulation.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AntSimulation implements OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly world = WORLD_DIMENSIONS;

  readonly controls = this.fb.group({
    antCount: [200, [Validators.required, Validators.min(10), Validators.max(500)]],
    antSpeed: [7, [Validators.required, Validators.min(1), Validators.max(20)]],
    pheromoneInfluence: [0.9, [Validators.required, Validators.min(0), Validators.max(5)]],
    randomness: [0.7, [Validators.required, Validators.min(0), Validators.max(5)]],
    evaporationRate: [0.15, [Validators.required, Validators.min(0), Validators.max(1)]],
    depositionRate: [0.55, [Validators.required, Validators.min(0), Validators.max(5)]],
    timeScale: [3, [Validators.required, Validators.min(0.1), Validators.max(4)]],
    allowFoodDepletion: [false],
    depletionMultiplier: [1, [Validators.required, Validators.min(0), Validators.max(5)]],
  });

  readonly foodControls = this.fb.group({
    capacity: [FOOD_CAPACITY_DEFAULT, [Validators.required, Validators.min(10), Validators.max(1000)]],
    radius: [FOOD_RADIUS_DEFAULT, [Validators.required, Validators.min(1), Validators.max(10)]],
    depletionRate: [
      FOOD_DEPLETION_DEFAULT,
      [Validators.required, Validators.min(0.01), Validators.max(0.5)],
    ],
  });

  readonly status: WritableSignal<SimulationLifecycle> = signal('idle');
  readonly stats = signal({ deliveredFood: 0, elapsedSeconds: 0 });
  readonly activePlacement = signal<FoodPlacementMode>('click');
  readonly showPheromones = signal(true);
  readonly autoFoodEnabled = signal(true);
  readonly presentationMode = signal(false);

  private controller: CanvasController | null = null;
  private simulation: SimulationState | null = null;
  private initialFoodSources: FoodSource[] = [];
  private activeSettings: SimulationSettings = this.createSettingsSnapshot();
  private subscriptions = new Subscription();
  private presentationSnapshot: { antCount: number | null; placement: FoodPlacementMode } | null = null;

  private animationHandle: number | null = null;
  private lastTimestamp: number | null = null;
  private accumulator = 0;

  private dragPreview: FoodSource | null = null;
  private dragPointerId: number | null = null;

  constructor(private readonly cdr: ChangeDetectorRef) {
    this.subscriptions.add(
      this.controls.valueChanges.subscribe(() => {
        this.activeSettings = this.createSettingsSnapshot();
      })
    );

    this.subscriptions.add(
      this.foodControls.valueChanges.subscribe(() => {
        // Mark for check so the template reflects new preview values.
        this.cdr.markForCheck();
      })
    );
  }

  ngOnDestroy(): void {
    this.stopLoop();
    this.subscriptions.unsubscribe();
  }

  handleCanvasReady(controller: CanvasController) {
    this.controller = controller;
    this.render();
  }

  handlePointerDown(event: CanvasPointerEvent) {
    if (!this.controller) {
      return;
    }

    const mode = this.activePlacement();
    const lifecycle = this.status();
    if (mode === 'none') {
      return;
    }

    if (mode === 'click') {
      const source = this.createFoodSource(event.position);
      if (lifecycle === 'idle') {
        this.initialFoodSources.push(source);
      } else {
        this.simulation?.foodSources.push(source);
      }
      this.render();
      return;
    }

    if (mode === 'drag') {
      const food = this.createFoodSource(event.position);
      this.dragPreview = food;
      this.dragPointerId = event.originalEvent.pointerId;
      try {
        this.controller.canvas.setPointerCapture(this.dragPointerId);
      } catch {
        // Pointer capture can fail in some browsers (Safari). Ignore gracefully.
      }
      this.render();
    }
  }

  handlePointerMove(event: CanvasPointerEvent) {
    if (!this.dragPreview) {
      return;
    }
    this.dragPreview.position = this.clampToWorld(event.position);
    this.render();
  }

  togglePlacement(mode: FoodPlacementMode) {
    const current = this.activePlacement();
    this.activePlacement.set(current === mode ? 'none' : mode);
    this.render();
  }

  togglePheromoneVisibility() {
    this.showPheromones.set(!this.showPheromones());
    this.render();
  }

  toggleAutoFood() {
    const enabled = !this.autoFoodEnabled();
    this.autoFoodEnabled.set(enabled);
    if (enabled && this.simulation) {
      this.simulation.foodRespawnTimer = this.nextFoodRespawnDelay();
    }
  }

  togglePresentationMode() {
    if (this.presentationMode()) {
      this.deactivatePresentationMode();
    } else {
      this.activatePresentationMode();
    }
  }

  private activatePresentationMode() {
    const antControl = this.controls.get('antCount');
    const currentAnts = antControl?.value ?? null;
    this.presentationSnapshot = {
      antCount: currentAnts,
      placement: this.activePlacement(),
    };
    if (currentAnts !== null && currentAnts > 80 && antControl) {
      antControl.setValue(80);
    }
    this.activePlacement.set('none');
    this.presentationMode.set(true);
    this.requestFullscreen();
    this.cdr.markForCheck();
    this.render();
  }

  private deactivatePresentationMode(options?: { skipFullscreenExit?: boolean }) {
    const antControl = this.controls.get('antCount');
    const snapshot = this.presentationSnapshot;
    if (snapshot && snapshot.antCount !== null && antControl) {
      const previous = snapshot.antCount;
      if (antControl.value !== previous) {
        antControl.setValue(previous);
      }
    }
    if (snapshot && snapshot.placement) {
      this.activePlacement.set(snapshot.placement);
    } else {
      this.activePlacement.set('click');
    }
    this.presentationSnapshot = null;
    this.presentationMode.set(false);
    if (!options?.skipFullscreenExit) {
      this.exitFullscreen();
    }
    this.cdr.markForCheck();
    this.render();
  }

  private requestFullscreen() {
    if (typeof document === 'undefined') {
      return;
    }
    if (document.fullscreenElement) {
      return;
    }
    const element = this.host.nativeElement;
    const request =
      element.requestFullscreen ||
      (element as any).webkitRequestFullscreen ||
      (element as any).mozRequestFullScreen ||
      (element as any).msRequestFullscreen;
    if (typeof request === 'function') {
      try {
        const result = request.call(element);
        if (result instanceof Promise) {
          result.catch(() => {
            /* Fullscreen request failed; ignore for graceful fallback. */
          });
        }
      } catch {
        // Ignore fullscreen errors to avoid disrupting the demo.
      }
    }
  }

  private exitFullscreen() {
    if (typeof document === 'undefined') {
      return;
    }
    if (!document.fullscreenElement) {
      return;
    }
    const exit =
      document.exitFullscreen ||
      (document as any).webkitExitFullscreen ||
      (document as any).mozCancelFullScreen ||
      (document as any).msExitFullscreen;
    if (typeof exit === 'function') {
      try {
        const result = exit.call(document);
        if (result instanceof Promise) {
          result.catch(() => {
            /* Ignore errors when leaving fullscreen. */
          });
        }
      } catch {
        // Ignore exit errors.
      }
    }
  }

  startSimulation() {
    this.activeSettings = this.createSettingsSnapshot();
    const state = this.createInitialState(this.activeSettings);
    state.foodSources = this.initialFoodSources.map((source) => ({
      ...source,
      position: { ...source.position },
    }));
    this.simulation = state;
    this.status.set('running');
    this.stats.set({ deliveredFood: 0, elapsedSeconds: 0 });
    this.accumulator = 0;
    this.lastTimestamp = null;
    this.startLoop();
    this.render();
  }

  resumeSimulation() {
    if (this.status() !== 'paused') return;
    this.status.set('running');
    this.startLoop();
  }

  pauseSimulation() {
    if (this.status() !== 'running') return;
    this.status.set('paused');
    this.stopLoop();
    this.lastTimestamp = null;
    this.render();
  }

  resetSimulation() {
    this.stopLoop();
    this.simulation = null;
    this.initialFoodSources = [];
    this.stats.set({ deliveredFood: 0, elapsedSeconds: 0 });
    this.status.set('idle');
    this.accumulator = 0;
    this.lastTimestamp = null;
    this.activePlacement.set('none');
    this.dragPreview = null;
    this.dragPointerId = null;
    this.render();
  }

  private startLoop() {
    if (typeof window === 'undefined') {
      return;
    }
    if (this.animationHandle !== null) {
      cancelAnimationFrame(this.animationHandle);
    }
    this.animationHandle = requestAnimationFrame((timestamp) => this.tick(timestamp));
  }

  private stopLoop() {
    if (this.animationHandle !== null) {
      cancelAnimationFrame(this.animationHandle);
      this.animationHandle = null;
    }
  }

  private tick(timestamp: number) {
    if (this.status() !== 'running') {
      this.animationHandle = null;
      return;
    }

    if (!this.simulation) {
      this.render();
      this.animationHandle = requestAnimationFrame((next) => this.tick(next));
      return;
    }

    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      this.render();
      this.animationHandle = requestAnimationFrame((next) => this.tick(next));
      return;
    }

    const rawDelta = (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;

    const settings = this.activeSettings;
    const scaledDelta = Math.min(rawDelta * settings.timeScale, MAX_FRAME_DELTA);
    this.accumulator += scaledDelta;

    while (this.accumulator >= SIMULATION_STEP) {
      this.updateSimulation(SIMULATION_STEP, settings);
      this.accumulator -= SIMULATION_STEP;
    }

    this.render();
    this.animationHandle = requestAnimationFrame((next) => this.tick(next));
  }

  private updateSimulation(delta: number, settings: SimulationSettings) {
    const state = this.simulation;
    if (!state) {
      return;
    }

    state.stats.elapsedSeconds += delta;
    this.stats.set({ ...state.stats });

    this.evaporatePheromones(state.homePheromones, settings.evaporationRate, delta);
    this.evaporatePheromones(state.foodPheromones, settings.evaporationRate, delta);
    this.evaporatePheromones(state.nestSignals, NEST_SIGNAL_DECAY_RATE, delta);

    this.updateAntPopulation(state, settings.antCount, {
      angleSpread: Math.PI / 12,
      directionJitter: 0.4,
    });

    const nestPosition = state.nest.position;

    for (const ant of state.ants) {
      this.updateAnt(ant, state, settings, delta, nestPosition);
    }

    this.handleFoodDepletion(state, settings, delta);
    this.reinforceFoodSources(state.foodPheromones, state.foodSources, delta);
    this.updateFoodRespawn(state, delta);
  }

  private updateAnt(
    ant: Ant,
    state: SimulationState,
    settings: SimulationSettings,
    delta: number,
    nestPosition: Vector2
  ) {
    if (ant.carryingFood) {
      ant.carryingTime += delta;
      if (!ant.forceReturn && ant.carryingTime >= FOOD_RETURN_TIMEOUT) {
        ant.forceReturn = true;
        ant.carryingTime = 0;
      }
    } else {
      ant.carryingTime = 0;
      ant.forceReturn = false;
    }

    const targetGrid = ant.carryingFood ? state.homePheromones : state.foodPheromones;
    let depositGrid = ant.carryingFood ? state.foodPheromones : state.homePheromones;

    const homeVector = {
      x: -ant.pathIntegration.x,
      y: -ant.pathIntegration.y,
    };
    const homeVectorLength = Math.hypot(homeVector.x, homeVector.y);
    const homeAngle = homeVectorLength > 0.001 ? Math.atan2(homeVector.y, homeVector.x) : null;

    const pheromoneDirection = this.samplePheromoneDirection(
      ant,
      targetGrid,
      settings,
      ant.carryingFood
        ? {
            probeDistance: ant.forceReturn ? 6 : 5,
            offsets: ant.forceReturn
              ? [-Math.PI / 2.8, -Math.PI / 5, 0, Math.PI / 5, Math.PI / 2.8]
              : undefined,
            secondaryGrid: state.nestSignals,
            secondaryWeight: ant.forceReturn ? 0.9 : 0.55,
            influenceMultiplier: ant.forceReturn ? 1.65 : 1.25,
          }
        : undefined
    );
    const randomnessFactor = ant.forceReturn ? 0.35 : 1;
    const randomJitter = (Math.random() - 0.5) * settings.randomness * randomnessFactor;

    let desiredDirection = ant.direction;

    if (ant.carryingFood) {
      if (pheromoneDirection !== null) {
        const influence = ant.forceReturn
          ? Math.min(1, settings.pheromoneInfluence * 1.35)
          : settings.pheromoneInfluence;
        desiredDirection = this.interpolateAngle(ant.direction, pheromoneDirection, influence);
      } else {
        const localFoodSignal = this.sampleGridValue(state.foodPheromones, ant.position);
        if (localFoodSignal <= 0.02) {
          const fallbackBias = ant.forceReturn ? 0.55 : 0.2;
          desiredDirection = this.interpolateAngle(ant.direction, homeAngle ?? ant.direction, fallbackBias);
        }
        desiredDirection += randomJitter * (ant.forceReturn ? 0.4 : 1);
      }
    } else if (pheromoneDirection !== null) {
      desiredDirection = this.interpolateAngle(ant.direction, pheromoneDirection, settings.pheromoneInfluence);
    } else {
      desiredDirection = ant.direction + randomJitter;
    }

    desiredDirection += randomJitter * (ant.forceReturn ? 0.1 : 0.25);

    if (ant.carryingFood && homeAngle !== null) {
      const integrationBias = ant.forceReturn ? 0.55 : 0.2;
      desiredDirection = this.interpolateAngle(desiredDirection, homeAngle, integrationBias);
    }

    ant.direction = this.wrapAngle(desiredDirection);

    const previousPosition = { ...ant.position };
    const moveDistance = settings.antSpeed * delta;
    const movedDistance = this.advanceAntWithinWorld(ant, moveDistance, nestPosition);
    ant.pathIntegration.x += ant.position.x - previousPosition.x;
    ant.pathIntegration.y += ant.position.y - previousPosition.y;

    const maxPathLength = Math.max(this.world.width, this.world.height) * 1.5;
    const currentPathLength = Math.hypot(ant.pathIntegration.x, ant.pathIntegration.y);
    if (currentPathLength > maxPathLength) {
      const scale = maxPathLength / currentPathLength;
      ant.pathIntegration.x *= scale;
      ant.pathIntegration.y *= scale;
    }

    if (movedDistance < 0.025) {
      ant.stalledTime += delta;
      if (ant.stalledTime > 0.4 && this.isAtWorldEdge(ant.position)) {
        // Nudge ants back inside the world bounds when they get stuck at the edge.
        const escapeAngle = Math.atan2(nestPosition.y - ant.position.y, nestPosition.x - ant.position.x);
        const deflect = (Math.random() - 0.5) * Math.PI * 0.4;
        ant.direction = this.wrapAngle(escapeAngle + deflect);
      }
    } else {
      ant.stalledTime = 0;
    }

    depositGrid = ant.carryingFood ? state.foodPheromones : state.homePheromones;

    const depositInterval = 0.1;
    if (ant.stalledTime < 0.3) {
      ant.depositAccumulator += delta;
      if (ant.depositAccumulator >= depositInterval) {
        const count = Math.floor(ant.depositAccumulator / depositInterval);
        ant.depositAccumulator -= depositInterval * count;
        this.depositPheromone(depositGrid, ant.position, settings.depositionRate * count);
      }
    } else {
      ant.depositAccumulator = Math.min(ant.depositAccumulator, depositInterval);
    }

    if (ant.nestSignalTimer > 0) {
      ant.nestSignalTimer = Math.max(0, ant.nestSignalTimer - delta);
      if (ant.stalledTime < 0.3) {
        ant.nestSignalAccumulator += delta;
        if (ant.nestSignalAccumulator >= NEST_SIGNAL_DEPOSIT_INTERVAL) {
          const count = Math.floor(ant.nestSignalAccumulator / NEST_SIGNAL_DEPOSIT_INTERVAL);
          ant.nestSignalAccumulator -= NEST_SIGNAL_DEPOSIT_INTERVAL * count;
          this.markNestSignal(state.nestSignals, ant.position, NEST_SIGNAL_STRENGTH * count);
        }
      }
    } else {
      ant.nestSignalAccumulator = 0;
    }

    if (ant.carryingFood) {
      const distanceToNest = this.distance(ant.position, nestPosition);
      if (distanceToNest <= state.nest.radius) {
        ant.carryingFood = false;
        ant.carryingTime = 0;
        ant.forceReturn = false;
        ant.nestSignalTimer = NEST_SIGNAL_DURATION;
        ant.nestSignalAccumulator = 0;
        state.stats.deliveredFood += 1;
        this.stats.set({ ...state.stats });

        const outboundDirection = this.samplePheromoneDirection(ant, state.foodPheromones, settings);
        if (outboundDirection !== null) {
          ant.direction = outboundDirection;
        } else {
          const nestAngle = Math.atan2(nestPosition.y - ant.position.y, nestPosition.x - ant.position.x);
          ant.direction = this.wrapAngle(nestAngle + Math.PI + (Math.random() - 0.5) * Math.PI * 0.3);
        }

        ant.position = this.clampToWorld({
          x: nestPosition.x + Math.cos(ant.direction) * (state.nest.radius + 0.5),
          y: nestPosition.y + Math.sin(ant.direction) * (state.nest.radius + 0.5),
        });

        ant.pathIntegration = {
          x: ant.position.x - nestPosition.x,
          y: ant.position.y - nestPosition.y,
        };
      }
    } else {
      const distanceToNest = this.distance(ant.position, nestPosition);
      if (distanceToNest <= state.nest.radius) {
        ant.pathIntegration = {
          x: ant.position.x - nestPosition.x,
          y: ant.position.y - nestPosition.y,
        };
      }
      const source = this.findFoodSource(state, ant.position);
      if (source) {
        ant.carryingFood = true;
        ant.carryingTime = 0;
        source.capacity = Math.max(0, source.capacity - 1);
      }
    }
  }

  private updateAntPopulation(state: SimulationState, targetCount: number, config: AntSpawnConfig) {
    const currentCount = state.ants.length;
    if (currentCount === targetCount) {
      return;
    }

    if (targetCount > currentCount) {
      const additional = targetCount - currentCount;
      for (let i = 0; i < additional; i++) {
        state.ants.push(
          this.createAnt(state.ants.length + i, state.nest.position, config.angleSpread, config.directionJitter)
        );
      }
      return;
    }

    state.ants.splice(targetCount);
  }

  private evaporatePheromones(grid: PheromoneGrid, evaporationRate: number, delta: number) {
    const factor = Math.max(0, 1 - evaporationRate * delta);
    const { values } = grid;
    for (let i = 0; i < values.length; i++) {
      const nextValue = values[i] * factor;
      values[i] = nextValue > 0.001 ? nextValue : 0;
    }
  }

  private depositPheromone(grid: PheromoneGrid, position: Vector2, amount: number) {
    const { index, weight } = this.sampleGridCell(grid, position);
    if (index < 0) {
      return;
    }
    grid.values[index] = Math.min(1, grid.values[index] + amount * weight);
  }

  private markNestSignal(grid: PheromoneGrid, position: Vector2, amount: number) {
    const { index, weight } = this.sampleGridCell(grid, position);
    if (index < 0) {
      return;
    }
    grid.values[index] = Math.min(1, grid.values[index] + amount * weight);
  }

  private reinforceFoodSources(grid: PheromoneGrid, sources: FoodSource[], delta: number) {
    if (sources.length === 0) {
      return;
    }
    const baseAmount = Math.max(0.08, 4 * delta);
    for (const source of sources) {
      if (source.capacity <= 0) {
        continue;
      }
      this.depositPheromone(grid, source.position, baseAmount);
      const ringSamples = Math.max(8, Math.ceil(source.radius * 6));
      const innerRadius = Math.max(0.4, source.radius * 0.45);
      const outerRadius = Math.max(innerRadius, source.radius * 0.9);
      for (let i = 0; i < ringSamples; i++) {
        const angle = (Math.PI * 2 * i) / ringSamples;
        const innerPoint = {
          x: source.position.x + Math.cos(angle) * innerRadius,
          y: source.position.y + Math.sin(angle) * innerRadius,
        };
        const outerPoint = {
          x: source.position.x + Math.cos(angle) * outerRadius,
          y: source.position.y + Math.sin(angle) * outerRadius,
        };
        this.depositPheromone(grid, innerPoint, baseAmount * 0.6);
        this.depositPheromone(grid, outerPoint, baseAmount * 0.4);
      }
    }
  }

  private updateFoodRespawn(state: SimulationState, delta: number) {
    if (!this.autoFoodEnabled()) {
      return;
    }
    if (state.foodSources.length >= MAX_FOOD_SOURCES) {
      state.foodRespawnTimer = Math.max(state.foodRespawnTimer, this.nextFoodRespawnDelay());
      return;
    }

    state.foodRespawnTimer -= delta;
    if (state.foodRespawnTimer > 0) {
      return;
    }

    const availableSlots = Math.max(0, MAX_FOOD_SOURCES - state.foodSources.length);
    const spawnCount = Math.min(availableSlots, this.randomInt(2, 3));
    if (spawnCount > 0) {
      this.spawnRandomFood(state, spawnCount);
    }
    state.foodRespawnTimer = this.nextFoodRespawnDelay();
  }

  private spawnRandomFood(state: SimulationState, count: number) {
    if (count <= 0) return;
    const nest = state.nest.position;
    const minDistance = state.nest.radius + 6;

    for (let i = 0; i < count; i++) {
      let attempts = 0;
      let position: Vector2 | null = null;
      while (attempts < 50) {
        attempts++;
        const candidate = {
          x: Math.random() * this.world.width,
          y: Math.random() * this.world.height,
        };
        if (this.distance(candidate, nest) < minDistance) {
          continue;
        }
        let tooClose = false;
        for (const source of state.foodSources) {
          if (this.distance(candidate, source.position) < source.radius + 2) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) {
          position = candidate;
          break;
        }
      }
      if (!position) {
        continue;
      }
      const source = this.createFoodSource(position);
      state.foodSources.push(source);
    }
  }

  private nextFoodRespawnDelay(): number {
    if (FOOD_RESPAWN_MAX_DELAY <= FOOD_RESPAWN_MIN_DELAY) {
      return FOOD_RESPAWN_MIN_DELAY;
    }
    return FOOD_RESPAWN_MIN_DELAY + Math.random() * (FOOD_RESPAWN_MAX_DELAY - FOOD_RESPAWN_MIN_DELAY);
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private handleFoodDepletion(state: SimulationState, settings: SimulationSettings, delta: number) {
    const passiveEnabled = settings.allowFoodDepletion;
    const multiplier = Math.max(0, settings.depletionMultiplier);

    state.foodSources = state.foodSources.filter((source) => {
      if (passiveEnabled && source.capacity > 0) {
        const depletion = source.depletionRate * multiplier * delta;
        source.capacity = Math.max(0, source.capacity - depletion);
      }
      return source.capacity > 0.1;
    });
  }

  private findFoodSource(state: SimulationState, position: Vector2): FoodSource | null {
    for (const source of state.foodSources) {
      const distance = this.distance(position, source.position);
      if (distance <= source.radius && source.capacity > 0) {
        return source;
      }
    }
    return null;
  }

  private samplePheromoneDirection(
    ant: Ant,
    grid: PheromoneGrid,
    settings: SimulationSettings,
    options?: {
      probeDistance?: number;
      offsets?: number[];
      secondaryGrid?: PheromoneGrid;
      secondaryWeight?: number;
      influenceMultiplier?: number;
    }
  ): number | null {
    const samples: { angle: number; intensity: number }[] = [];
    const spread = Math.PI / 3;
    const offsets = options?.offsets ?? [-spread, 0, spread];
    const probeDistance = options?.probeDistance ?? 4;
    const secondaryGrid = options?.secondaryGrid;
    const secondaryWeight = options?.secondaryWeight ?? 0;

    for (const offset of offsets) {
      const angle = ant.direction + offset;
      const samplePoint = {
        x: ant.position.x + Math.cos(angle) * probeDistance,
        y: ant.position.y + Math.sin(angle) * probeDistance,
      };
      let intensity = this.sampleGridValue(grid, samplePoint);
      if (secondaryGrid && secondaryWeight > 0) {
        intensity += this.sampleGridValue(secondaryGrid, samplePoint) * secondaryWeight;
      }
      if (intensity > 0) {
        samples.push({ angle, intensity });
      }
    }

    if (!samples.length) {
      return null;
    }

    samples.sort((a, b) => b.intensity - a.intensity);
    const strongest = samples[0]!;
    const alpha = Math.max(0, settings.pheromoneInfluence) * (options?.influenceMultiplier ?? 1);
    const bias = alpha / (alpha + 1);
    const weightedAngle = this.interpolateAngle(ant.direction, strongest.angle, bias);
    return weightedAngle;
  }

  private render() {
    if (!this.controller) {
      return;
    }

    const ctx = this.controller;
    ctx.clear('#020817');

    ctx.withWorldSpace((canvasCtx) => {
      canvasCtx.fillStyle = '#0f172a';
      const { width, height } = this.world;
      canvasCtx.fillRect(0, 0, width, height);
    });

    if (this.simulation) {
      if (this.showPheromones()) {
        this.drawPheromones(this.simulation.homePheromones, 'rgba(96, 165, 250, 0.55)');
        this.drawPheromones(this.simulation.foodPheromones, 'rgba(16, 185, 129, 0.55)');
        this.drawPheromones(this.simulation.nestSignals, 'rgba(253, 224, 71, 0.5)');
      } else {
        // Still render a subtle hint of the nest signals when pheromones are hidden.
        this.drawPheromones(this.simulation.nestSignals, 'rgba(253, 224, 71, 0.25)');
      }
    }

    this.drawNest();
    const foodSources = this.simulation ? this.simulation.foodSources : this.initialFoodSources;
    if (foodSources.length) {
      this.drawFoodSources(foodSources);
    }
    if (this.simulation) {
      this.drawAnts(this.simulation.ants);
    }

    if (this.dragPreview) {
      this.drawFoodSources([this.dragPreview], true);
    }
  }

  private drawNest() {
    if (!this.controller) {
      return;
    }
    this.controller.drawCircle(
      { x: this.world.width / 2, y: this.world.height / 2 },
      NEST_RADIUS,
      {
        fillStyle: '#fbbf24',
        strokeStyle: '#f59e0b',
        lineWidth: 0.5,
        alpha: 0.95,
      }
    );
  }

  private drawFoodSources(sources: FoodSource[], isPreview = false) {
    if (!this.controller || !sources.length) {
      return;
    }

    for (const source of sources) {
      const fill = isPreview ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.65)';
      const stroke = isPreview ? 'rgba(34,197,94,0.7)' : '#15803d';
      this.controller.drawCircle(source.position, source.radius, {
        fillStyle: fill,
        strokeStyle: stroke,
        lineWidth: 0.75,
      });

      if (!isPreview) {
        const capacityRatio = source.capacity / source.maxCapacity;
        const ringRadius = source.radius + 0.6;
        this.controller.drawCircle(source.position, ringRadius, {
          strokeStyle: '#22c55e',
          lineWidth: 0.4,
          alpha: 0.4 + 0.6 * capacityRatio,
        });
      }
    }
  }

  private drawAnts(ants: Ant[]) {
    if (!this.controller) {
      return;
    }

    const antCount = Math.max(ants.length, 1);
    const densityRatio = Math.min(1, antCount / 150);
    const baseScale = 1 + (1 - densityRatio) * 0.9;
    const presentationBoost = this.presentationMode() ? 1.2 : 1;
    const sizeMultiplier = Math.min(2.4, baseScale * presentationBoost);
    const highDetail = antCount <= 140;
    const abdomenRadius = (highDetail ? 0.42 : 0.36) * sizeMultiplier;
    const thoraxRadius = (highDetail ? 0.34 : 0.3) * sizeMultiplier;
    const headRadius = (highDetail ? 0.28 : 0.26) * sizeMultiplier;
    const legReach = 0.7 * sizeMultiplier;
    const legThickness = (highDetail ? 0.18 : 0.14) * Math.max(1, sizeMultiplier * 0.75);
    const bodyStrokeWidth = 0.22 * Math.max(1, sizeMultiplier * 0.78);
    const legOffsets = [-0.35, 0, 0.35];
    const bodySpacing = 0.2 * sizeMultiplier;
    const abdomenOffset = 0.6 * sizeMultiplier;
    const headOffset = 0.8 * sizeMultiplier;
    const legAttachmentScale = Math.max(1, sizeMultiplier * 0.85);

    this.controller.withWorldSpace((ctx) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const ant of ants) {
        const forward = { x: Math.cos(ant.direction), y: Math.sin(ant.direction) };
        const perp = { x: -forward.y, y: forward.x };

        const thoraxCenter = {
          x: ant.position.x + forward.x * bodySpacing,
          y: ant.position.y + forward.y * bodySpacing,
        };
        const abdomenCenter = {
          x: thoraxCenter.x - forward.x * abdomenOffset,
          y: thoraxCenter.y - forward.y * abdomenOffset,
        };
        const headCenter = {
          x: thoraxCenter.x + forward.x * headOffset,
          y: thoraxCenter.y + forward.y * headOffset,
        };

        const bodyColor = ant.carryingFood ? '#f97316' : '#f1f5f9';
        const strokeColor = '#0f172a';

        if (highDetail) {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
          ctx.lineWidth = legThickness;
          for (const offset of legOffsets) {
            const attachment = {
              x: thoraxCenter.x + forward.x * offset * legAttachmentScale,
              y: thoraxCenter.y + forward.y * offset * legAttachmentScale,
            };
            const leftFoot = {
              x: attachment.x + perp.x * legReach,
              y: attachment.y + perp.y * legReach,
            };
            const rightFoot = {
              x: attachment.x - perp.x * legReach,
              y: attachment.y - perp.y * legReach,
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
        } else {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
          ctx.lineWidth = legThickness;
        }

        // Abdomen
        ctx.fillStyle = bodyColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = bodyStrokeWidth;
        ctx.beginPath();
        ctx.ellipse(
          abdomenCenter.x,
          abdomenCenter.y,
          abdomenRadius,
          abdomenRadius * 0.8,
          ant.direction,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();

        // Thorax
        ctx.beginPath();
        ctx.ellipse(
          thoraxCenter.x,
          thoraxCenter.y,
          thoraxRadius,
          thoraxRadius * 0.9,
          ant.direction,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();

        // Head
        ctx.beginPath();
        ctx.lineWidth = bodyStrokeWidth * 0.95;
        ctx.ellipse(
          headCenter.x,
          headCenter.y,
          headRadius,
          headRadius * 0.95,
          ant.direction,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();

        // Antennae
        if (highDetail) {
          const antennaBase = {
            x: headCenter.x + forward.x * headRadius * 0.6,
            y: headCenter.y + forward.y * headRadius * 0.6,
          };
          const antennaLength = headRadius * 1.8;
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
          ctx.lineWidth = Math.max(0.12, bodyStrokeWidth * 0.45);
          ctx.beginPath();
          ctx.moveTo(antennaBase.x, antennaBase.y);
          ctx.lineTo(
            antennaBase.x + (forward.x + perp.x * 0.5) * antennaLength,
            antennaBase.y + (forward.y + perp.y * 0.5) * antennaLength
          );
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(antennaBase.x, antennaBase.y);
          ctx.lineTo(
            antennaBase.x + (forward.x - perp.x * 0.5) * antennaLength,
            antennaBase.y + (forward.y - perp.y * 0.5) * antennaLength
          );
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }

  private drawPheromones(grid: PheromoneGrid, color: string) {
    if (!this.controller) {
      return;
    }

    const { cellSize, columns, values } = grid;
    this.controller.withWorldSpace((ctx) => {
      for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < columns; col++) {
          const value = values[row * columns + col];
          if (value <= 0.01) continue;
          ctx.fillStyle = color;
          ctx.globalAlpha = Math.min(0.7, value);
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  private createInitialState(settings: SimulationSettings): SimulationState {
    const nestPosition = { x: this.world.width / 2, y: this.world.height / 2 };
    const ants: Ant[] = [];
    for (let i = 0; i < settings.antCount; i++) {
      ants.push(this.createAnt(i, nestPosition, Math.PI / 6, 0.35));
    }

    return {
      nest: {
        position: nestPosition,
        radius: NEST_RADIUS,
      },
      ants,
      foodSources: [],
      homePheromones: this.createPheromoneGrid(),
      foodPheromones: this.createPheromoneGrid(),
      nestSignals: this.createPheromoneGrid(),
      stats: {
        deliveredFood: 0,
        elapsedSeconds: 0,
      },
      foodRespawnTimer: this.nextFoodRespawnDelay(),
    };
  }

  private createAnt(id: number, position: Vector2, spread: number, jitter: number): Ant {
    const baseAngle = Math.random() * Math.PI * 2;
    const direction = this.wrapAngle(baseAngle + (Math.random() - 0.5) * spread);
    return {
      id,
      position: { ...position },
      direction,
      carryingFood: false,
      speed: 0,
      pheromoneCooldown: 0,
      depositAccumulator: 0,
      personalIntensity: 0,
      lastDirection: direction + (Math.random() - 0.5) * jitter,
      stalledTime: 0,
      carryingTime: 0,
      forceReturn: false,
      nestSignalTimer: NEST_SIGNAL_DURATION,
      nestSignalAccumulator: 0,
      pathIntegration: { x: 0, y: 0 },
    };
  }

  private createPheromoneGrid(): PheromoneGrid {
    const columns = Math.ceil(this.world.width / PHEROMONE_CELL_SIZE);
    const rows = Math.ceil(this.world.height / PHEROMONE_CELL_SIZE);
    return {
      columns,
      rows,
      cellSize: PHEROMONE_CELL_SIZE,
      values: new Float32Array(columns * rows),
    };
  }

  private createSettingsSnapshot(): SimulationSettings {
    const controls = this.controls.value;
    return {
      antCount: controls.antCount ?? 120,
      antSpeed: controls.antSpeed ?? 7,
      pheromoneInfluence: controls.pheromoneInfluence ?? 0.9,
      randomness: controls.randomness ?? 0.7,
      evaporationRate: controls.evaporationRate ?? 0.035,
      depositionRate: controls.depositionRate ?? 0.55,
      timeScale: controls.timeScale ?? 3,
      allowFoodDepletion: controls.allowFoodDepletion ?? true,
      depletionMultiplier: controls.depletionMultiplier ?? 1,
      world: this.world,
    };
  }

  private createFoodSource(position: Vector2): FoodSource {
    const values = this.foodControls.value;
    const capacity = values.capacity ?? FOOD_CAPACITY_DEFAULT;
    const radius = values.radius ?? FOOD_RADIUS_DEFAULT;
    const depletionRate = values.depletionRate ?? FOOD_DEPLETION_DEFAULT;
    const id =
      typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `food-${Math.random().toString(36).slice(2)}`;
    return {
      id,
      position: this.clampToWorld(position),
      radius,
      capacity,
      maxCapacity: capacity,
      depletionRate,
    };
  }

  @HostListener('window:pointerup', ['$event'])
  handlePointerUp(event: PointerEvent) {
    if (!this.dragPreview) {
      return;
    }
    if (this.dragPointerId !== null && event.pointerId !== this.dragPointerId) {
      return;
    }

    if (this.controller) {
      try {
        this.controller.canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Release may fail if not captured; ignore.
      }
    }

    const position = this.controller ? this.pointerEventToWorld(event) : null;
    if (position) {
      this.dragPreview.position = this.clampToWorld(position);
    }

    const placed = { ...this.dragPreview };
    if (this.status() === 'idle') {
      this.initialFoodSources.push(placed);
    } else {
      this.simulation?.foodSources.push(placed);
    }

    this.dragPreview = null;
    this.dragPointerId = null;
    this.render();
  }

  @HostListener('document:fullscreenchange')
  handleFullscreenChange() {
    if (typeof document === 'undefined') {
      return;
    }
    if (!document.fullscreenElement && this.presentationMode()) {
      this.deactivatePresentationMode({ skipFullscreenExit: true });
    }
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey() {
    if (this.presentationMode()) {
      this.deactivatePresentationMode();
    }
  }

  private clampToWorld(position: Vector2): Vector2 {
    return {
      x: Math.max(0, Math.min(this.world.width, position.x)),
      y: Math.max(0, Math.min(this.world.height, position.y)),
    };
  }

  private getWorldCenter(): Vector2 {
    return { x: this.world.width / 2, y: this.world.height / 2 };
  }

  private isAtWorldEdge(position: Vector2, margin = 0.6): boolean {
    return (
      position.x <= margin ||
      position.y <= margin ||
      position.x >= this.world.width - margin ||
      position.y >= this.world.height - margin
    );
  }

  private isInsideWorld(position: Vector2, margin = 0): boolean {
    return (
      position.x >= margin &&
      position.y >= margin &&
      position.x <= this.world.width - margin &&
      position.y <= this.world.height - margin
    );
  }

  private advanceAntWithinWorld(ant: Ant, moveDistance: number, nestPosition: Vector2): number {
    if (moveDistance <= 0) {
      return 0;
    }

    const origin = { ...ant.position };
    const maxAttempts = 6;
    const margin = 0.05;
    let attempt = 0;
    let nextPosition = this.projectMove(origin, ant.direction, moveDistance);
    const preferredTarget = ant.carryingFood ? nestPosition : this.getWorldCenter();

    while (!this.isInsideWorld(nextPosition, margin) && attempt < maxAttempts) {
      attempt += 1;
      const inwardAngle = Math.atan2(preferredTarget.y - origin.y, preferredTarget.x - origin.x);
      const bias = 0.55 + Math.random() * 0.35;
      const jitter = (Math.random() - 0.5) * Math.PI * 0.25;
      ant.direction = this.wrapAngle(this.interpolateAngle(ant.direction, inwardAngle, bias) + jitter);
      nextPosition = this.projectMove(origin, ant.direction, moveDistance);
    }

    if (!this.isInsideWorld(nextPosition, margin)) {
      nextPosition = this.clampToWorld(nextPosition);
    }

    ant.position = nextPosition;
    return this.distance(origin, ant.position);
  }

  private projectMove(origin: Vector2, direction: number, distance: number): Vector2 {
    return {
      x: origin.x + Math.cos(direction) * distance,
      y: origin.y + Math.sin(direction) * distance,
    };
  }

  private distance(a: Vector2, b: Vector2): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private wrapAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    return ((angle % twoPi) + twoPi) % twoPi;
  }

  private interpolateAngle(from: number, to: number, bias: number): number {
    const difference = this.normalizeAngle(to - from);
    return from + difference * Math.min(1, Math.max(0, bias));
  }

  private normalizeAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    while (angle > Math.PI) {
      angle -= twoPi;
    }
    while (angle < -Math.PI) {
      angle += twoPi;
    }
    return angle;
  }

  private sampleGridValue(grid: PheromoneGrid, position: Vector2): number {
    const { index } = this.sampleGridCell(grid, position);
    if (index < 0) {
      return 0;
    }
    return grid.values[index];
  }

  private pointerEventToWorld(event: PointerEvent): Vector2 | null {
    if (!this.controller) {
      return null;
    }
    const rect = this.controller.canvas.getBoundingClientRect();
    const cssX = event.clientX - rect.left;
    const cssY = event.clientY - rect.top;
    const pixel = {
      x: cssX * this.controller.dimensions.devicePixelRatio,
      y: cssY * this.controller.dimensions.devicePixelRatio,
    };
    return this.controller.screenToWorld(pixel);
  }

  private sampleGridCell(grid: PheromoneGrid, position: Vector2): { index: number; weight: number } {
    const col = Math.floor(position.x / grid.cellSize);
    const row = Math.floor(position.y / grid.cellSize);
    if (col < 0 || row < 0 || col >= grid.columns || row >= grid.rows) {
      return { index: -1, weight: 0 };
    }
    const index = row * grid.columns + col;
    return { index, weight: 1 };
  }

  get activeAntCount(): number {
    if (this.simulation) {
      return this.simulation.ants.length;
    }
    return this.controls.value.antCount ?? 0;
  }

  get activeFoodCount(): number {
    if (this.simulation) {
      return this.simulation.foodSources.length;
    }
    return this.initialFoodSources.length;
  }

  formatElapsedTime(totalSeconds: number): string {
    const seconds = Math.max(0, totalSeconds);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
  }
}
