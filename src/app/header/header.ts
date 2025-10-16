import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';

@Component({
  selector: 'app-header',
  standalone: true,
  templateUrl: './header.html',
  styleUrl: './header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Header {
  private readonly storageKey = 'swarm-theme-mode';
  private readonly destroyRef = inject(DestroyRef);
  readonly theme = signal<'light' | 'dark'>(this.detectInitialTheme());

  constructor() {
    const themeEffect = effect(() => {
      this.applyTheme(this.theme());
    });

    this.destroyRef.onDestroy(() => {
      themeEffect.destroy();
    });
  }

  toggleTheme() {
    const next = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    this.persistTheme(next);
  }

  scrollTo(targetId: string, event?: Event) {
    if (event) {
      event.preventDefault();
    }
    if (typeof document === 'undefined') return;
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private detectInitialTheme(): 'light' | 'dark' {
    if (typeof document === 'undefined') {
      return 'dark';
    }

    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
      /* ignore persistence errors */
    }

    if (typeof window !== 'undefined') {
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        return 'dark';
      }
    }

    return 'dark';
  }

  private applyTheme(mode: 'light' | 'dark') {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset['theme'] = mode;
    root.classList.toggle('theme-dark', mode === 'dark');
    root.classList.toggle('theme-light', mode === 'light');
  }

  private persistTheme(mode: 'light' | 'dark') {
    if (typeof document === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, mode);
    } catch {
      /* ignore */
    }
  }
}
