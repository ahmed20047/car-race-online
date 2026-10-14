// سيرفر لعبة سباق العربيات الأونلاين
// نفس فكرة الإكس أو: غرف بكود، بس هنا اللعبة realtime — السيرفر هو اللي بيلعب

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ============ إعدادات اللعبة ============
const WIN_SCORE = 15;        // عدد الكوينات اللي تكسر بيها
const TICK = 50;             // سرعة حلقة اللعبة (20 مرة في الثانية)
const COIN_SPEED = 0.018;    // قد إيه الكوينة بتنزل في كل تكة (من ارتفاع الطريق)
const CAR_WIDTH = 0.17;      // عرض العربية كنسبة من عرض الطريق
const CATCH_TOP = 0.78;      // منطقة الالتقاط — الكوينة بتتحسب لو دخلت النطاق ده
const CATCH_BOTTOM = 0.92;

const rooms = {};

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += letters[Math.floor(Math.random() * letters.length)];
    }
  } while (rooms[code]);
  return code;
}

function cleanNickname(nickname) {
  return String(nickname || "").trim().slice(0, 15);
}

function createRoom(nickname) {
  const code = makeRoomCode();
  rooms[code] = {
    code,
    players: {},                        // socket.id -> "p1" أو "p2"
    names: { p1: nickname, p2: "" },
    scores: { p1: 0, p2: 0 },
    cars: { p1: 0.5, p2: 0.5 },         // مكان العربية على الطريق (0 لـ 1)
    coins: [],                          // { id, x, y }
    nextCoinId: 1,
    spawnTimer: 800,                    // بعد كام ملي ثانية كوينة جديدة
    phase: "waiting",                   // waiting | racing | finished
    winner: null,                       // "p1" / "p2"
    rematchVotes: new Set(),
    loop: null,
  };
  return rooms[code];
}

function cleanupEmptyRooms() {
  for (const code of Object.keys(rooms)) {
    if (Object.keys(rooms[code].players).length === 0) {
      stopLoop(rooms[code]);
      delete rooms[code];
    }
  }
}

// ============ حلقة اللعبة — بتشتغل على السيرفر بس ============
// العملاء بيبعتوا مكان العربية بس، والسيرفر هو اللي بيحرك الكوينات ويحسب الالتقاط
function startLoop(room) {
  if (room.loop) return;
  room.loop = setInterval(() => tick(room), TICK);
}

function stopLoop(room) {
  if (room.loop) {
    clearInterval(room.loop);
    room.loop = null;
  }
}

function tick(room) {
  if (room.phase !== "racing") return;

  // نطلع كوينة جديدة لو جه وقتها
  room.spawnTimer -= TICK;
  if (room.spawnTimer <= 0) {
    room.coins.push({ id: room.nextCoinId++, x: 0.08 + Math.random() * 0.84, y: -0.05 });
    room.spawnTimer = 400 + Math.random() * 400;
  }

  // نحرك الكوينات ونشوف حد لحق ياخد حاجة
  for (let i = room.coins.length - 1; i >= 0; i--) {
    const coin = room.coins[i];
    coin.y += COIN_SPEED;
    if (coin.y > 1.05) {
      room.coins.splice(i, 1); // عدّت من تحت
      continue;
    }
    if (coin.y >= CATCH_TOP && coin.y <= CATCH_BOTTOM) {
      const d1 = Math.abs(coin.x - room.cars.p1);
      const d2 = Math.abs(coin.x - room.cars.p2);
      // الأقرب هو اللي بياخدها (لو الاتنين تحت
      if (d1 <= CAR_WIDTH && d1 <= d2) {
        collect(room, "p1", i);
      } else if (d2 <= CAR_WIDTH) {
        collect(room, "p2", i);
      }
    }
  }

  if (room.phase === "finished") {
    broadcast(room);
    stopLoop(room); // اللعبة خلصت — نوقف الحلقة
  } else {
    broadcast(room);
  }
}

