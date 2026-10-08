# DUST PROTOCOL

A browser FPS built with Three.js and Node.js. Includes offline bot matches,
online deathmatch, and Zombie Co-op with waves, weapons, loot, and reviving.

## Run locally

Install Node.js, then double-click `start.bat` on Windows. On the first run,
it installs the locked dependencies. Open the localhost URL printed in the terminal.

Alternatively:

```sh
npm ci --omit=dev
npm start
```

The default URL is `http://localhost:8137`. If that port is in use, the server
tries the next available port and prints its URL. Set `PORT` to choose a port.
Players connecting to the same server can join online matches together.

## Controls

See How to Play in the main menu for movement, combat, buying, and co-op controls.

## Project layout

- `src/`: game logic, rendering, audio, and network client
- `server.mjs`: multiplayer simulation and public game asset server
- `lib/`: bundled Three.js library
- `assets/audio/`: menu music

## Publishing

Local settings, dependencies, notes, and secret files are excluded by `.gitignore`.
The HTTP server serves only the game page and public game assets.
Review files before committing. Git commit author details and your GitHub account
can identify you; choose your commit name and email accordingly.

Audio assets retain their embedded origin information. Confirm that you have the
necessary rights to distribute the assets before publishing.
