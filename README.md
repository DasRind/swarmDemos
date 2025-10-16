# Swarm Demos

Canvas-basierte Visualisierungen rund um Schwarmintelligenz. Mehrere Ameisen simulieren kollektives Verhalten, bilden Pheromon-Pfade und reagieren auf dynamische Futterquellen – ideal als Demo für Robotik- oder KI-Workshops.

> Dieses Repository ist in [KuhLabs](../KuhLabs) als Tool mit dem Slug `swarm-demos` eingebunden.

## Highlights

- Angular 20 + TypeScript, gerendert über ein HTML-Canvas.
- Steuerpanel für Ameisenanzahl, Simulationstempo, Futterabbau u. v. m.
- Live-Manipulation der Umgebung (Futterquellen hinzufügen/entfernen).
- Modularer Simulationskern, gut erweiterbar um neue Verhaltensregeln.

## Lokale Entwicklung

```bash
npm install
ng serve
# http://localhost:4200/
```

Die App lädt automatisch neu, sobald sich Quellcode oder Styles ändern.

## Production Build

```bash
npm run build
# -> dist/swarmDemos/browser
```

Der Build produziert eine vollständig statische Ausgabe, die von KuhLabs in `public/embeds/swarm-demos` gespiegelt wird.

## Einbindung in KuhLabs

1. (Einmalig) Als Submodule hinzufügen:
   ```bash
   git submodule add ../swarmDemos external/tools/swarm-demos
   ```
2. Build & Sync innerhalb von KuhLabs ausführen:
   ```bash
   npm run tools:prepare
   ```
3. Tool steht anschließend unter `http://localhost:4200/tools/swarm-demos` bereit.

## Updates aus KuhLabs heraus

```bash
cd external/tools/swarm-demos
git pull
cd ../../..
npm run tools:refresh
```

Damit werden neue Commits des Submodules eingebunden, gebaut und in das Embed-Verzeichnis kopiert.

## Tests

- `ng test` – Unit-Tests via Karma.
- `ng e2e` – End-to-End-Tests (nach Wahl eines E2E-Frameworks).

## Weitere Ressourcen

- [Angular CLI Doku](https://angular.dev/tools/cli)
- [KuhLabs README](../KuhLabs/README.md) – Details zu Build-/Sync-Skripten für externe Tools.
