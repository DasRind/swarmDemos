import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AntSimulation } from './ant-simulation';

describe('AntSimulation', () => {
  let component: AntSimulation;
  let fixture: ComponentFixture<AntSimulation>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AntSimulation]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AntSimulation);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
