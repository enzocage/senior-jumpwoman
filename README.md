# SENIOR JUMPWOMAN (C64 Original Edition)

Ein 100 % originalgetreuer Commodore-64-Klon von **Jumpman Junior** (Epyx, 1983, Randy Glover) unter dem neuen Titel **SENIOR JUMPWOMAN** – inklusive authentischer VIC-II-16-Farben-Pixelgrafik (`320×200` im `384×272` Overscan-Rahmen), dreistimmigem MOS-6581-SID-Synthesizer (Web Audio API), originaler Sprung- und Stolperphysik sowie allen **12 originalen C64-Levels** in exakter Reihenfolge.

## Steuerung

| Aktion | Tastatur / Gamepad |
| :--- | :--- |
| **Laufen / Klettern** | `Pfeiltasten` oder `W` `A` `S` `D` / USB-Gamepad |
| **Springen / Feuer** | `SPACE`, `Z`, `X` oder `SHIFT` (+ Richtung für Weitsprung) |
| **Spielerzahl & Speed (1–8)** | Zifferntasten `1`–`8` oder `Links`/`Rechts` + `SPACE` |
| **Pause** | `P` |
| **Ton ein / aus (SID 6581)** | `M` |
| **Titelbildschirm / Setup** | `F1` |
| **Schnellstart (1P, Speed 4)** | `F3` |

## Spielregeln & Punktewertung

- **4 Leben** zu Spielbeginn; **Extra-Leben** alle **7.500 Punkte**.
- **1–4 Spieler** (abwechselnd bei Lebensverlust, jeweils mit eigenem Level-Fortschritt und eigener Geschwindigkeit **Speed 1–8**, wobei `1` am schnellsten und `8` am langsamsten ist).
- **Bombe entschärfen:** `100` Punkte.
- **Level-Abschluss:** Verbleibender `BONUS`-Countdown + **Lebensbonus** (`25 × Level × verbleibende Leben`, bis zu 300 Punkte pro Leben in Level 12).
- **Grünes Seil:** Zieht *Senior Jumpwoman* automatisch nach **oben**.
- **Blaues Seil:** Lässt *Senior Jumpwoman* automatisch nach **unten** gleiten.
- **Vorsicht an Trägerkanten:** Wer ohne Sprung über eine Lücke oder das Ende eines Stahlträgers läuft, stolpert kopfüber in die Tiefe (`KABAM!`).

## Alle 12 originalen C64-Levels

1. **NOTHING TO IT** – Einführung mit Schrägen, Leitern, Auf-/Ab-Seilen und einer *Alienator*-Kugel.
2. **FIRE! FIRE!** *(C64-exklusiv)* – Reaktive Flammenfallen wechseln beim Entschärfen von Bomben ihre Positionen.
3. **sreddaL** *(C64-exklusiv)* – Drei Spalten endlos rollender Aufzug-Leitern, die bei jeder Bombe ihre Laufrichtung umkehren.
4. **HELLSTONES** – Springende Meteoriten prallen die Etagen hinab und steuern aktiv auf *Senior Jumpwoman* zu.
5. **FIGURITS REVENGE** – Reaktives Puzzle-Level: Jede Bombe schaltet Brückenträger und Leitern live um.
6. **WALLS** – Wandernde Ziegelmauern patrouillieren über die Etagen.
7. **ZIG-ZAG** – Drei elektrische *Zig-Zagger* kreuzen das Spielfeld im scharfen Sägezahn-Muster.
8. **SPELLBOUND** – Die 12 Bomben enthüllen `SR.JUMPWOMAN` im Mittelbanner (`+250` Extrapunkte pro Buchstabe in exakter Reihenfolge!).
9. **BLACKOUT** – Nach kurzer Einprägephase erlischt das Licht; Träger blitzen nur beim Entschärfen einer Bombe kurz auf.
10. **HERETHEREEVERYWHERE** – Teleportierende Bomben wechseln periodisch ihre Plattform-Plätze.
11. **HATCHLINGS** – Außerirdische Eier schlüpfen auf den oberen Trägern zu flinken *Hatchlings*.
12. **HURRICANE** – Ein tobender Jupiter-Sturm treibt jeden Sprung mit dem Wind voran, begleitet von Sturmvögeln.
- **Nach Level 12:** Große **`WELL DONE`**-Siegesfeier mit Tanz-Animation, gefolgt von endlosen Zufallslevels ab Stufe 13!

## Lokal starten

Einfach `index.html` im Browser öffnen oder einen kleinen lokalen Webserver starten:

```bash
python3 -m http.server 8080
```
