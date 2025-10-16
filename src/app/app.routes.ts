import { Routes } from '@angular/router';
import { Landingpage } from './landingpage/landingpage';

export const routes: Routes = [
  { path: '', component: Landingpage },
  { path: '**', redirectTo: '' },
];
