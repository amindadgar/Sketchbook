<p align="center">
	<a href="https://jblaha.art/sketchbook/latest"><img src="./src/img/thumbnail.png"></a>
	<br>
	<a href="https://jblaha.art/sketchbook/latest">Live demo</a>
	<br>
</p>

# Final update (20. Feb 2023)

As I have no more interest in developing this project, it comes to a conclusion. In order to remain honest about the true state of the project, I am archiving this repository.

- If you wish to modify Sketchbook feel free to fork it.
- To see if someone is currently maintaining a fork, check out the [Network Graph](https://github.com/swift502/Sketchbook/network).

# 📒 Sketchbook

Simple web based game engine built on [three.js](https://github.com/mrdoob/three.js) and [cannon.js](https://github.com/schteppe/cannon.js) focused on third-person character controls and related gameplay mechanics.

Mostly a playground for exploring how conventional third person gameplay mechanics found in modern games work and recreating them in a general way.

## Features

* World
	* Three.js scene
	* Cannon.js physics
	* Variable timescale
	* Frame skipping
	* FXAA anti-aliasing
* Characters
	* Third-person camera, centred behind you with C
	* Raycast character controller with capsule collisions
	* General state system
	* Character AI
* Vehicles
	* Cars
	* Airplanes
	* Helicopters
* Audio
	* Positional engine sound, pitched by revs
	* Streamed music track, muted with M
* Party mode
	* Room codes, up to 8 players
	* Per player name tags and colours
* HUD
	* Speedometer

All planned features can be found in the [GitHub Projects](https://github.com/swift502/Sketchbook/projects).

## Party mode

Sketchbook can be played with friends over a small WebSocket relay.

```bash
pnpm server          # listens on 9000
PORT=8081 pnpm server
```

Start the game, pick a name and a colour, then either **Create party** to get a
four character code, or type a friend's code and **Join**. Everyone in a party
shares a scenario, so whoever launches one takes the rest along.

The **Party server** field in the menu is remembered between sessions and
defaults to `ws://localhost:9000`, which is right when you host and play on the
same machine.

To play with people on your network, bind the dev server to every interface
rather than just localhost:

```bash
pnpm dev --host 0.0.0.0   # game
pnpm server               # relay
```

Find your address with `ipconfig getifaddr en0` on macOS or `hostname -I` on
Linux. Everyone else opens `http://<your-address>:8080` and sets the party
server to `ws://<your-address>:9000`.

To play with people further afield, deploy `server/index.js` anywhere that runs
Node and give them the resulting `wss://` address.

The relay only tracks who is in which room. Every client simulates its own
character and whichever vehicle it drives, and the server forwards those updates
untouched. A modified client can therefore claim to be anywhere it likes, which
is fine for playing with friends and not fine for anything competitive.

Note that the race and stunt scenarios were built for one player, so they have a
single spawn point and a party will share a car. Free roam is the one to use with
friends: there are cars parked all over it and everyone can take their own.

## Usage

You can define your own scenes in Blender, and then read them with Sketchbook. Sketchbook needs to run on a local server such as [http-server](https://www.npmjs.com/package/http-server) or [webpack-dev-server](https://github.com/webpack/webpack-dev-server) to be able to load external assets.

<!-- #### Script tag -->

1. Import:

```html
<script src="sketchbook.min.js"></script>
```

2. Load a glb scene defined in Blender:

```javascript
const world = new Sketchbook.World('scene.glb');
```

<!--

#### NPM

1. Install:

```
npm i sketchbook
```

2. Import:

```javascript
import { World } from 'sketchbook';
```

3. Load a glb scene defined in Blender:

```javascript
const world = new World('scene.glb');
```

-->

## Contributing

1. Get the LTS version of [Node.js](https://nodejs.org/en/) 16
2. [Fork this repository](https://help.github.com/en/github/getting-started-with-github/fork-a-repo)
3. Run `npm install`
4. Run `npm run dev`
5. Make changes and test them out at http://localhost:8080
6. Commit and [make a pull request](https://help.github.com/en/github/collaborating-with-issues-and-pull-requests/creating-a-pull-request-from-a-fork)!

## Credits

Big thank you to each of the following github users for contributing to Sketchbook:

- [aleqsunder](https://github.com/aleqsunder)
- [barhatsor](https://github.com/barhatsor)
- [danshuri](https://github.com/danshuri)
