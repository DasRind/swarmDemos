import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AntSimulation } from '../ant-simulation/ant-simulation';

@Component({
  selector: 'app-landingpage',
  standalone: true,
  imports: [AntSimulation],
  templateUrl: './landingpage.html',
  styleUrl: './landingpage.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landingpage {}
