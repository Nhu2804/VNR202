import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const app = express();
const server = createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ✅ 1️⃣ Đọc file map theo đường dẫn tuyệt đối để tránh lỗi khi chạy từ thư mục khác
const mapPath = path.join(process.cwd(), "public", "maps", "map1.json");

// ✅ 2️⃣ Đọc và parse JSON map Tiled
let mapData;
try {
  const fileContent = fs.readFileSync(mapPath, "utf8");
  mapData = JSON.parse(fileContent);
} catch (err) {
  console.error("❌ Lỗi đọc map1.json:", err);
  process.exit(1);
}

// ✅ 3️⃣ Lấy kích thước thực của map (theo số ô và kích thước mỗi tile)
const TILE_W = mapData.tilewidth || 32;
const TILE_H = mapData.tileheight || 32;
const WORLD_WIDTH = mapData.width * TILE_W;
const WORLD_HEIGHT = mapData.height * TILE_H;
const MIN_DISTANCE_FOR_RESPAWN = 150;

console.log(`✅ WORLD SIZE: ${WORLD_WIDTH}x${WORLD_HEIGHT} (${mapData.width}x${mapData.height} tiles)`);

let rooms = {};

// ✅ Đọc dữ liệu trắc nghiệm của 2 map
const dataDir = path.join(process.cwd(), "public", "data");

function loadMapData(mapName) {
  const filePath = path.join(dataDir, `${mapName}.json`);
  try {
    const content = fs.readFileSync(filePath, "utf8");
    console.log(`✅ Loaded ${mapName}.json`);
    return JSON.parse(content);
  } catch (err) {
    console.error(`❌ Lỗi đọc ${mapName}.json:`, err);
    return { silver: [], gold: [] };
  }
}

// 🪄 Chuyển Markdown (**) thành HTML <b>...</b>
function convertMarkdownBold(obj) {
  if (Array.isArray(obj)) {
    return obj.map(o => convertMarkdownBold(o));
  } else if (typeof obj === "object" && obj !== null) {
    const newObj = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        // thay **bold** thành <b>bold</b>
        newObj[k] = v.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
      } else {
        newObj[k] = convertMarkdownBold(v);
      }
    }
    return newObj;
  }
  return obj;
}


const treasureData = {
  map1: convertMarkdownBold(loadMapData("map1")),
  map2: convertMarkdownBold(loadMapData("map2")),
};


// ============================================================
// 📏 Đọc kích thước riêng của map1 và map2  👇  THÊM Ở ĐÂY
// ============================================================
function loadMapDimensions(mapFile) {
  try {
    const json = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    return {
      width: json.width * (json.tilewidth || 32),
      height: json.height * (json.tileheight || 32),
    };
  } catch (err) {
    console.error("❌ Lỗi đọc map:", mapFile, err);
    return { width: 1280, height: 960 };
  }
}

const MAP_SIZES = {
  map1: loadMapDimensions(path.join(process.cwd(), "public/maps/map1.json")),
  map2: loadMapDimensions(path.join(process.cwd(), "public/maps/map2.json")),
};

console.log("✅ MAP SIZES:", MAP_SIZES);

// ===========================================================
// 🪙 TẠO VÀ HỒI SINH RƯƠNG — RANDOM KHÔNG DÍNH NHAU
// ===========================================================

