# 🐜 Ant Colony Simulation – Swarm Robotics Demo

## 🎯 Ziel

Diese Demo visualisiert das Prinzip der **Schwarmintelligenz** am Beispiel einer **Ameisenkolonie**.  
Mehrere virtuelle Ameisen suchen nach Futter, kommunizieren indirekt über **Pheromonspuren** und bilden dadurch **emergente Pfade** zwischen Nest und Futterquellen – ganz ohne zentrale Steuerung.

---

## 💡 Konzeptüberblick

- **Technologie:** Angular + TypeScript + HTML Canvas
- **Darstellung:** 2D-Simulation auf Canvas
- **Steuerung:** UI mit Eingabefeldern, Buttons und Slidern
- **Interaktion:** Nutzer kann Futterquellen während der Simulation hinzufügen
- **Simulation:** basiert auf lokaler Wahrnehmung, Pheromonintensität und Zufallsentscheidungen

---

## ⚙️ Hauptfunktionen

### 1. Eingabefeld für Ameisenanzahl

- Der Nutzer kann die Anzahl der Ameisen (z. B. 10–500) einstellen.
- Änderungen wirken beim Start der Simulation.

### 2. Start/Stop/Reset-Buttons

- **Start:** initialisiert und startet die Simulation
- **Stop:** pausiert die Simulation
- **Reset:** setzt alle Daten (Ameisen, Pheromone, Futter) zurück

### 3. Futter hinzufügen

- Zwei Varianten:
  - **Drag & Drop:** Futter-Icon aus einer Palette auf das Canvas ziehen
  - **Klick-Platzierung:** Futter-Icon anklicken, dann im Canvas klicken
- Mehrere Futterquellen gleichzeitig möglich
- Quellen sind während der Simulation dynamisch änderbar

### 4. Futterabbau (Depletion)

- Per Toggle-Button aktivierbar
- Futtermenge sinkt passiv mit der Zeit oder schneller, wenn Ameisen es finden
- Bei Erschöpfung verschwindet die Futterquelle automatisch

### 5. Zeitskalierung (Simulation Speed)

- Slider zur Steuerung der Simulationsgeschwindigkeit (z. B. 0.1× – 4×)
- 1 Schritt entspricht standardmäßig **0.1 Sekunden**
- Geschwindigkeit wirkt direkt auf Bewegung, Verdunstung und Entscheidungszyklen

### 6. Koordinatensystem & Skalierung

- Welt in **World Units (WU)** statt Pixel
- Canvas wird automatisch an Bildschirmgröße angepasst
- Funktionen:
  - `worldToScreen()` → Koordinatenumrechnung
  - `screenToWorld()` → Mausposition auf Welt umrechnen
- Optional: Zoom & Pan-Funktion für bessere Übersicht

---

## 🧩 Zentrale Simulationselemente

### 🏠 Nest

- Fester Punkt in der Mitte des Canvas
- Start- und Rückkehrort der Ameisen

### 🍏 Futterquelle

- Position frei platzierbar
- Radius definiert Suchreichweite
- Enthält eine Kapazität (Futtermenge)
- Menge verringert sich durch Ameisenaktivität oder über Zeit

### 🐜 Ameise

- Eigenschaften:
  - Position `(x, y)`
  - Richtung `dir`
  - Zustand: `carryingFood: boolean`
  - Geschwindigkeit in WU/s
- Verhalten:
  1. Läuft zufällig umher, solange kein Futter gefunden
  2. Erkennt Futter → nimmt es auf → kehrt zum Nest zurück
  3. Legt auf Rückweg Pheromone ab
  4. Im Nest angekommen → Futter abgeben → erneut auf Futtersuche gehen

### 💨 Pheromone

- Unsichtbare oder als Heatmap dargestellte Spuren
- Wertebereich **0–1** (Intensität)
- Verdunsten über Zeit (Abnahme pro Sekunde)
- Häufig benutzte Wege werden durch Wiederholung verstärkt

---

## 🧭 Entscheidungslogik der Ameisen

- Jede Ameise orientiert sich an der **lokalen Pheromonkonzentration**.
- Entscheidung erfolgt **probabilistisch** (nicht deterministisch).

