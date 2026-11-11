# FlexbarSublime-Flexbar

FlexDesigner-Plugin, das konfigurierbare Sublime-Text-Befehle und adaptive Menüs auf einer Flexbar
bereitstellt.

![Beispiel der Flexbar-Integration](Flexbar-Sublime-Text.webp)

Dieses Repository enthält den Flexbar-/FlexDesigner-Teil des Projekts. Die zugehörige Sublime-Text-
Bridge befindet sich in [FlexbarSublime-Sublime](https://github.com/Teddielike/FlexbarSublime-Sublime).

## Voraussetzungen

- FlexDesigner 2.2.5 oder neuer
- Node.js 20 oder neuer
- npm
- FlexCLI (`npm install -g @eniac/flexcli`)
- installierte Sublime-Text-Bridge

## Build und Validierung

```bash
./build.sh
```

Das Skript installiert die Abhängigkeiten, erstellt das Backend, führt die Tests und die FlexCLI-
Validierung aus und erzeugt ein `.flexplugin`-Paket.

Die Plugin-Metadaten liegen in:

```text
de.teddielike.flexbar-sublime-text.plugin/manifest.json
```

Manuelle Befehle:

```bash
npm ci --include=dev
npm run build
npm test
npm run plugin:validate
npm run plugin:pack
```

## Funktionen

- adaptives Menü mit sechs Inhaltsplätzen sowie Navigation;
- Sublime-Text-Befehle und Plugin-Untermenüs;
- stabile Aktions-IDs und kontextabhängig deaktivierte Tasten;
- automatische und manuelle Material-Design-Symbole;
- deutsche und englische Beschriftungen und Tooltips;
- Verwendung der festen Tasten ohne Dynamic-Keys-API.

## Lizenz

Copyright © 2026 Christian Sperber. Lizenziert unter der [MIT-Lizenz](LICENSE).