function generateGridTreasures(mapName = "map1") {
  const { width: WORLD_WIDTH, height: WORLD_HEIGHT } = MAP_SIZES[mapName];
  console.log(`🎁 Generating treasures for ${mapName} (${WORLD_WIDTH}x${WORLD_HEIGHT})`);

  const treasures = [];
  const { silver = [], gold = [] } = treasureData[mapName];
  const SILVER_COUNT = 15;
  const GOLD_COUNT = 5;
  const baseDistance = 150;
  const scaleFactor = Math.sqrt((WORLD_WIDTH * WORLD_HEIGHT) / (1280 * 1184)); // tỉ lệ so với map1
  const MIN_DISTANCE = baseDistance * scaleFactor; // tự giãn theo diện tích map

  const PADDING = 80;

  // 🩶 Sinh 15 rương bạc
  let attempts = 0;
  while (treasures.length < SILVER_COUNT && attempts < 2000) {
    const { width: WORLD_WIDTH, height: WORLD_HEIGHT } = MAP_SIZES[mapName];
    const x = PADDING + Math.random() * (WORLD_WIDTH - 2 * PADDING);
    const y = PADDING + Math.random() * (WORLD_HEIGHT - 2 * PADDING);
    const tooClose = treasures.some(t => Math.hypot(t.x - x, t.y - y) < MIN_DISTANCE);
    if (!tooClose) {
      const q = silver[treasures.length % silver.length] || { info: "Rương bạc", question: "", options: [], correct: 0, points: 10 };
      treasures.push({ id: crypto.randomUUID(), type: "silver", x, y, opened: false, ...q, points: 10 });
    }
    attempts++;
  }

  // 💛 Sinh 5 rương vàng
  attempts = 0;
  while (treasures.length < SILVER_COUNT + GOLD_COUNT && attempts < 2000) {
    const { width: WORLD_WIDTH, height: WORLD_HEIGHT } = MAP_SIZES[mapName];
    const x = PADDING + Math.random() * (WORLD_WIDTH - 2 * PADDING);
    const y = PADDING + Math.random() * (WORLD_HEIGHT - 2 * PADDING);
    const tooClose = treasures.some(t => Math.hypot(t.x - x, t.y - y) < MIN_DISTANCE);
    if (!tooClose) {
      const q = gold[(treasures.length - SILVER_COUNT) % gold.length] || { info: "Rương vàng", question: "", options: [], correct: 0, points: 20 };
      treasures.push({ id: crypto.randomUUID(), type: "gold", x, y, opened: false, ...q, points: 20 });
    }
    attempts++;
  }

  console.log(`✅ Generated ${treasures.length} treasures for ${mapName}`);
  return treasures;
}



function respawnSingleTreasure(existingTreasures = [], mapName = "map1") {
  const { width: WORLD_WIDTH, height: WORLD_HEIGHT } = MAP_SIZES[mapName];
  const { silver = [], gold = [] } = treasureData[mapName];
  const PADDING = 80;
  const baseDistance = 150;

  const scaleFactor = Math.sqrt((WORLD_WIDTH * WORLD_HEIGHT) / (1280 * 1184)); // tỉ lệ so với map1
  const MIN_DISTANCE = baseDistance * scaleFactor; // tự giãn theo diện tích map

  let attempts = 0;

  while (attempts < 200) {
    const x = PADDING + Math.random() * (WORLD_WIDTH - 2 * PADDING);
    const y = PADDING + Math.random() * (WORLD_HEIGHT - 2 * PADDING);
    const tooClose = existingTreasures.some(t => Math.hypot(t.x - x, t.y - y) < MIN_DISTANCE);
    if (!tooClose) {
      const isGold = Math.random() < 0.35;
      const q = (isGold ? gold : silver)[Math.floor(Math.random() * (isGold ? gold.length : silver.length))];
      return { id: crypto.randomUUID(), type: isGold ? "gold" : "silver", x, y, opened: false, ...q };
    }
    attempts++;
  }
  console.warn("⚠️ Respawn failed (too crowded)");
  return null;
}


// ===================================================
// 🎯 Lưu tiến độ từng phòng (progress bar %)
// ===================================================
let progressByRoom = {};
// Theo dõi các câu hỏi đã dùng riêng từng người chơi
let usedQuestionsByPlayer = {};


