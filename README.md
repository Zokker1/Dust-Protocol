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

<img width="1915" height="952" alt="image" src="https://github.com/user-attachments/assets/23e8fa98-385a-497a-a6e7-397760a973fc" />
<img width="1915" height="952" alt="image" src="https://github.com/user-attachments/assets/69c64292-7fa7-43da-823c-10919c80d24d" />
<img width="1917" height="956" alt="image" src="https://github.com/user-attachments/assets/7f90290b-d727-4f73-9a1f-de78fd35b420" />

<img width="1919" height="953" alt="image" src="https://github.com/user-attachments/assets/1c0d299f-f2ad-4ab4-aa74-3bfb7b2fb6a8" />
<img width="1918" height="954" alt="image" src="https://github.com/user-attachments/assets/d5978f8f-912a-41a5-9b52-b93343f5c2bb" />

