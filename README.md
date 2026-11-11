# FlexbarSublime-Flexbar

FlexDesigner plugin that puts configurable Sublime Text commands and submenus on a Flexbar.

The plugin uses nine fixed keys and an adaptive menu. It communicates with the companion
[Sublime Text bridge](https://github.com/Teddielike/FlexbarSublime-Sublime) over a local,
authenticated HTTP connection.

![Project example](Flexbar-Sublime-Text.webp)

## Requirements

- FlexDesigner 2.2.5 or newer
- Node.js 20 or newer
- npm
- FlexCLI (`npm install -g @eniac/flexcli`)
- Sublime Text with the companion bridge installed

## Build and validate

```bash
./build.sh
```

This installs dependencies, bundles the backend, runs the tests, validates the plugin and creates a
`.flexplugin` package. The plugin metadata is in `de.teddielike.flexbar-sublime-text.plugin/manifest.json`, the standard
FlexDesigner plugin layout used by FlexGate.

Manual commands:

```bash
npm ci --include=dev
npm run build
npm test
npm run plugin:validate
npm run plugin:pack
```

## Features

- adaptive six-slot command menu with previous/back and next navigation;
- Sublime Text commands and package submenus;
- stable action IDs and context-sensitive disabled keys;
- automatic and manual Material Design icons;
- German and English labels and tooltips;
- fixed-key API only; no Dynamic Keys API required.

## Configuration

The default configuration is stored in `config.json`:

```json
{
  "mode": "adaptive",
  "pollMs": 2500,
  "drawIntervalMs": 140,
  "readyDelayMs": 700
}
```

## License

Copyright © 2026 Christian Sperber. Licensed under the [MIT License](LICENSE).