io.on("connection", (socket) => {
  console.log("🧩 Connected:", socket.id);

  socket.on("createRoom", (callback) => {
    const pin = Math.floor(10000 + Math.random() * 90000).toString();
    rooms[pin] = { hostId: socket.id, players: [], started: false, treasures: [], currentMap: "map1" };
    socket.join(pin);
    callback(pin);
  });

  // ===== BẮT ĐẦU VÙNG CODE MỚI THÊM VÀO =====
  socket.on("checkRoomPin", (pin, callback) => {
    const room = rooms[pin];
    if (!room) {
      return callback({ exists: false, error: "❌ Phòng không tồn tại!" });
    }
    if (room.started) {
      return callback({ exists: false, error: "⏳ Phòng đã bắt đầu, không thể vào!" });
    }
    callback({ exists: true });
  });

  // 🆕 Khi host chọn người chơi để theo dõi
  socket.on("setFollowTarget", ({ pin, targetId }) => {
    const room = rooms[pin];
    if (!room || socket.id !== room.hostId) return;
    room.followTarget = targetId || null;
    io.to(room.hostId).emit("followTargetUpdate", targetId || null);
  });

  // ===== KẾT THÚC VÙNG CODE MỚI THÊM VÀO =====

  socket.on("joinRoom", ({ pin, name }, callback) => {
    const room = rooms[pin];
    if (!room) return callback({ error: "❌ Phòng không tồn tại!" });
    if (room.started) return callback({ error: "⏳ Phòng đã bắt đầu!" });
    if (room.players.some(p => p.name === name)) {
      return callback({ error: "Tên này đã được dùng trong phòng!" });
    }

    // 🧩 Danh sách sprite nhân vật (đã có trong /public/characters)
    const characterSprites = [
      "characters/character_1.png",
      "characters/character_2.png",
      "characters/character_3.png",
      "characters/character_4.png",
      "characters/character_5.png",
      "characters/character_6.png",
      "characters/character_7.png",
      "characters/character_8.png",
      "characters/character_9.png",
      "characters/character_10.png",
    ];

    // Random nhân vật
    const randomSprite = characterSprites[Math.floor(Math.random() * characterSprites.length)];

    const player = {
      id: socket.id,
      name,
      score: 0,
      x: Math.random() * (WORLD_WIDTH - 100) + 50,
      y: Math.random() * (WORLD_HEIGHT - 100) + 50,
      sprite: randomSprite // 🧠 Gán đường dẫn sprite
    };

    room.players.push(player);
    socket.join(pin);
    io.to(pin).emit("updatePlayers", room.players);
    callback({ success: true, sprite: randomSprite });
  });

  socket.on("startGame", (pin) => {
    const room = rooms[pin];
    if (!room || socket.id !== room.hostId) return;
    room.started = true;
    room.currentMap = "map1"; // ✅ thêm dòng này
    // <--- SỬ DỤNG HÀM RẢI RƯƠNG ĐỀU --->
    room.treasures = generateGridTreasures("map1");
    io.to(pin).emit("updateTreasures", room.treasures);
    io.to(pin).emit("startGame");
    io.to(pin).emit("updatePlayers", room.players);

    // const timer = setInterval(() => {
    //   if (!room || !room.started) return clearInterval(timer);
    //   room.timeLeft--;
    //   io.to(pin).emit("timerUpdate", room.timeLeft);
    //   if (room.timeLeft <= 0) {
    //     room.started = false;
    //     clearInterval(timer);
    //     const ranking = [...room.players].sort((a, b) => b.score - a.score);
    //     io.to(pin).emit("endGame", ranking);
    //     delete rooms[pin];
    //   }
    // }, 1000);
  });

  socket.on("movePlayer", ({ pin, x, y }) => {
    const room = rooms[pin];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.x = x;
    player.y = y;

    // 🆕 Nếu người này đang bị host theo dõi → không gửi lại cho host
    if (room.followTarget === socket.id) {
      socket.to(pin).emit("playerMoved", { id: player.id, x, y });
    } else {
      // Bình thường: gửi cho tất cả (bao gồm host)
      socket.to(pin).emit("playerMoved", { id: player.id, x, y });
    }
  });


  socket.on("openTreasure", ({ pin, treasureId }) => {
    const room = rooms[pin];
    if (!room) return;

    const t = room.treasures.find(tr => tr.id === treasureId);
    if (!t || t.opened) return;

    // ✅ Đánh dấu đã mở
    t.opened = true;
    io.to(pin).emit("treasureOpened", treasureId);

    // ✅ Mỗi người chơi có danh sách câu hỏi riêng
    const playerId = socket.id;
    const mapName = room.currentMap;
    const isGold = t.type === "gold";

    // Lấy danh sách câu hỏi phù hợp map và loại rương
    const pool = isGold ? treasureData[mapName].gold : treasureData[mapName].silver;

    // Nếu người chơi chưa có bộ câu hỏi riêng thì tạo mới
    if (!usedQuestionsByPlayer[playerId]) {
      usedQuestionsByPlayer[playerId] = { silver: new Set(), gold: new Set() };
    }

    const usedSet = isGold ? usedQuestionsByPlayer[playerId].gold : usedQuestionsByPlayer[playerId].silver;

    // ✅ Lấy chỉ số câu hỏi chưa dùng
    const allIndices = pool.map((_, i) => i);
    const available = allIndices.filter(i => !usedSet.has(i));
    if (available.length === 0) usedSet.clear(); // nếu hết câu thì reset
    const pick =
      available.length > 0
        ? available[Math.floor(Math.random() * available.length)]
        : Math.floor(Math.random() * pool.length);
    usedSet.add(pick);

    const q = pool[pick];

    // ✅ Gửi riêng câu hỏi cho người chơi mở rương
    socket.emit("showQuestion", {
      treasureId,
      type: t.type,
      info: q.info,
      question: q.question,
      options: q.options,
      correct: q.correct,
      points: isGold ? 20 : 10,
    });

    // 🔁 Sau 3s hồi sinh rương (nhưng câu hỏi không reset)
    setTimeout(() => {
      if (!room) return;
      room.treasures = room.treasures.filter(tr => tr.id !== treasureId);
      const newTreasure = respawnSingleTreasure(room.treasures, room.currentMap);
      if (newTreasure) {
        room.treasures.push(newTreasure);
        io.to(pin).emit("updateTreasures", room.treasures);
      }
    }, 3000);
  });


  socket.on("updateScore", ({ pin, delta }) => {
    const room = rooms[pin];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.score += delta;
    io.to(pin).emit("updatePlayers", room.players);
  });

  // ===================================================
  // 🎯 TĂNG TIẾN ĐỘ PHÒNG (progress bar)
  // ===================================================


  socket.on("increaseProgress", ({ pin, amount }) => {
    if (!progressByRoom[pin]) progressByRoom[pin] = 0;
    progressByRoom[pin] += amount;
    if (progressByRoom[pin] > 100) progressByRoom[pin] = 100;

    // Gửi tiến độ % cho tất cả người trong phòng
    io.to(pin).emit("progressUpdate", progressByRoom[pin]);
  });


  socket.on("disconnect", () => {
    for (const pin in rooms) {
      const room = rooms[pin];
      if (socket.id === room.hostId) {
        io.to(pin).emit("endGame", [...room.players].sort((a, b) => b.score - a.score));
        delete rooms[pin];
        delete progressByRoom[pin];
        console.log(`❌ Host rời phòng ${pin} — đóng phòng`);
        return;
      }

      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx !== -1) {
        room.players.splice(idx, 1);
        io.to(pin).emit("updatePlayers", room.players);
        return;
      }
    }  
  });


  // ===================================================
  // 🧭 Khi host bấm “Tiếp tục” sau khi hoàn thành Map 1
  // ===================================================
  socket.on("hostContinueMap2", (pin) => {
    const room = rooms[pin];
    if (!room || socket.id !== room.hostId) return;

    console.log(`➡️ Phòng ${pin}: Host chuyển sang Map 2`);

    // Reset tiến độ
    progressByRoom[pin] = 0;
    room.currentMap = "map2"; 

    // Tạo rương mới cho map2
    room.treasures = generateGridTreasures("map2");

    // Gửi dữ liệu mới cho toàn bộ người chơi
    io.to(pin).emit("progressUpdate", 0);
    io.to(pin).emit("updateTreasures", room.treasures);
    io.to(pin).emit("switchMap2");
  });


  // ===================================================
  // 🏁 Khi host bấm “Xem bảng xếp hạng” (kết thúc Map 2)
  // ===================================================
  socket.on("hostEndGame", (pin) => {
    const room = rooms[pin];
    if (!room || socket.id !== room.hostId) return;

    console.log(`🏁 Phòng ${pin}: Game kết thúc!`);
    const ranking = [...room.players].sort((a, b) => b.score - a.score);

    io.to(pin).emit("endGame", ranking);
    delete rooms[pin];
    delete progressByRoom[pin];
  });


});
// ✅ Cho phép truy cập các file tĩnh trong thư mục public
app.use(express.static(path.join(process.cwd(), "public")));

// ✅ Nếu người dùng truy cập domain chính, trả về file index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

server.listen(3000, () => console.log("🚀 Server chạy tại http://localhost:3000"));