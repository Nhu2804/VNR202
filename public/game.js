const socket = io();

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// 🧰 Load ảnh rương vàng và bạc
const chestGold = new Image();
chestGold.src = "chest/chest.png";       // ✅ dùng dấu "/" và đúng đường dẫn
const chestSilver = new Image();
chestSilver.src = "chest/chest_silver.png";
chestGold.onload = () => console.log("✅ Rương vàng đã load!");
chestSilver.onload = () => console.log("✅ Rương bạc đã load!");


// 🧭 CAMERA KHỞI TẠO
const camera = {
  x: 0,
  y: 0,
  zoom: 1.0,
  smoothSpeed: 0.15
};


// =====================================================
// 🌍 LOAD DỮ LIỆU 2 MAP TỪ FILE JSON
// =====================================================
const TileMaps = {};

Promise.all([
  fetch("maps/map1.json").then(r => r.json()).then(d => TileMaps["map1"] = d),
  fetch("maps/map2.json").then(r => r.json()).then(d => TileMaps["map2"] = d)
]).then(() => {
  console.log("✅ Đã load dữ liệu map1 & map2!");
  loadMap("map1"); // 👉 Bắt đầu bằng map1
});

// =====================================================
// 🔧 KHAI BÁO BIẾN TOÀN CỤC DÙNG CHUNG
// =====================================================
let currentMapName = "map1";
let map, TILE_W, TILE_H, tilesetImages = {}, mapLayers = [];
let WORLD_WIDTH, WORLD_HEIGHT;

// =====================================================
// 🧩 HÀM LOAD MAP
// =====================================================
async function loadMap(name) {
  console.log(`🗺️ Đang load ${name}...`);
  map = TileMaps[name];
  currentMapName = name;

  TILE_W = map.tilewidth;
  TILE_H = map.tileheight;

  // === Load tileset ===
  tilesetImages = {};
  map.tilesets.forEach(ts => {
    const imgName = ts.image ? ts.image.split("/").pop() : null;
    if (imgName) {
      const img = new Image();
      img.src = "maps/" + imgName;
      tilesetImages[imgName] = { img, firstgid: ts.firstgid, columns: ts.columns };
    }
  });

  const loadPromises = Object.values(tilesetImages).map(ts =>
    new Promise(resolve => { ts.img.onload = resolve; })
  );
  await Promise.all(loadPromises);

  // === Giải nén layer ===
  mapLayers = map.layers.filter(l => l.type === "tilelayer").map(l => decompressLayer(l));
  WORLD_WIDTH = map.width * TILE_W;
  WORLD_HEIGHT = map.height * TILE_H;

  resizeCanvas();
  autoZoomToFitMap();
  drawMap();

  console.log(`✅ Load ${name} hoàn tất (${map.width}×${map.height})`);
}

// =====================================================
// 🪄 HÀM CHUYỂN MAP (CÓ HIỆU ỨNG FADE)
// =====================================================
async function switchToMap(name) {
  console.log(`🔄 Chuyển sang ${name}...`);
  const fade = document.createElement("div");
  Object.assign(fade.style, {
    position: "absolute", top: 0, left: 0,
    width: "100%", height: "100%", background: "black",
    opacity: 0, transition: "opacity 0.8s", zIndex: 9999
  });
  document.body.appendChild(fade);
  fade.offsetHeight; // trigger reflow
  fade.style.opacity = 1;

  setTimeout(async () => {
    await loadMap(name);
    fade.style.opacity = 0;
    setTimeout(() => fade.remove(), 800);
  }, 800);
}


// === Hàm giải nén layer Base64 + zlib ===
function decompressLayer(layer) {
  const base64Data = atob(layer.data);
  const array = new Uint8Array(base64Data.length);
  for (let i = 0; i < base64Data.length; i++) array[i] = base64Data.charCodeAt(i);
  const inflate = new Zlib.Inflate(array);
  const decompressed = inflate.decompress();
  const data = [];
  for (let i = 0; i < decompressed.length; i += 4) {
    data.push(
      decompressed[i] |
      (decompressed[i + 1] << 8) |
      (decompressed[i + 2] << 16) |
      (decompressed[i + 3] << 24)
    );
  }
  return data;
}

// === Giải nén toàn bộ layer dạng tilelayer ===

function autoZoomToFitMap() {
  const zoomX = window.innerWidth / WORLD_WIDTH;
  const zoomY = window.innerHeight / WORLD_HEIGHT;
  const fitZoom = Math.min(zoomX, zoomY);

  // 🔧 Host khởi tạo zoom = 1.0, người chơi = 1.5
  if (isHost) camera.zoom = 1.0;
  else camera.zoom = 1.5;

  // 🧭 Căn giữa bản đồ trong khung hình
  camera.x = (WORLD_WIDTH - canvas.width / camera.zoom) / 2;
  camera.y = (WORLD_HEIGHT - canvas.height / camera.zoom) / 2;

  console.log(`🔍 Auto zoom set to: ${camera.zoom.toFixed(2)}x`);
}




let roomPin = null, playerName = null, isHost = false, gameStarted = false, isPlayerFrozen = false;
let players = [], me = null, treasures = [], keys = {};
let followTarget = null; // 🆕 Người đang được host theo dõi
// 🧩 Biến quản lý tiến độ qua map
let progressPercent = 0;
// 🌅 Màn hình kết thúc map
const mapEndScreen = document.getElementById("map-end-screen");
const mapEndContent = document.getElementById("map-end-content");
const continueMapBtn = document.getElementById("continueMapBtn");


// 🎵 Cấu hình âm thanh nền
const menuMusic = document.getElementById("menuMusic");
const gameMusic = document.getElementById("gameMusic");
const correctSound = document.getElementById("correctSound");
const wrongSound = document.getElementById("wrongSound");

// Âm lượng
menuMusic.volume = 0.5;
gameMusic.volume = 0.5;
correctSound.volume = 1.0;
wrongSound.volume = 1.0;