function collect(room, role, coinIndex) {
  room.coins.splice(coinIndex, 1);
  room.scores[role]++;
  if (room.scores[role] >= WIN_SCORE) {
    room.phase = "finished";
    room.winner = role;
  }
}

// الحالة اللي بنبعتها لكل لاعب (myRole مختلفة لكل واحد)
function roomState(room, myRole) {
  return {
    phase: room.phase,
    coins: room.coins,
    scores: room.scores,
    cars: room.cars,
    names: room.names,
    winner: room.winner,
    myRole,
    playerCount: Object.keys(room.players).length,
    rematchVotes: room.rematchVotes.size,
  };
}

// نرسل الحالة لكل لاعب في الغرفة
function broadcast(room) {
  for (const sid of Object.keys(room.players)) {
    io.to(sid).emit("gameState", roomState(room, room.players[sid]));
  }
}

// ============ الاتصالات ============
io.on("connection", (socket) => {
  console.log("لاعب اتصل:", socket.id);

  socket.on("createRoom", (nickname) => {
    nickname = cleanNickname(nickname);
    if (!nickname) {
      socket.emit("error-msg", "اكتب اسمك الأول");
      return;
    }
    cleanupEmptyRooms();
    const room = createRoom(nickname);
    room.players[socket.id] = "p1";
    socket.join(room.code);
    socket.emit("joined", { code: room.code, myRole: "p1", state: roomState(room, "p1") });
  });

  socket.on("joinRoom", (data) => {
    const code = String(data.code || "").trim().toUpperCase();
    const nickname = cleanNickname(data.nickname);
    if (!nickname) {
      socket.emit("error-msg", "اكتب اسمك الأول");
      return;
    }
    const room = rooms[code];
    if (!room) {
      socket.emit("error-msg", "مفيش غرفة بالكود ده، اتأكد من الكود");
      return;
    }
    if (Object.keys(room.players).length >= 2) {
      socket.emit("error-msg", "الغرفة كاملة، جرّب غرفة تانية");
      return;
    }
    room.players[socket.id] = "p2";
    room.names.p2 = nickname;

    // الاتنين بقوا موجودين — يلا نبدأ السباق
    resetRace(room);
    room.phase = "racing";
    startLoop(room);

    socket.join(code);
    socket.emit("joined", { code, myRole: "p2", state: roomState(room, "p2") });
    broadcast(room);
  });

  // العميل بيبعت مكان عربيته، واحنا بنحطه في مكانه
  socket.on("move", (x) => {
    const room = findRoom(socket.id);
    if (!room || room.phase !== "racing") return;
    const role = room.players[socket.id];
    if (!role) return;
    x = Number(x);
    if (Number.isNaN(x)) return;
    room.cars[role] = Math.min(1, Math.max(0, x));
  });

  socket.on("rematch", () => {
    const room = findRoom(socket.id);
    if (!room) return;
    room.rematchVotes.add(socket.id);
    if (room.rematchVotes.size === 2) {
      room.rematchVotes.clear();
      resetRace(room);
      room.phase = "racing";
      room.winner = null;
      startLoop(room);
    }
    broadcast(room);
  });

  socket.on("disconnect", () => {
    const room = findRoom(socket.id);
    if (room) {
      delete room.players[socket.id];
      // لاعب خرج والسباق شغال — نوقفه ونرجع للانتظار
      stopLoop(room);
      room.phase = "waiting";
      room.winner = null;
      room.coins = [];
      room.scores = { p1: 0, p2: 0 };
      room.rematchVotes.clear();
      broadcast(room);
    }
    console.log("لاعب خرج:", socket.id);
  });

  // ---- دوال مساعدة ----
  function findRoom(sid) {
    for (const room of Object.values(rooms)) {
      if (room.players[sid]) return room;
    }
    return null;
  }

  function resetRace(room) {
    room.coins = [];
    room.scores = { p1: 0, p2: 0 };
    room.cars = { p1: 0.5, p2: 0.5 };
    room.spawnTimer = 800;
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`اللعبة شغالة على http://localhost:${PORT}`);
});