**Grundregel (vereinfacht):**

```
if (Pheromonstärke > Schwellenwert)
   -> Richtung leicht anpassen zur stärksten Spur
else
   -> zufällige Bewegung
```

**Parameter:**

- `α` → Stärke des Einflusses von Pheromonen (**Exploitation**)
- `β` → Stärke des Zufallsanteils (**Exploration**)

**Interpretation:**

- Hoher α → folgt stärker bestehenden Spuren → stabil, aber unflexibel
- Niedriger α → mehr Zufall → explorativer, aber langsamer
- Balance zwischen beiden führt zu optimalem Verhalten

---

## 🔁 Simulationsablauf

### 1. Initialisierung

- Nest in der Mitte, definierte Weltgröße (z. B. 100×60 WU)
- Ameisen starten im Nest
- Futterquellen initial vorhanden oder vom Nutzer platziert

### 2. Simulationsschleife (alle 100 ms)

1. Bewegung der Ameisen
2. Entscheidung (Pheromon folgen oder Zufall)
3. Ablage und Verdunstung von Pheromonen
4. Prüfung auf Futter oder Nest
5. Futterabbau (wenn aktiviert)
6. Zeitfaktor aus Slider anwenden

### 3. Rendering

- Canvas wird pro Frame neu gezeichnet
- Elemente: Nest, Futter, Ameisen, ggf. Pheromon-Heatmap
- Anzeige bleibt unabhängig von Bildschirmgröße lesbar

---

## 🖱️ Benutzerinteraktionen

| Aktion                             | Beschreibung                          |
| ---------------------------------- | ------------------------------------- |
| **Eingabe „Ameisenanzahl“**        | Bestimmt Startpopulation              |
| **Start**                          | Simulation initialisieren und starten |
| **Stop**                           | Simulation pausieren                  |
| **Reset**                          | Alles zurücksetzen                    |
| **Futter-Drag&Drop**               | Quelle auf Canvas hinzufügen          |
| **Klick im Canvas (nach Auswahl)** | Futterquelle platzieren               |
| **Futterabbau-Toggle**             | Aktiviert/Deaktiviert Depletion       |
| **Simulationsgeschwindigkeit**     | Steuerung über Slider                 |

---

## 📈 Live-Parameter (änderbar während Laufzeit)

- α (Pheromonabhängigkeit)
- β (Zufallsanteil)
- Verdunstungsrate
- Ameisengeschwindigkeit
- Zeitskalierung (0.1× – 4×)
- Futterabbau an/aus

---

## 🧠 Didaktischer Fokus

Die Demo soll zeigen:

- **Selbstorganisation** ohne zentrale Kontrolle
- **Balance zwischen Zufall und Struktur**
- **Lernen durch Rückkopplung** (Verstärkung erfolgreicher Wege)
- **Vergessen durch Verdunstung** (Anpassung an neue Situationen)
- **Kollektives Verhalten** aus einfachen Regeln

> „Jede Ameise ist dumm – aber der Schwarm ist intelligent.“

---

## 📚 Erweiterbare Ideen

- Hindernisse oder Labyrinthe (z. B. Double-Bridge-Experiment)
- Mehrere Futterquellen mit unterschiedlicher Entfernung
- Heatmap-Overlay zur Visualisierung von Pheromonen
- Statistik-Panel mit:
  - Anzahl transportierter Futtereinheiten
  - Aktive Pfade
  - Durchschnittliche Pfadlänge
- Zoom- und Pan-Funktion
- Presets für verschiedene Verhaltensmodi:
  - _Exploration-heavy_
  - _Exploitation-heavy_
  - _Balanced_

---

## ✅ Zusammenfassung

Diese Simulation zeigt, dass:

- **Einfache lokale Regeln** komplexes Verhalten erzeugen
- **Zufall** kein Fehler, sondern ein Lernmechanismus ist
- **Rückkopplung** (Verstärkung + Verdunstung) zu kollektiver Intelligenz führt
- **Kürzeste Wege** emergent entstehen, ohne dass jemand sie plant

> **„Intelligenz entsteht nicht im Individuum, sondern in der Interaktion.“**