// 🔁 Tự động lặp lại khi phát hết
menuMusic.loop = true;
gameMusic.loop = true;

// 🟢 Phát nhạc menu ngay khi vào trang
window.addEventListener("DOMContentLoaded", () => {
  const playMusic = () => {
    menuMusic.play().catch(() => console.log("🎵 Trình duyệt cần thao tác người dùng để phát nhạc."));
    // Gỡ listener sau khi phát
    document.removeEventListener("click", playMusic);
    document.removeEventListener("keydown", playMusic);
  };
  // Đảm bảo phát được dù trình duyệt chặn autoplay
  document.addEventListener("click", playMusic);
  document.addEventListener("keydown", playMusic);
  // Thử phát luôn
  menuMusic.play().catch(() => {});
});


// ====== CAMERA & DRAGGING ======
let isDragging = false;
let dragStart = { x: 0, y: 0 };

canvas.addEventListener("mousedown", (e) => {
  if (isHost) {
    isDragging = true;
    dragStart.x = e.clientX / camera.zoom + camera.x;
    dragStart.y = e.clientY / camera.zoom + camera.y;
  }
});
canvas.addEventListener("mouseup", () => (isDragging = false));
canvas.addEventListener("mouseleave", () => (isDragging = false));

canvas.addEventListener("mousemove", (e) => {
  if (isHost && isDragging && !followTarget) {
    // 📍 Kéo theo chuột, có tính đến zoom
    const newCamX = dragStart.x - e.clientX / camera.zoom;
    const newCamY = dragStart.y - e.clientY / camera.zoom;

    // 🧭 Giới hạn vùng di chuyển — thêm biên 10% để không bị khóa trục ngang
    const viewW = canvas.width / camera.zoom;
    const viewH = canvas.height / camera.zoom;
    const marginX = viewW * 0.1;
    const marginY = viewH * 0.1;

    const maxX = Math.max(-marginX, WORLD_WIDTH - viewW + marginX);
    const maxY = Math.max(-marginY, WORLD_HEIGHT - viewH + marginY);

    camera.x = Math.max(-marginX, Math.min(newCamX, maxX));
    camera.y = Math.max(-marginY, Math.min(newCamY, maxY));
  }
});


window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));
window.addEventListener("resize", resizeCanvas);

function resizeCanvas() {
  canvas.width = Math.min(window.innerWidth, WORLD_WIDTH);
  canvas.height = Math.min(window.innerHeight, WORLD_HEIGHT);
}

// ================= MENU & LOBBY =================
function createRoom() {
  isHost = true;
  socket.emit("createRoom", (pin) => {
    roomPin = pin;
    document.getElementById("roomInfo").innerHTML = `Mã phòng: <b>${pin}</b>`;
    showLobbyUI();
    document.body.className = "page-lobby";
    document.getElementById("startBtn").classList.remove("hidden");
  });
}

// ================= ZOOM CONTROL (chỉ host) =================
canvas.addEventListener("wheel", (e) => {
  // 🧭 Host mới được zoom, người chơi cố định ở 1.5
  if (!isHost) return;
  e.preventDefault();
  const zoomStep = 0.1;
  camera.zoom -= Math.sign(e.deltaY) * zoomStep;

  // 🎯 Giới hạn zoom trong khoảng 1.0 → 1.5
  camera.zoom = Math.max(1.0, Math.min(1.5, camera.zoom));
});



// Hỗ trợ phím tắt + và -
window.addEventListener("keydown", (e) => {
  if (!isHost) return;
  if (e.key === "=" || e.key === "+") camera.zoom = Math.min(1.5, camera.zoom + 0.1);
  if (e.key === "-" || e.key === "_") camera.zoom = Math.max(1.0, camera.zoom - 0.1);
});



// Hàm này khởi tạo và hiển thị modal ở bước 1
function joinRoom() {
  const joinModal = document.getElementById('joinRoomModal');
  const pinStep = document.getElementById('pinStep');
  const nameStep = document.getElementById('nameStep');
  const modalBtn = document.getElementById('joinModalBtn');

  // Reset modal về trạng thái ban đầu (bước 1)
  joinModal.classList.remove('hidden');
  pinStep.classList.remove('hidden');
  nameStep.classList.add('hidden');
  document.getElementById('joinModalTitle').textContent = '🚪 Tham Gia Phòng';
  document.getElementById('roomPinInput').value = '';
  document.getElementById('playerNameInput').value = '';


  // Cấu hình nút cho bước 1
  modalBtn.textContent = 'Tiếp tục';
  modalBtn.onclick = handlePinSubmit;

  document.getElementById('roomPinInput').focus();
}

// Dấu X đóng thẻ
document.getElementById("closeJoinModal").addEventListener("click", () => {
  const joinModal = document.getElementById("joinRoomModal");
  joinModal.classList.add("hidden");

  document.getElementById("pinStep").classList.remove("hidden");
  document.getElementById("nameStep").classList.add("hidden");
  document.getElementById("roomPinInput").value = "";
  document.getElementById("playerNameInput").value = "";
});

// Hàm xử lý khi người dùng nhấn "Tiếp tục" sau khi nhập PIN
function handlePinSubmit() {
  const pinInput = document.getElementById('roomPinInput');
  roomPin = pinInput.value.trim(); // Lưu pin vào biến toàn cục

  if (!roomPin) {
    alert("Vui lòng nhập mã PIN!");
    return;
  }

  // Gửi mã PIN lên server để kiểm tra
  socket.emit('checkRoomPin', roomPin, (res) => {
    if (res.exists) {
      // Nếu PIN hợp lệ, chuyển sang bước 2
      document.getElementById('pinStep').classList.add('hidden');
      document.getElementById('nameStep').classList.remove('hidden');
      document.getElementById('joinModalTitle').textContent = '👋 Tên Của Bạn';

      const modalBtn = document.getElementById('joinModalBtn');
      modalBtn.textContent = 'Vào phòng';
      modalBtn.onclick = handleNameSubmit; // Gán hành động mới cho nút

      document.getElementById('playerNameInput').focus();
    } else {
      // Nếu PIN không hợp lệ, báo lỗi
      alert(res.error);
    }
  });
}

