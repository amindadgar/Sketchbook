<p align="center">
	<a href="https://game-amin.up.railway.app/"><img src="./src/img/thumbnail.png"></a>
	<br>
	<br>
	<a href="https://game-amin.up.railway.app/"><b>▶ Play it now at game-amin.up.railway.app</b></a>
	<br>
	<sub>Drive, fly and shoot with friends. No install, no sign-up needed.</sub>
</p>

# 📒 Sketchbook

Simple web based game engine built on [three.js](https://github.com/mrdoob/three.js) and [cannon.js](https://github.com/schteppe/cannon.js) focused on third-person character controls and related gameplay mechanics.

**[Play it here.](https://game-amin.up.railway.app/)** Create a party, share the four
character code, and whoever has it can join you. It works on a phone too, and can
be added to a home screen.

This is a fork of [swift502/Sketchbook](https://github.com/swift502/Sketchbook), which its author archived in February 2023. The engine underneath is theirs; what this fork adds is sound, multiplayer and a deathmatch layer on top of it.

## What this fork adds

* **Audio** — positional engine sound pitched by revs, and a music track
* **Party mode** — room codes over a small WebSocket relay, up to 8 players, in five minute rounds
* **Combat** — four weapons, health, kills, recoil, hit markers and a scoreboard
* **Races** — the three circuits the world always had, now with laps, times and a running order
* **Driving with consequences** — a handbrake that steps the back out, downforce, crash damage and smoke
* **Chat, leaderboards and unlockable colours and hats**
* **A minimap**, a speedometer, and settings folded behind a gear
* **Free roam (everything)** — a scenario with a car, a helicopter and an aeroplane all in reach
* **A world that downloads in 6MB** rather than 26, at the same picture

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
	* Handbrake drift, speed sensitive downforce, crash damage and smoke
* Racing
	* Laps, lap times, best laps and a live running order against the AI drivers
	* Three circuits, timed from the same path the drivers follow
	* Best laps kept per browser, and per account when signed in
* Audio
	* Positional engine sound, pitched by revs
	* Streamed music track, muted with M
* Party mode
	* Room codes, up to 8 players
	* Five minute rounds with a clock, standings and a reset
	* Text chat
	* Per player name tags, colours and hats
	* Shared scenarios
* Combat
	* Handgun, automatic, rifle and shotgun, each with its own feel
	* Weapon pickups floating in a halo, GTA style
	* Aim down sights, recoil, hit markers, health, kills and a scoreboard
	* Server side checks on claimed hits, and line of sight checked by the target
* Progress
	* Kills counted against an account
	* Four colours and three hats unlocked by them
	* Leaderboards for kills and for lap times
* HUD
	* Round minimap with party markers
	* Speedometer, lap board, round clock
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
| `L` | Leaderboard: lap times on a circuit, kills anywhere else |
| `Enter` | Party chat |
| `Shift` + `R` | Respawn |
| `Shift` + `C` | Free camera |
| Mouse wheel | Slow down or speed up time |
| Gear icon | Settings |

## On a phone

Devices whose primary pointer is a finger get an on-screen stick on the left,
buttons on the right, and a drag-anywhere camera. The HUD rearranges itself
around the thumbs and the keyboard hints go away.

Nothing about it reaches into the game's logic. The stick dispatches the same
key events a keyboard would, so every input receiver the engine already has, on
foot, in a car, in an aeroplane, keeps its own mapping and none of them need to
know touch exists. Desktop doesn't construct any of it.

The buttons say what they do wherever you are, because ENTER reading as ENTER
while sitting in the car it just opened is no use to anybody:

| Where | Buttons |
| --- | --- |
| On foot | JUMP, ENTER, and FIRE and AIM once armed |
| Car | BRAKE, EXIT |
| Helicopter | YAW L, YAW R, UP, DOWN, EXIT |
| Aeroplane | YAW L, YAW R, THRTL, BRAKE, EXIT |
| Passenger | EXIT |

| Control | Does |
| --- | --- |
| Stick | Move, and steer. Push it all the way to sprint, on foot |
| Drag anywhere | Look. The camera goes back to following a moment later |
| MAP | Shows the map in the middle of the screen, and puts it away again |
| Speech bubble | Party chat, in a party |

The camera follows by itself on a phone, because one thumb is on the stick and
the other is on the buttons and there is nobody left to drag the view. Dragging
still works and holds the camera where you put it for a moment. On foot that
turns the stick into steering: push it left and you curve left, at a capped
hundred and ten degrees a second, because the character faces wherever the
camera does and the two would otherwise chase each other into a spin.

Landscape only. Held upright the game isn't cramped so much as unplayable, the
stick and the buttons would be on top of each other, so it says so and waits.
The manifest asks for a landscape lock too, which browsers honour once the game
has been added to a home screen.

Health is a number rather than a bar on a phone, speed is a figure under the
stick rather than a bar across the middle, and the map folds away behind a
button: a glance is worth a corner, a permanent map isn't.

**Add to Home Screen** works, and the welcome screen says so on a phone that
hasn't done it yet. There's a web manifest, icons and a service worker that
deliberately caches nothing: a stale copy of the world would cause far more
trouble than an offline mode is worth for a game you need a server to play with
anyone.

The detection is `(pointer: coarse)` rather than "does a touch screen exist", so
a laptop with a touch screen keeps its mouse and keyboard.

A phone also asks for less: the pixel ratio is capped at 1.5 rather than the
three a modern handset reports, which is nine times the fragments of a plain
buffer, the shadow cascades halve to 1024 and the soft shadow filter drops to
the cheap one. Desktop is left alone.

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
| `game` | `docker/game.Dockerfile` | nginx, listens on `$PORT`, reads `PARTY_SERVER_URL` |
| `relay` | `docker/relay.Dockerfile` | node, listens on `$PORT`, healthcheck `/health`, reads `DATABASE_URL` and `AUTH_SECRET` |

Set **`PARTY_SERVER_URL`** on the game service to the relay's address, as a
`wss://` URL with no port. The game is a static bundle, so the value can't be
compiled in; the container writes it into `config.js` at startup and the page
reads that before the bundle loads. Changing the variable and restarting is
enough, with no rebuild.

Give each a domain, then play at the game's URL. The relay is a separate
service on its own domain, so its address goes in the menu's **Party server**
field as a `wss://` URL with no port: Railway terminates TLS and proxies to the
container.

Currently deployed at:

| | |
| --- | --- |
| Game | https://game-amin.up.railway.app |
| Party server | `wss://game-amin-party.up.railway.app` |

Pushing to master does **not** redeploy. Railway can only watch a repo that has
its [GitHub App](https://github.com/apps/railway) installed, and this one
doesn't, so deploys have to be triggered by hand from the dashboard. Installing
the app on the repo is what makes pushes deploy themselves.

## Party mode

Start the game, pick a name and a colour, then either **Create party** for a four
character code, or type a friend's code and **Join**. Everyone in a party shares
a scenario, so whoever launches one takes the rest along.

The party server is chosen for you and folded away under the buttons, with a
**Change** link if you need it. In order:

1. Whatever you picked last, remembered per site
2. `PARTY_SERVER_URL`, if the deployment set one
3. Otherwise worked out from the page's own address: `ws://localhost:9000` when
   served from localhost, `ws://<that address>:9000` from a LAN address

**Change** offers those as named choices rather than an address to type, plus
**Other** for anything else.

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

A party runs in **five minute rounds**. The clock sits above the scoreboard, and
when it runs out the room sees where everyone finished for twelve seconds before
the scores go back to zero and the next round starts. `MATCH_MS` and
`INTERMISSION_MS` on the relay change the lengths.

Press `Enter` to say something. Messages are one line, one every second and a
bit, and the log fades out on its own.

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

Every client simulates its own character, the vehicle it drives and its own
health. A shooter reports a hit, and the player who was hit decides what it did
to them. One owner per number beats two clients disagreeing about it.

Claimed hits are no longer taken on trust. The relay checks that the weapon
exists, that the damage is no more than that weapon does, that the target was
within its range using the positions both clients are already sending for
movement, and that nobody is doing more damage a second than the fastest honest
weapon in the game. That last one is a sliding window rather than a shot
counter, so relabelling the weapon on every message buys nothing. Against two
hundred fabricated hits in one burst it lets through sixteen. Deaths are limited
to one per respawn, so nobody can hand out points in bulk.

What the relay can't check is line of sight, because it has never seen the map.
The client being shot at can, so it does: it raycasts from the reported muzzle
to itself and drops anything that came through a wall. Both ends of a shot are a
moment stale by the time it lands, so only cover well short of the player counts.

The weapon numbers both sides check against live in `shared/weapons.json`. Two
copies would drift and the relay would start refusing honest shots.

None of this makes a modified client honest. It can still claim to be somewhere
it isn't, and it can still decline to die. It can no longer clear a room from
across the map with one message.

## Accounts

Optional, and the party works without them. Signing in gets your kills and best
laps counted against a name that persists, which is what the leaderboards and
the unlocks are built on.

The party server grows a few endpoints and a Postgres database:

| | |
| --- | --- |
| `POST /auth/register` | `{username, password}` returns a token |
| `POST /auth/login` | same, for an existing account |
| `GET /auth/me` | the signed-in profile and its tallies |
| `GET /leaderboard` | top players by kills |
| `GET /leaderboard?track=` | best laps on one circuit |
| `POST /race/lap` | `{track, ms}`, a new personal best. Only ever moves down |

Set `DATABASE_URL` on the relay to switch accounts on; without it the relay
still runs parties and simply reports that accounts are unavailable. Set
`AUTH_SECRET` too, or every restart signs everyone out.

Passwords are hashed with scrypt and tokens signed with an HMAC, both from
Node's own crypto. Neither needs a dependency in a service whose job is
forwarding small JSON messages.

Kills are recorded server side, from the same death message that awards a point
in game, so they inherit its trust model: a client that lies about dying will
lie to the database too. Lap times are worse, since the client times its own
laps and the server only rejects the physically absurd. Good enough for friends,
not for a public ranking.

### What kills buy

| | Costs |
| --- | --- |
| Cap | 5 kills |
| Mint, a fifth colour | 10 |
| Party hat | 20 |
| Ember | 25 |
| Steel | 50 |
| Crown | 60 |
| Gold | 100 |

Locked ones are shown in the menu with what they cost. The hats are built from
primitives rather than downloaded, and hang off the head bone so they lean when
the head does.

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

Every shot kicks the view up, from two thirds of a degree for the automatic to
three and a half for the shotgun, and gives all of it back over the next
fraction of a second, so a burst walks up the target and settles where it
started. A shot that lands flashes four ticks around the crosshair and clicks.

Everyone starts on 100 health and respawns three seconds after dying. Dying lays
you out and hands the camera to whoever shot you, or to the nearest player. A
kill scores a point on the scoreboard at the top right.

Cars hurt too. An impact above six metres a second along the contact normal
takes health off whoever is driving and wears the vehicle down, and a wreck
below half condition smokes, harder the worse it is.

## Racing

The world file has shipped three circuits all along, each with a grid of cars
and a set of computer drivers following a ring of path nodes. Their own briefings
used to say "There's no lap or position tracking yet, so just enjoy the ride for
now." Now there is.

That ring is the track, so the gates are made of it rather than a second set of
coordinates that could drift from the one the drivers use. A scenario counts as a
race when it hands a driver a path to follow, so a new circuit added to the world
file is timed without anything in the code being told about it.

| | |
| --- | --- |
| Lights | Three seconds, holding the grid on the brakes |
| Distance | Three laps |
| Board | Lap, position, running clock, best lap |
| Marker | A ring on the next gate, not a fence of thirty |
| Finish | Where you came, the total, and the best lap |

Best laps are kept in the browser whether you are signed in or not, and sent up
to the account as well when you are. `L` shows the board for the circuit you're
on.

## Assets

Everything the game loads at runtime lives in `build/assets` and is swapped by
replacing the file, with no code change:

| File | What it is |
| --- | --- |
| `world.glb`, `car.glb`, `heli.glb`, `airplane.glb`, `boxman.glb` | Scenes and models, exported from `src/blend` |
| `car.wav`, `heli.wav`, `airplane.wav` | Engine loops |
| `music.mp3` | Music, streamed rather than decoded into memory |
| `gun_*.wav` | Weapon reports |

`world.glb` is 6MB, down from the 26MB the fork inherited. Almost all of that
was textures: 24.5MB of them against about 1.5MB of geometry, most of them PNGs
of photographic material that PNG has no way to compress. `tools/shrink_textures.py`
converts everything opaque to JPEG at its original resolution and the ambient
occlusion maps to grayscale JPEG, then rebuilds the binary chunk. Nothing is
resized, and the same frame before and after differs by 0.001 of one level out
of 255. Run it on any new asset that arrives:

```bash
python3 tools/shrink_textures.py build/assets/world.glb
```

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
