# car-race-online

online racing game for two players. the screen is split in two roads side by side - each player sees their own car and the opponent's. coins fall on both roads, first one to grab 15 coins wins.

built with node.js + socket.io. the server runs the whole game loop (spawns coins, moves them, decides who caught what) - the browser only sends the car position, so there is nothing to cheat with.

## run it

```
npm install
npm start
```

then open http://localhost:3001 - one player creates a room, the other joins with the 4 letter code.

## how it works

- `server.js` - game loop at 20 ticks/sec on the server: spawns coins with random x, moves them down, and when a coin reaches the catch zone it goes to whoever's car is under it
- `public/index.html` - canvas renderer + controls. the client animates coins locally between server updates so it feels smooth
- rooms are 2 players, identified by a random 4 letter code, cleaned up when empty

## controls

- drag your finger / mouse on your half of the screen
- or arrow keys / A-D

## deployed

hosted on render free tier: sleeps after 15 min idle, first load takes about a minute.