// Hàm xử lý cuối cùng khi người dùng nhấn "Vào phòng" sau khi nhập tên
function handleNameSubmit() {
  const nameInput = document.getElementById('playerNameInput');
  playerName = nameInput.value.trim();

  if (!playerName) {
    alert("Vui lòng nhập tên của bạn!");
    return;
  }

  // Đảm bảo biến isHost = false khi người chơi join (phòng tránh nhầm trạng thái cũ)
  isHost = false;

  // Gửi thông tin đầy đủ để vào phòng
  socket.emit("joinRoom", { pin: roomPin, name: playerName }, (res) => {
    if (res.error) {
      alert(res.error);
    } else {
      document.getElementById("roomInfo").innerHTML = `Đã vào phòng: <b>${roomPin}</b>`;
      showLobbyUI();
      document.body.className = "page-lobby";
      document.getElementById('joinRoomModal').classList.add('hidden');

      // 🧍 Nếu không phải host thì ẩn BXH
      if (!isHost) {
        document.body.classList.add("is-player");

        // 🚫 Ẩn toàn bộ BXH bằng JS để chắc chắn
        const lbBtn = document.getElementById("toggleLeaderboardBtn");
        const lbPanel = document.getElementById("leaderboardPanel");
        if (lbBtn) lbBtn.style.display = "none";
        if (lbPanel) lbPanel.style.display = "none";
      }
    }
  });
}



function startGame() { socket.emit("startGame", roomPin); }
function showLobbyUI() {
  document.getElementById("main-menu").classList.add("hidden");
  document.getElementById("lobby").classList.remove("hidden");
}

// ================= GAME LOGIC =================
let lastMoveEmit = 0; // Giới hạn tần suất gửi lên server

function handleMovement(dt = 1) {
  if (!me || isHost || isPlayerFrozen) return;

  const now = Date.now();
  const baseSpeed = 2.5;
  const speed = (baseSpeed / camera.zoom) * dt;

  let moved = false;

  if (keys["w"] || keys["W"]) { me.y -= speed; me.dir = "up"; moved = true; }
  if (keys["s"] || keys["S"]) { me.y += speed; me.dir = "down"; moved = true; }
  if (keys["a"] || keys["A"]) { me.x -= speed; me.dir = "left"; moved = true; }
  if (keys["d"] || keys["D"]) { me.x += speed; me.dir = "right"; moved = true; }

  me.moving = moved;

  if (moved) {
    const radius = 8, margin = 2;
    me.x = Math.max(radius + margin, Math.min(WORLD_WIDTH - radius - margin, me.x));
    me.y = Math.max(radius + margin, Math.min(WORLD_HEIGHT - radius - margin, me.y));

    if (now - lastMoveEmit > 40) {
      lastMoveEmit = now;
      socket.emit("movePlayer", { pin: roomPin, x: me.x, y: me.y });
    }

    checkTreasureCollision();
  }
}



function checkTreasureCollision() {
    if (isHost || isPlayerFrozen) return;
    for (const t of treasures) {
      if (!t.opened && Math.abs(me.x - t.x) < 25 && Math.abs(me.y - t.y) < 25) {
        socket.emit("openTreasure", { pin: roomPin, treasureId: t.id });
       
        break;
      }
    }
}
// ================= CAMERA =================
function updateCamera() {
  if (isHost && followTarget) {
    const targetX = followTarget.x - canvas.width / 2 / camera.zoom;
    const targetY = followTarget.y - canvas.height / 2 / camera.zoom;
    camera.x += (targetX - camera.x) * camera.smoothSpeed;
    camera.y += (targetY - camera.y) * camera.smoothSpeed;
  } else if (me) {
    const targetX = me.x - canvas.width / 2 / camera.zoom;
    const targetY = me.y - canvas.height / 2 / camera.zoom;
    camera.x += (targetX - camera.x) * camera.smoothSpeed;
    camera.y += (targetY - camera.y) * camera.smoothSpeed;
  }

  const viewW = canvas.width / camera.zoom;
  const viewH = canvas.height / camera.zoom;
  camera.x = Math.max(0, Math.min(camera.x, WORLD_WIDTH - viewW));
  camera.y = Math.max(0, Math.min(camera.y, WORLD_HEIGHT - viewH));


}

// ================= HOST CLICK TO FOLLOW =================
canvas.addEventListener("click", (e) => {
  if (!isHost || !gameStarted) return;

  const rect = canvas.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) / camera.zoom + camera.x;
  const clickY = (e.clientY - rect.top) / camera.zoom + camera.y;

  let clickedPlayer = null;
  for (const p of players) {
    const dx = clickX - (p.x + 20);
    const dy = clickY - (p.y + 20);
    if (Math.sqrt(dx * dx + dy * dy) <= 20) {
      clickedPlayer = p;
      break;
    }
  }

  if (clickedPlayer) {
    // Nếu click trúng người chơi
    followTarget = clickedPlayer;
    socket.emit("setFollowTarget", { pin: roomPin, targetId: clickedPlayer.id });
    console.log("🎥 Theo dõi:", clickedPlayer.name);
  } else {
    // 🆕 Nếu click ra vùng trống -> hủy theo dõi
    if (followTarget) {
      followTarget = null;
      socket.emit("setFollowTarget", { pin: roomPin, targetId: null });
      console.log("🚫 Dừng theo dõi (click ra ngoài)");
    }
  }
});


// ================= DRAWING FUNCTIONS =================
// function drawBackground() {
//     ctx.clearRect(0, 0, canvas.width, canvas.height);
//     const gridSize = 100;
//     let startX = -(camera.x % gridSize);
//     let startY = -(camera.y % gridSize);
//     ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
//     ctx.lineWidth = 2;
//     for (let x = startX; x < canvas.width; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke(); }
//     for (let y = startY; y < canvas.height; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke(); }
// }

