import { Vector2, WorldDimensions } from './primitives';

export interface Nest {
  position: Vector2;
  radius: number;
}

export interface FoodSource {
  id: string;
  position: Vector2;
  radius: number;
  capacity: number;
  maxCapacity: number;
  depletionRate: number;
}

export interface Ant {
  id: number;
  position: Vector2;
  direction: number;
  carryingFood: boolean;
  speed: number;
  pheromoneCooldown: number;
  depositAccumulator: number;
  personalIntensity: number;
  lastDirection: number;
  stalledTime: number;
  carryingTime: number;
  forceReturn: boolean;
  nestSignalTimer: number;
  nestSignalAccumulator: number;
  pathIntegration: Vector2;
}

export interface PheromoneGrid {
  columns: number;
  rows: number;
  cellSize: number;
  values: Float32Array;
}

export interface SimulationSettings {
  antCount: number;
  antSpeed: number;
  pheromoneInfluence: number;
  randomness: number;
  evaporationRate: number;
  depositionRate: number;
  timeScale: number;
  allowFoodDepletion: boolean;
  depletionMultiplier: number;
  world: WorldDimensions;
}

export interface SimulationState {
  nest: Nest;
  ants: Ant[];
  foodSources: FoodSource[];
  homePheromones: PheromoneGrid;
  foodPheromones: PheromoneGrid;
  nestSignals: PheromoneGrid;
  stats: SimulationStats;
  foodRespawnTimer: number;
}

export interface SimulationStats {
  deliveredFood: number;
  elapsedSeconds: number;
}
