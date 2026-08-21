<p align="center">
	<img src="./src/img/thumbnail.png">
</p>

# 📒 Sketchbook

Simple web based game engine built on [three.js](https://github.com/mrdoob/three.js) and [cannon.js](https://github.com/schteppe/cannon.js) focused on third-person character controls and related gameplay mechanics.

This is a fork of [swift502/Sketchbook](https://github.com/swift502/Sketchbook), which its author archived in February 2023. The engine underneath is theirs; what this fork adds is sound, multiplayer and a deathmatch layer on top of it.

## What this fork adds

* **Audio** — positional engine sound pitched by revs, and a music track
* **Party mode** — room codes over a small WebSocket relay, up to 8 players
* **Combat** — four weapons, health, kills and a scoreboard
* **A minimap**, a speedometer, and settings folded behind a gear
* **Free roam (everything)** — a scenario with a car, a helicopter and an aeroplane all in reach

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
	* Cars, airplanes and helicopters
	* All three within reach in the Free roam (everything) scenario
* Audio
	* Positional engine sound, pitched by revs
	* Streamed music track, muted with M
* Party mode
	* Room codes, up to 8 players
	* Per player name tags and colours
	* Shared scenarios
* Combat
	* Handgun, automatic, rifle and shotgun, each with its own feel
	* Weapon pickups floating in a halo, GTA style
	* Aim down sights, health, kills and a scoreboard
* HUD
	* Round minimap with party markers
	* Speedometer
	* Settings folded behind a gear

## Controls

| On foot | |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `Shift` | Sprint |
| `Space` | Jump |
| `F` / `G` | Enter vehicle as driver / passenger |
| Left mouse | Fire |
| Right mouse, held | Aim |

| Driving | |
| --- | --- |
| `W` / `S` | Accelerate, brake and reverse |
| `A` / `D` | Steer |
| `Space` | Handbrake |
| `V` | Switch to first person |
| `X` | Switch seats |
| `F` | Leave the vehicle |

| Flying | |
| --- | --- |
| `Shift` / `Space` | Throttle, brake. Ascend, descend in a helicopter |
| `W` / `S` | Pitch |
| `A` / `D` | Roll |
| `Q` / `E` | Yaw |
| `B` | Wheel brake, aeroplane only |

| Anywhere | |
| --- | --- |
| `M` | Mute the music |
| `C` | Centre the camera behind you |
| `Shift` + `R` | Respawn |
| `Shift` + `C` | Free camera |
| Mouse wheel | Slow down or speed up time |
| Gear icon | Settings |

## Running it

```bash
pnpm install
pnpm dev        # game on http://localhost:8080
pnpm server     # party relay on 9000, only needed for multiplayer
pnpm build      # production bundle into build/
```

Or skip all of that and use Docker, below.

## Docker

Both halves come up together, the game on 8080 and the relay on 9000:

```bash
docker compose up -d      # build on first run, then start
docker compose logs -f    # follow
docker compose down       # stop
```

The bundle is rebuilt inside the image rather than copied from the repo, so
what ships is always built from the source beside it. Nothing is mounted, so a
code change needs `docker compose build` again.

Both ports bind every interface, so people on your network can play without any
extra flags: they open `http://<your-address>:8080` and set the party server to
`ws://<your-address>:9000`.

## Railway

The project deploys as two services, both built from the Dockerfiles in
`docker/`, so a service's Dockerfile path has to be set on it:

| Service | Dockerfile | Notes |
| --- | --- | --- |
| `game` | `docker/game.Dockerfile` | nginx, listens on `$PORT` |
| `relay` | `docker/relay.Dockerfile` | node, listens on `$PORT`, healthcheck `/health` |

Give each a domain, then play at the game's URL. The relay is a separate
service on its own domain, so its address goes in the menu's **Party server**
field as a `wss://` URL with no port: Railway terminates TLS and proxies to the
container.

Currently deployed at:

| | |
| --- | --- |
| Game | https://game-production-2fba.up.railway.app |
| Party server | `wss://relay-production-d528.up.railway.app` |

Pushing to master does **not** redeploy. Railway can only watch a repo that has
its [GitHub App](https://github.com/apps/railway) installed, and this one
doesn't, so deploys have to be triggered by hand from the dashboard. Installing
the app on the repo is what makes pushes deploy themselves.

## Party mode

Start the game, pick a name and a colour, then either **Create party** for a four
character code, or type a friend's code and **Join**. Everyone in a party shares
a scenario, so whoever launches one takes the rest along.

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
Linux. Everyone else opens `http://<your-address>:8080` and sets the party server
to `ws://<your-address>:9000`.

To play with people further afield, deploy `server/index.js` anywhere that runs
Node and give them the resulting `wss://` address. `PORT` overrides the port.

**Free roam (everything)** is the scenario to use with friends. It starts
everyone at the airfield with a car, a helicopter and an aeroplane all within
about thirty metres, so nobody has to walk across the map to fly. The race and
stunt scenarios were built for one player and have a single spawn point, so a
party will share a car in them.

Players who go quiet are dropped: anything that stops answering a ping, within a
minute of going silent, and anything whose client has published nothing for five
minutes.
Standing still in game doesn't count, since the client keeps publishing whether
you touch the controls or not.

### What the relay does and doesn't do

It tracks who is in which room and forwards updates untouched. Every client
simulates its own character, the vehicle it drives and its own health; a shooter
reports a hit, and the player who was hit decides what it did to them.

One owner per number beats two clients disagreeing about it, but it does mean a
modified client can claim to be anywhere it likes and can decline to die. That's
fine for playing with friends and not fine for anything competitive.

## Combat

Weapons sit around the map turning inside a glowing column. Walk into one to pick
it up; the column goes dark and comes back twenty seconds later. Guns are stowed
while driving.

| Weapon | Damage | Rate | Mag | Carried | Notes |
| --- | --- | --- | --- | --- | --- |
| Handgun | 25 | semi | 12 | 36 | four shots to a kill |
| Automatic | 13 | 12/s | 30 | 90 | wide spread, short range |
| Rifle | 55 | slow | 8 | 24 | near zero spread, reaches 250m |
| Shotgun | 12 x 8 | slow | 6 | 18 | a kill up close, useless at range |

Ammunition is finite. Reloads draw on what you're carrying, and once that and the
magazine are both empty the gun is dropped and you're looking for another column.

Holding right mouse narrows the view, slides the camera over your shoulder so you
aren't standing where the crosshair is, and cuts spread to a third.

Everyone starts on 100 health and respawns three seconds after dying. A kill
scores a point on the scoreboard at the top right.

## Assets

Everything the game loads at runtime lives in `build/assets` and is swapped by
replacing the file, with no code change:

| File | What it is |
| --- | --- |
| `world.glb`, `car.glb`, `heli.glb`, `airplane.glb`, `boxman.glb` | Scenes and models, exported from `src/blend` |
| `car.wav`, `heli.wav`, `airplane.wav` | Engine loops |
| `music.mp3` | Music, streamed rather than decoded into memory |
| `gun_*.wav` | Weapon reports |

Engine loops want to be **mono** and **wav or ogg**: they're positional, and mp3
encoder padding leaves an audible gap at the loop point. Music can be mp3, since
it streams and the seam is far less noticeable.

The four `gun_*.wav` files are synthesised stand-ins rather than recordings.
Replacing them with real ones is just a file copy.

## Making your own worlds

Scenes are authored in Blender and read from a `.glb`. Sketchbook needs to be
served over http rather than opened from disk, so it can fetch them.

```javascript
const world = new Sketchbook.World('build/assets/world.glb');
```

Objects carry their meaning in custom properties: `data=physics` with
`type=box|trimesh` for collision, `data=spawn` with `type=player|car|heli|airplane`
for spawn points, `data=path` for the nodes car AI follows, and `data=scenario`
for the entries in the scenarios panel. A material named `ocean` becomes water.

One thing to know if you build a new map: `World.worldBounds` holds this world's
playable area. It decides what counts as out of bounds and worth respawning, and
it frames the minimap, so a different map needs different numbers.

## Contributing

1. [Fork this repository](https://help.github.com/en/github/getting-started-with-github/fork-a-repo)
2. `pnpm install`
3. `pnpm dev`, then open http://localhost:8080
4. Make changes and commit

The toolchain is old: webpack 4 and TypeScript 3.9. `@types/lodash` and
`@types/jquery` are pinned exactly, because newer releases use syntax TypeScript
3.9 cannot parse and a fresh install would otherwise break the build.

## Credits

Sketchbook is by [swift502](https://github.com/swift502), with contributions from
[aleqsunder](https://github.com/aleqsunder), [barhatsor](https://github.com/barhatsor)
and [danshuri](https://github.com/danshuri). The [original live demo](https://jblaha.art/sketchbook/latest)
is still up, without any of the additions listed above.