function drawMap() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  const cols = map.width;
  const rows = map.height;

  for (const layer of map.layers) {
    if (layer.type !== "tilelayer" || !layer.visible) continue;
    const data = decompressLayer(layer);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tileId = data[y * layer.width + x];
        if (tileId === 0) continue;

        let selectedTileset = null;
        for (const tsDef of map.tilesets) {
          const imgName = tsDef.image ? tsDef.image.split("/").pop() : null;
          if (!imgName) continue;
          const ts = tilesetImages[imgName];
          if (tileId >= tsDef.firstgid) {
            selectedTileset = ts;
          }
        }
        if (!selectedTileset) continue;

        const localId = tileId - selectedTileset.firstgid;
        const sx = (localId % selectedTileset.columns) * TILE_W;
        const sy = Math.floor(localId / selectedTileset.columns) * TILE_H;
        ctx.drawImage(selectedTileset.img, sx, sy, TILE_W, TILE_H, x * TILE_W, y * TILE_H, TILE_W, TILE_H);
      }
    }
  }


  ctx.restore();
}

function drawTreasure(t) {
  const x = t.x;
  const y = t.y;

  // 🧱 Chọn loại rương (nếu có t.type hoặc t.color)
  const img = t.type === "silver" ? chestSilver : chestGold;

  const spriteWidth = 256;   // kích thước khung trong ảnh
  const spriteHeight = 256;
  const drawWidth = 50;      // hiển thị thu nhỏ lại
  const drawHeight = 50;

  // 🧭 Chọn frame: 0 = đóng, 1 = mở
  const frameX = t.opened ? spriteWidth : 0;

  // Vẽ rương tương ứng
  ctx.drawImage(
    img,
    frameX, 0, spriteWidth, spriteHeight,   // vùng cắt
    x - drawWidth / 2, y - drawHeight / 2,  // vị trí vẽ (tâm)
    drawWidth, drawHeight                   // kích thước hiển thị
  );
}

// ============================================================
// 🧍‍♂️ NHÂN VẬT ĐI BỘ (WALK ANIMATION)
// ============================================================

// Bộ cache để không load lại nhiều lần
const spriteCache = {};
function getSprite(path) {
  if (!spriteCache[path]) {
    const img = new Image();
    img.src = path;
    spriteCache[path] = img;
  }
  return spriteCache[path];
}

// Hướng tương ứng với hàng trong sprite sheet
const DIRS = { up: 0, left: 1, down: 2, right: 3 };

// Cập nhật frame animation
function updateAnimation(dt) {
  players.forEach(p => {
    if (!p.frame) p.frame = 0;
    if (!p.animTimer) p.animTimer = 0;
    if (!p.dir) p.dir = "down";

    if (p.moving) {
      p.animTimer += dt;
      if (p.animTimer > 8) { // tốc độ animation
        p.frame = (p.frame + 1) % 9; // 9 frame / hướng
        p.animTimer = 0;
      }
    } else {
      p.frame = 0; // đứng yên
    }
  });
}

// Hàm vẽ nhân vật (dựa trên sprite sheet 9x4)
function drawPlayer(p) {
  const img = getSprite(p.sprite || "characters/character_1.png");
  const frameW = 64;
  const frameH = 64;
  const size = 48;

  const dirIndex = DIRS[p.dir] || 0;
  const sx = (p.frame || 0) * frameW;
  const sy = dirIndex * frameH;
  const dx = p.x - size / 2;
  const dy = p.y - size / 2;

  if (img.complete) {
    ctx.drawImage(img, sx, sy, frameW, frameH, dx, dy, size, size);
  }

  // Tên người chơi 
  ctx.font = "bold 12px Quicksand"; // nhỏ hơn: 12px thay vì 14px
  ctx.textAlign = "center";
  ctx.fillStyle = "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 2;

  // Gần nhân vật hơn: giảm khoảng cách (từ -10 → -4)
  ctx.strokeText(p.name, p.x, dy - 4);
  ctx.fillText(p.name, p.x, dy - 4);

  ctx.textAlign = "start";

}





// <--- KHU VỰC QUAN TRỌNG 4: HÀM VẼ SỬ DỤNG CAMERA --->
function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 🧱 Giới hạn vùng hiển thị đúng bằng map thật
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, WORLD_WIDTH * camera.zoom, WORLD_HEIGHT * camera.zoom);
  ctx.clip();

  drawMap();
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  treasures.forEach(drawTreasure);
  players.forEach(drawPlayer);

  ctx.restore();

  // HUD (hiển thị zoom)
  if (isHost) {
    const padding = 20;
    const text = `🔍 Zoom: ${camera.zoom.toFixed(1)}x`;
    ctx.font = "16px Quicksand";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(text, canvas.width - padding, canvas.height - padding);
    ctx.textAlign = "start";
  }
}

let lastFrameTime = performance.now();

function gameLoop() {
  if (!gameStarted) return;
  
  const now = performance.now();
  const deltaTime = (now - lastFrameTime) / 16.67; // chuẩn hóa về 60 FPS
  lastFrameTime = now;

  handleMovement(deltaTime);
  updateCamera();
  smoothPlayers();
  updateAnimation(deltaTime);

  drawGame();

  requestAnimationFrame(gameLoop);
}

// ================= SOCKET EVENTS =================
// ============================================================
// 🎯 CẬP NHẬT THANH TIẾN ĐỘ + HIỂN THỊ PHÁO HOA & Ý NGHĨA
// ============================================================
function updateProgressBar(value) {
  progressPercent = Math.min(100, value);
  const bar = document.getElementById("progress-bar");
  const text = document.getElementById("progress-text");

  if (bar && text) {
    bar.style.width = progressPercent + "%";
    text.textContent = `${progressPercent}%`;
  }

  // ✅ Khi đạt 100%
  if (progressPercent >= 100) {
    let giaiDoan = "";
    if (currentMapName === "map1") giaiDoan = "1946–1950";
    else if (currentMapName === "map2") giaiDoan = "1950–1954";

    console.log(`🎯 Hoàn thành ${currentMapName} (${giaiDoan})`);

    // 🌑 Hiển thị lớp mờ (ổn định)
    showOverlay();

    // 📡 Host gửi tín hiệu để tất cả người chơi cùng hiện lớp mờ
    if (isHost) socket.emit("broadcastShowFade", { pin: roomPin });

    // 🎆 Hiệu ứng pháo hoa + gọi showMapMeaning khi chữ biến mất
    singleFirework(`🎉 Hoàn thành giai đoạn ${giaiDoan}`, () => {
      console.log("✨ Pháo và chữ hoàn thành → Hiện bảng ý nghĩa");
      showMapMeaning(currentMapName);

      // 🔹 Ẩn nút “Tiếp tục” với người chơi (chỉ host có)
      if (!isHost) {
        const btn = document.getElementById("continueMapBtn");
        if (btn) btn.classList.add("hidden");
      }
    });

    // 🧭 Đồng bộ sự kiện hoàn thành map
    if (isHost) socket.emit("mapCompleted", { pin: roomPin, map: currentMapName });
  }
}



// ============================================================
// 🎇 PHÁO HOA + CHỮ "HOÀN THÀNH GIAI ĐOẠN" → GỌI CALLBACK KHI XONG
// ============================================================
function singleFirework(titleText, onFinish) {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed",
    top: 0,
    left: 0,
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: 9998,
    background: "transparent",
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d", { alpha: true });
  const W = (canvas.width = window.innerWidth);
  const H = (canvas.height = window.innerHeight);
  const gravity = 0.08;
  const fireworks = [];

  function createFirework() {
    const x = Math.random() * W * 0.8 + W * 0.1;
    const y = H;
    const targetY = Math.random() * H * 0.5 + H * 0.2;
    const colorHue = Math.random() * 360;
    fireworks.push({
      x,
      y,
      targetY,
      speed: Math.random() * 4 + 6,
      exploded: false,
      colorHue,
      particles: [],
    });
  }

  function explode(fw) {
    const count = 70 + Math.random() * 40;
    for (let i = 0; i < count; i++) {
      const angle = (i * Math.PI * 2) / count;
      const speed = Math.random() * 5 + 2;
      fw.particles.push({
        x: fw.x,
        y: fw.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 1,
        color: `hsl(${fw.colorHue + Math.random() * 40}, 100%, 60%)`,
      });
    }
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    fireworks.forEach((fw) => {
      if (!fw.exploded) {
        fw.y -= fw.speed;
        fw.speed -= gravity * 0.4;
        ctx.beginPath();
        ctx.arc(fw.x, fw.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${fw.colorHue}, 100%, 70%)`;
        ctx.fill();

        if (fw.y <= fw.targetY || fw.speed <= 0) {
          fw.exploded = true;
          explode(fw);
        }
      } else {
        fw.particles.forEach((p) => {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += gravity * 0.3;
          p.alpha -= 0.015;

          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 3);
          grad.addColorStop(0, `rgba(${colorToRGB(p.color)},${p.alpha})`);
          grad.addColorStop(1, `rgba(${colorToRGB(p.color)},0)`);

          ctx.beginPath();
          ctx.fillStyle = grad;
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
        fw.particles = fw.particles.filter((p) => p.alpha > 0);
      }
    });

    if (Math.random() < 0.05) createFirework();
    requestAnimationFrame(loop);
  }

  loop();

  function colorToRGB(hsl) {
    const tmp = document.createElement("div");
    tmp.style.color = hsl;
    document.body.appendChild(tmp);
    const rgb = window.getComputedStyle(tmp).color.match(/\d+/g);
    document.body.removeChild(tmp);
    return rgb.slice(0, 3).join(",");
  }

  // 🧹 Xóa canvas sau 5s
  setTimeout(() => canvas.remove(), 5000);

  // ✨ Tạo chữ
  const textDiv = document.createElement("div");
  textDiv.textContent = titleText;
  Object.assign(textDiv.style, {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    color: "#fff",
    fontFamily: "Quicksand, sans-serif",
    fontSize: "2.4rem",
    fontWeight: "700",
    textShadow: "0 0 15px #ffcc00, 0 0 25px #ff6600",
    zIndex: 10000,
    opacity: 0,
    transition: "opacity 0.8s ease",
  });
  document.body.appendChild(textDiv);

  setTimeout(() => (textDiv.style.opacity = 1), 200);
  setTimeout(() => (textDiv.style.opacity = 0), 3500);
  setTimeout(() => {
    textDiv.remove();
    if (onFinish) onFinish(); // 🔥 GỌI CALLBACK khi chữ biến mất
  }, 4500);
}


// Khi người chơi nhận tín hiệu tạo lớp mờ
socket.on("broadcastShowFade", () => {
  console.log("🌓 Người chơi nhận tín hiệu → hiện lớp mờ");
  const fade = document.getElementById("fade-overlay");
  if (fade) fade.classList.add("visible");
});

// Khi người chơi nhận tín hiệu xoá lớp mờ
socket.on("broadcastHideEndScreen", () => {
  console.log("📢 Người chơi nhận tín hiệu → xoá lớp mờ & bảng ý nghĩa");
  const fade = document.getElementById("fade-overlay");
  const endScreen = document.getElementById("map-end-screen");
  if (fade) fade.classList.remove("visible");
  if (endScreen) {
    endScreen.classList.remove("show");
    setTimeout(() => endScreen.classList.add("hidden"), 600);
  }
});


// ============================================================
// 📜 HIỂN THỊ Ý NGHĨA SAU KHI HOÀN THÀNH MAP (DÙNG JSON)
// ============================================================
async function showMapMeaning(mapName) {
  const endScreen = document.getElementById("map-end-screen");
  const content = document.getElementById("map-end-content");
  const continueBtn = document.getElementById("continueMapBtn");
  const fade = document.getElementById("fade-overlay");

  // 🌑 Hiện lớp mờ nền
  if (fade) fade.classList.add("visible");

  try {
    // 🧭 1️⃣ Tải dữ liệu JSON
    const res = await fetch("data/map_meanings.json");
    const data = await res.json();
    const mapData = data[mapName];

    if (!mapData) {
      console.warn(`⚠️ Không tìm thấy nội dung cho ${mapName}`);
      return;
    }

    // 🧾 2️⃣ Gộp nội dung HTML
    const html = `
      <h2>${mapData.title}</h2>
      ${mapData.paragraphs.join("\n")}
    `;
    content.innerHTML = html;


    // 🪄 3️⃣ Hiển thị popup
    endScreen.classList.remove("hidden");
    setTimeout(() => {
      endScreen.classList.add("show");

      // 🔝 Reset scroll sau khi popup hiển thị hoàn chỉnh
      const scrollBox = document.querySelector(".map-end-scroll");
      if (scrollBox) scrollBox.scrollTop = 0;
    }, 100);

    // 🟡 4️⃣ Cấu hình nút
    continueBtn.textContent = mapData.button;
    continueBtn.classList.remove("hidden");

    // 🧊 Nếu người chơi thường → ẩn nút
    if (!isHost) {
      continueBtn.classList.add("hidden");
      return;
    }

    // 🧱 5️⃣ Hàm ẩn popup
    const hidePopup = () => {
      if (fade) fade.classList.remove("visible");
      endScreen.classList.remove("show");
      setTimeout(() => endScreen.classList.add("hidden"), 600);
    };

    // ⚡ 6️⃣ Gán hành động cho host
    if (mapData.nextAction === "nextMap2") {
      // 🎯 Khi host bấm tiếp tục
      continueBtn.onclick = () => {
        hidePopup();
        socket.emit("broadcastHideEndScreen", { pin: roomPin });
        socket.emit("hostContinueMap2", roomPin);
      };

      // ⏳ Tự động sau 60 giây
      setTimeout(() => {
        console.log("⏳ Tự động sang Map 2 sau 60s");
        hidePopup();
        socket.emit("broadcastHideEndScreen", { pin: roomPin });
        socket.emit("hostContinueMap2", roomPin);
      }, 60000);
    }

    else if (mapData.nextAction === "endGame") {
      // 🎯 Khi host bấm hoàn thành
      continueBtn.onclick = () => {
        hidePopup();
        socket.emit("broadcastHideEndScreen", { pin: roomPin });
        socket.emit("hostEndGame", roomPin);
        socket.emit("hostShowLeaderboard", roomPin);
      };

      // ⏳ Tự động sau 60 giây
      setTimeout(() => {
        console.log("⏳ Tự động kết thúc game sau 60s");
        hidePopup();
        socket.emit("broadcastHideEndScreen", { pin: roomPin });
        socket.emit("hostEndGame", roomPin);
        socket.emit("hostShowLeaderboard", roomPin);
      }, 60000);
    }

    // 🚫 7️⃣ Đóng băng điều khiển khi xem popup
    isPlayerFrozen = true;

  } catch (err) {
    console.error("❌ Lỗi khi tải map_meanings.json:", err);
  }
}





// ================= POPUPS & QUIZ =================
function showInfoBox(t) {
  isPlayerFrozen = true;
  const infoBox = document.getElementById("infoBox");
  infoBox.classList.remove("hidden");
  document.getElementById("infoText").innerHTML = t.info;
  document.getElementById("quizBtn").onclick = () => {
    infoBox.classList.add("hidden");
    showQuiz(t);
  };
}
function showQuiz(t) {
  const quizBox = document.getElementById("quizBox");
  quizBox.classList.remove("hidden");
  document.getElementById("questionText").textContent = t.question;
  const list = document.getElementById("answerOptions");
  list.innerHTML = "";

  // 🧩 Tạo danh sách đáp án
  t.options.forEach((opt, i) => {
    const li = document.createElement("li");
    li.textContent = opt;

    li.onclick = () => {
      // 🔒 Khóa tất cả đáp án sau khi chọn
      const allOptions = list.querySelectorAll("li");
      allOptions.forEach(o => o.classList.add("disabled"));

      if (i === t.correct) {
        // ✅ Đáp án đúng
        li.classList.add("correct");
        correctSound.currentTime = 0;
        correctSound.play();

        // 💎 Phân loại điểm theo loại rương
        const gained = t.type === "gold" ? 20 : 10;

        // 🔼 Cập nhật điểm đúng loại
        socket.emit("updateScore", { pin: roomPin, delta: gained });

        // 💫 Hiển thị hiệu ứng cộng điểm
        spawnScoreFloat(`+${gained}`);
        showScorePopup();

        // 🧭 Tiến độ: rương bạc +5%, rương vàng +10%
        const progressGain = t.type === "gold" ? 2 : 3;
        socket.emit("increaseProgress", { pin: roomPin, amount: progressGain });

      } else {
        // ❌ Đáp án sai
        li.classList.add("wrong");
        wrongSound.currentTime = 0;
        wrongSound.play();
        allOptions[t.correct].classList.add("correct");
      }

      // ⏳ Đợi 1.0s rồi đóng câu hỏi
      setTimeout(() => {
        quizBox.classList.add("hidden");
        isPlayerFrozen = false;
      }, 1000);
    };

    list.appendChild(li);
  });
}

// 💫 Tạo hiệu ứng +10 điểm nổi lên
function spawnScoreFloat(text) {
  const floatEl = document.createElement("div");
  floatEl.className = "score-float";
  floatEl.textContent = text;

  // Lấy vị trí ô “Điểm: ...”
  const hud = document.getElementById("hud-score");
  const rect = hud.getBoundingClientRect();

  // 📍 Đặt ngay dưới ô điểm (trung tâm)
  floatEl.style.left = rect.left + rect.width / 2 - 20 + "px";
  floatEl.style.top = rect.bottom + 5 + "px";

  document.body.appendChild(floatEl);

  // ⏳ Hiệu ứng bay lên và biến mất
  setTimeout(() => floatEl.remove(), 2000);
}



function showScorePopup() {
    const popup = document.getElementById('score-popup');
    popup.classList.remove('hidden');
    popup.classList.add('show');
    setTimeout(() => {
        popup.classList.remove('show');
        setTimeout(() => popup.classList.add('hidden'), 500);
    }, 800);
}

// ================= SOCKET EVENTS =================
socket.on("updatePlayers", (list) => {
  players = list;
  me = players.find((p) => p.id === socket.id);

  


  const playersListContainer = document.getElementById("players-list");
  const playerCountSpan = document.getElementById("player-count");

  // Xóa danh sách người chơi hiện tại
  playersListContainer.innerHTML = "";

  // Cập nhật số lượng người chơi
  playerCountSpan.textContent = players.length;

  // Tạo và thêm từng khung người chơi vào container
  if (players.length > 0) {
    players.forEach(p => {
      const playerCard = document.createElement("div");
      playerCard.className = "player-card";
      playerCard.textContent = p.name;
      playersListContainer.appendChild(playerCard);
    });
  } else {
    // Hiển thị thông báo nếu chưa có ai
    playersListContainer.innerHTML = "<i>Chưa có ai tham gia...</i>";
  }

  // 🧩 Cập nhật điểm cá nhân (chỉ người chơi)
  if (me && !isHost) {
    document.getElementById("hud-score").textContent = `Điểm: ${me.score}`;
  }

  // 🧩 Nếu là host → hiển thị nút BXH và cập nhật danh sách
  if (isHost) {
    document.getElementById("hud-score").classList.add("hidden");
    document.getElementById("toggleLeaderboardBtn").classList.remove("hidden");
    updateLeaderboard(players);
  }

  // 🟢 Nếu là host và đang theo dõi ai đó, cập nhật followTarget từ danh sách mới nhất
  if (isHost && followTarget) {
    const updatedTarget = players.find(p => p.id === followTarget.id);
    if (updatedTarget) followTarget = updatedTarget;
  }

});

// 🏆 Toggle hiển thị bảng xếp hạng cho host
const toggleBtn = document.getElementById("toggleLeaderboardBtn");
const leaderboardPanel = document.getElementById("leaderboardPanel");

if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    leaderboardPanel.classList.toggle("hidden");
  });
}

// 🧭 Hàm cập nhật danh sách điểm
function updateLeaderboard(list) {
  const leaderboardList = document.getElementById("leaderboardList");
  if (!leaderboardList) return;

  leaderboardList.innerHTML = "";
  const sorted = [...list].sort((a, b) => b.score - a.score);
  sorted.forEach((p, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${i + 1}. ${p.name}</span> <span>${p.score}</span>`;
    leaderboardList.appendChild(li);
  });
}


// 🆕 Khi server báo ai đang được theo dõi (người di chuyển)
socket.on("followTargetUpdate", (targetId) => {
  if (!isHost) return;
  followTarget = players.find(p => p.id === targetId) || null;
});

socket.on("startGame", () => {
  menuMusic.pause();
  menuMusic.currentTime = 0;
  gameMusic.play();

  // 👇 Thêm dòng này để đổi giao diện
  document.body.className = "page-game";

  document.getElementById("ui-container").classList.add("hidden");
  document.getElementById("game-container").classList.remove("hidden");
  gameStarted = true; resizeCanvas(); gameLoop();
});

socket.on("updateTreasures", (list) => { treasures = list || []; });

socket.on("treasureOpened", (id) => { const t = treasures.find((x) => x.id === id); if (t) t.opened = true; });

// 🟩 Nhận cập nhật tiến độ từ server
socket.on("progressUpdate", (value) => {
  updateProgressBar(value);
});

socket.on("showQuestion", (data) => {
  // data chứa: question, options, correct, points...
  showInfoBox(data); // hàm có sẵn hiển thị câu hỏi
});

// 🧩 Hiển thị / Ẩn lớp mờ với hiệu ứng mượt
function showOverlay() {
  const fade = document.getElementById("fade-overlay");
  if (fade) {
    fade.classList.add("visible");
    fade.style.transition = "opacity 0.8s ease";
    fade.style.opacity = 1;
    fade.style.pointerEvents = "auto";
  }
}

function hideOverlay() {
  const fade = document.getElementById("fade-overlay");
  if (fade) {
    fade.classList.remove("visible");
    fade.style.transition = "opacity 0.8s ease";
    fade.style.opacity = 0;
    fade.style.pointerEvents = "none";
  }
}


socket.on("switchMap2", () => {
  console.log("🧭 Nhận tín hiệu sang Map 2 từ host!");
  progressPercent = 0;
  updateProgressBar(0);
  hideOverlay();

  const endScreen = document.getElementById("map-end-screen");
  if (endScreen) endScreen.classList.add("hidden");

  switchToMap("map2");

  // ✅ Mở lại di chuyển sau khi sang map 2
  isPlayerFrozen = false;
});



// socket.on("timerUpdate", (t) => {
//   const mins = Math.floor(t / 60), secs = t % 60;
//   const timeString = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
//   document.getElementById("hud-timer").textContent = `⏳ ${timeString}`;
// });
socket.on("endGame", (ranking) => {
  // ✅ Ẩn bảng ý nghĩa nếu còn mở
  const endScreen = document.getElementById("map-end-screen");
  if (endScreen) endScreen.classList.add("hidden");
  hideOverlay();

  // 🎵 Âm nhạc & trạng thái
  gameMusic.pause();
  gameMusic.currentTime = 0;
  menuMusic.play();
  gameStarted = false;

  // 🎮 Giao diện
  document.getElementById("game-container").classList.add("hidden");
  document.getElementById("ui-container").classList.remove("hidden");
  document.getElementById("menu").classList.add("hidden");

  // 🏆 Hiển thị bảng xếp hạng
  const scores = document.getElementById("scores");
  scores.innerHTML = ranking.map(p => `<li>${p.name} <span>${p.score} điểm</span></li>`).join("");
  document.getElementById("leaderboard").classList.remove("hidden");
  
  document.body.classList.add("show-leaderboard");
  

  // 📰 === HIỂN THỊ GÓC BÁO CHÍ SAU 1S ===
  setTimeout(() => {
    const news = document.getElementById("news-section");
    if (news) {
      news.classList.remove("hidden");
      setTimeout(() => news.classList.add("show"), 100);

      // 🔘 Tạo hiệu ứng chấm trượt báo
      const track = document.getElementById("newsTrack");
      const dotsContainer = document.getElementById("newsDots");
      const cards = document.querySelectorAll("#newsTrack .news-card");
      if (track && dotsContainer && cards.length > 0) {
        // ✅ CHỈNH 2 BÀI / TRANG
        const itemsPerSlide = 2;
        const totalSlides = Math.ceil(cards.length / itemsPerSlide);
        let currentSlide = 0;

        dotsContainer.innerHTML = "";
        for (let i = 0; i < totalSlides; i++) {
          const dot = document.createElement("button");
          if (i === 0) dot.classList.add("active");
          dot.addEventListener("click", () => {
            currentSlide = i;
            updateCarousel();
          });
          dotsContainer.appendChild(dot);
        }

        const dots = dotsContainer.querySelectorAll("button");

        function updateCarousel() {
          track.style.transform = `translateX(-${currentSlide * 100}%)`;
          dots.forEach((d, i) => d.classList.toggle("active", i === currentSlide));
        }

        // 🕒 Tự trượt sau mỗi 10s
        setInterval(() => {
          currentSlide = (currentSlide + 1) % totalSlides;
          updateCarousel();
        }, 10000);
      }
    }
  }, 1000);


});


// 🆕 Cập nhật vị trí 1 người chơi duy nhất (tránh lag khi host theo dõi)
// Bộ đệm vị trí cho mỗi player
const positionBuffer = {};
const INTERPOLATION_DELAY = 100; // ms trễ “an toàn”

socket.on("playerMoved", ({ id, x, y }) => {
  if (id === socket.id) return; // bỏ qua chính mình
  if (!positionBuffer[id]) positionBuffer[id] = [];
  positionBuffer[id].push({ t: Date.now(), x, y });
  if (positionBuffer[id].length > 10) positionBuffer[id].shift();
});

// Mỗi frame, nội suy mượt giữa 2 vị trí gần nhất
function smoothPlayers() {
  const renderTime = Date.now() - INTERPOLATION_DELAY;
  players.forEach(p => {
    if (p.id === socket.id) return;
    const buf = positionBuffer[p.id];
    if (!buf || buf.length < 2) return;

    // Tìm 2 mốc bao quanh thời điểm renderTime
    let i = buf.findIndex(b => b.t > renderTime);
    if (i < 1) return;
    const older = buf[i - 1];
    const newer = buf[i];
    const ratio = (renderTime - older.t) / (newer.t - older.t);

    p.x = older.x + (newer.x - older.x) * ratio;
    p.y = older.y + (newer.y - older.y) * ratio;
  });
}



// =========================================================
// 🧭 XỬ LÝ NÚT ← CỦA TRÌNH DUYỆT: LUÔN QUAY VỀ MENU
// =========================================================

// Mỗi khi chuyển sang lobby hoặc game, thêm 1 state ảo
function pushStateView(view) {
  history.pushState({ view }, "", window.location.href);
}

// Khi vào lobby
function showLobbyUI() {
  document.getElementById("main-menu").classList.add("hidden");
  document.getElementById("lobby").classList.remove("hidden");
  document.body.className = "page-lobby";
  pushStateView("lobby");
}

// Khi bắt đầu game
socket.on("startGame", () => {
  menuMusic.pause();
  menuMusic.currentTime = 0;
  gameMusic.play();

  document.body.className = "page-game";
  document.getElementById("ui-container").classList.add("hidden");
  document.getElementById("game-container").classList.remove("hidden");
  gameStarted = true;
  resizeCanvas();
  drawGame();
  gameLoop();

  pushStateView("game");
});

// 🧭 Khi người chơi bấm nút ← (Back) của trình duyệt
window.addEventListener("popstate", (event) => {
  console.log("🔙 Back pressed, returning to MENU");

  // 🧹 Reset trạng thái game / phòng
  gameStarted = false;
  isHost = false;
  roomPin = null;
  followTarget = null;

  // 🧹 Xóa danh sách người chơi còn sót lại
  const playersListContainer = document.getElementById("players-list");
  if (playersListContainer) playersListContainer.innerHTML = "";

  // Ẩn mọi phần không cần thiết
  document.getElementById("game-container").classList.add("hidden");
  document.getElementById("lobby").classList.add("hidden");
  document.getElementById("leaderboard").classList.add("hidden");

  // ✅ Hiện lại menu chính
  document.getElementById("main-menu").classList.remove("hidden");
  document.getElementById("ui-container").classList.remove("hidden");
  document.body.className = "page-menu";

  // 🔊 Chuyển lại nhạc menu
  gameMusic.pause();
  gameMusic.currentTime = 0;
  menuMusic.play();

  // 🧭 Giữ lại state ảo để không bị thoát thật
  pushStateView("menu");
});



// ===========================
// 🎯 CHO PHÉP NHẤN ENTER THAY CHO NÚT TIẾP TỤC / VÀO PHÒNG
// ===========================

// Khi đang ở bước nhập mã PIN
document.getElementById("roomPinInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault(); // Ngăn reload form
    handlePinSubmit();  // Gọi hàm xử lý như khi bấm nút "Tiếp tục"
  }
});

// Khi đang ở bước nhập tên
document.getElementById("playerNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleNameSubmit(); // Gọi hàm xử lý như khi bấm nút "Vào phòng"
  }
});




document.getElementById("playAgainBtn")?.addEventListener("click", () => {
  document.body.classList.remove("show-leaderboard"); // 👈 gỡ class
  window.location.reload();
});
