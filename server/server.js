import { createServer } from 'http';
import { Server } from 'socket.io';
import { readFile } from 'fs/promises';
import { extname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const clientDistPath = resolve(__dirname, '../client/dist');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const serveIndexHtml = async (res, method = 'GET') => {
  const indexPath = resolve(clientDistPath, 'index.html');
  const html = await readFile(indexPath);
  res.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(html);
};

const httpServer = createServer(async (req, res) => {
  if (!req?.url) {
    res.writeHead(400, { 'Content-Type': mimeTypes['.txt'] });
    res.end('Bad Request');
    return;
  }

  const method = req.method ?? 'GET';

  if (req.url.startsWith('/socket.io/')) {
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': mimeTypes['.txt'] });
    res.end('Method Not Allowed');
    return;
  }

  const requestUrl = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname.endsWith('/')) {
    pathname = `${pathname}index.html`;
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const filePath = resolve(clientDistPath, `.${pathname}`);

  if (!filePath.startsWith(clientDistPath)) {
    res.writeHead(403, { 'Content-Type': mimeTypes['.txt'] });
    res.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = extname(filePath);
    const contentType = mimeTypes[extension] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(file);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      try {
        await serveIndexHtml(res, method);
      } catch (indexError) {
        if (indexError?.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': mimeTypes['.txt'] });
          res.end('Client build not found. Run "npm install && npm run build" inside the client directory.');
        } else {
          res.writeHead(500, { 'Content-Type': mimeTypes['.txt'] });
          res.end('Internal Server Error');
        }
      }
    } else {
      res.writeHead(500, { 'Content-Type': mimeTypes['.txt'] });
      res.end('Internal Server Error');
    }
  }
});

const io = new Server(httpServer, { cors: { origin: "*" } });

const DEFAULT_PROJECTILES = 5;
const PROJECTILE_DAMAGE = 15;
const PROJECTILE_SPEED = 520;
const PROJECTILE_LIFETIME = 2200;
const PROJECTILE_VERTICAL_TOLERANCE = 60;
const PROJECTILE_RANGE = 800;
const ROUND_COUNTDOWN_DURATION_MS = 4000;

const SPAWN_POSITIONS = [
  { x: 200, y: 500 },
  { x: 600, y: 500 },
];

const ROUND_PHASES = {
  WARMUP: 'warmup',
  COUNTDOWN: 'countdown',
  ACTIVE: 'active',
};

const rooms = new Map();

const formatRoomList = () =>
  Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    playerCount: room.players.size,
    readyCount: room.readyPlayers.size,
    capacity: SPAWN_POSITIONS.length,
  }));

const broadcastRoomList = () => {
  io.emit('roomList', { rooms: formatRoomList() });
};

const broadcastRoundPhase = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit('roundPhase', {
    phase: room.phase ?? ROUND_PHASES.WARMUP,
  });
};

const sanitizeRoomId = (rawRoomId) => {
  if (typeof rawRoomId !== 'string') {
    return '';
  }

  const trimmed = rawRoomId.trim();
  if (!trimmed) {
    return '';
  }

  return trimmed.slice(0, 32);
};

const getOrCreateRoom = (roomId) => {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      readyPlayers: new Set(),
      countdownTimer: null,
      roundStarting: false,
      phase: ROUND_PHASES.WARMUP,
    });
  }

  return rooms.get(roomId);
};

const deleteRoomIfEmpty = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  if (room.players.size === 0) {
    if (room.countdownTimer) {
      clearTimeout(room.countdownTimer);
    }
    rooms.delete(roomId);
  }
};

const getRoomForSocket = (socket) => {
  const roomId = socket.data?.roomId;
  if (!roomId) {
    return null;
  }

  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }

  return { roomId, room };
};

const getAvailableSpawnIndex = (room) => {
  const occupiedIndexes = new Set(
    Array.from(room.players.values())
      .map((state) => state?.spawnIndex)
      .filter((index) => typeof index === 'number')
  );

  for (let i = 0; i < SPAWN_POSITIONS.length; i += 1) {
    if (!occupiedIndexes.has(i)) {
      return i;
    }
  }

  return 0;
};

const broadcastReadyStates = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  io.to(roomId).emit('readyStates', {
    readyPlayerIds: Array.from(room.readyPlayers),
    totalPlayers: room.players.size,
  });
};

const cancelRoomCountdown = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }

  if (room.roundStarting) {
    room.roundStarting = false;
    io.to(roomId).emit('roundCountdownCancelled');
  }

  if (room.phase !== ROUND_PHASES.WARMUP) {
    room.phase = ROUND_PHASES.WARMUP;
    broadcastRoundPhase(roomId);
  }
};

const resetPlayersForRoom = (roomId) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  room.players.forEach((state, id) => {
    const spawnIndex =
      typeof state.spawnIndex === 'number'
        ? state.spawnIndex
        : getAvailableSpawnIndex(room);
    const spawn = SPAWN_POSITIONS[spawnIndex] ?? SPAWN_POSITIONS[0];

    const updatedState = {
      ...state,
      x: spawn.x,
      y: spawn.y,
      hp: 100,
      guarding: false,
      projectilesRemaining: DEFAULT_PROJECTILES,
      spawnIndex,
    };

    room.players.set(id, updatedState);
    io.to(id).emit('attacked', { hp: 100 });
    io.to(roomId).emit('playerUpdate', { id, ...updatedState });
    io.to(roomId).emit('spawnInfo', { id, spawnIndex });
  });
};

const startRoomCountdown = (roomId) => {
  const room = rooms.get(roomId);
  if (!room || room.roundStarting || room.phase === ROUND_PHASES.ACTIVE) {
    return;
  }

  if (room.players.size < 2) {
    return;
  }

  room.roundStarting = true;
  room.phase = ROUND_PHASES.COUNTDOWN;
  broadcastRoundPhase(roomId);

  resetPlayersForRoom(roomId);

  room.readyPlayers.clear();
  broadcastReadyStates(roomId);

  io.to(roomId).emit('restartGame');

  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
  }

  room.countdownTimer = setTimeout(() => {
    room.roundStarting = false;
    room.countdownTimer = null;
    room.phase = ROUND_PHASES.ACTIVE;
    broadcastRoundPhase(roomId);
  }, ROUND_COUNTDOWN_DURATION_MS);
};

const removeSocketFromCurrentRoom = (socket) => {
  const info = getRoomForSocket(socket);
  if (!info) {
    return;
  }

  const { roomId, room } = info;

  room.players.delete(socket.id);
  room.readyPlayers.delete(socket.id);

  socket.leave(roomId);
  socket.to(roomId).emit('playerLeft', { id: socket.id });

  if (room.players.size < 2) {
    cancelRoomCountdown(roomId);
    if (room.phase === ROUND_PHASES.ACTIVE) {
      room.phase = ROUND_PHASES.WARMUP;
      broadcastRoundPhase(roomId);
    }
  }

  broadcastReadyStates(roomId);
  deleteRoomIfEmpty(roomId);
  broadcastRoomList();
};

io.on('connection', socket => {
  console.log(`Player connected: ${socket.id}`);
  socket.emit('yourId', socket.id);
  socket.emit('roomList', { rooms: formatRoomList() });

  socket.on('requestRoomList', () => {
    socket.emit('roomList', { rooms: formatRoomList() });
  });

  socket.on('joinRoom', ({ roomId: rawRoomId } = {}) => {
    const roomId = sanitizeRoomId(rawRoomId);
    if (!roomId) {
      socket.emit('roomJoinError', { message: 'ルーム名を入力してください。' });
      return;
    }

    const current = getRoomForSocket(socket);
    if (current?.roomId === roomId) {
      socket.emit('roomJoined', { roomId });
      broadcastReadyStates(roomId);
      return;
    }

    if (current) {
      removeSocketFromCurrentRoom(socket);
    }

    const room = getOrCreateRoom(roomId);

    if (room.players.size >= SPAWN_POSITIONS.length) {
      socket.emit('roomJoinError', { message: 'このルームは満員です。' });
      deleteRoomIfEmpty(roomId);
      return;
    }

    const spawnIndex = getAvailableSpawnIndex(room);
    const spawn = SPAWN_POSITIONS[spawnIndex] ?? SPAWN_POSITIONS[0];

    const initialState = {
      x: spawn.x,
      y: spawn.y,
      hp: 100,
      guarding: false,
      color: 0x000000,
      name: '',
      projectilesRemaining: DEFAULT_PROJECTILES,
      spawnIndex,
    };

    room.players.set(socket.id, initialState);
    socket.data.roomId = roomId;
    socket.join(roomId);

    socket.emit('roomJoined', { roomId });
    socket.emit('roundPhase', { phase: room.phase ?? ROUND_PHASES.WARMUP });
    socket.emit('playerUpdate', { id: socket.id, ...initialState });
    socket.emit('spawnInfo', { id: socket.id, spawnIndex });

    room.players.forEach((state, id) => {
      if (id === socket.id) {
        return;
      }

      socket.emit('playerUpdate', { id, ...state });
      socket.emit('spawnInfo', { id, spawnIndex: state.spawnIndex });
    });

    socket.to(roomId).emit('playerUpdate', { id: socket.id, ...initialState });
    socket.to(roomId).emit('spawnInfo', { id: socket.id, spawnIndex });

    if (room.players.size < 2) {
      cancelRoomCountdown(roomId);
    }

    broadcastReadyStates(roomId);
    broadcastRoomList();
  });

  socket.on('setReadyState', ({ ready } = {}) => {
    const info = getRoomForSocket(socket);
    if (!info) {
      return;
    }

    const { roomId, room } = info;

    if (!room.players.has(socket.id) || room.roundStarting || room.phase !== ROUND_PHASES.WARMUP) {
      return;
    }

    if (ready) {
      room.readyPlayers.add(socket.id);
    } else {
      room.readyPlayers.delete(socket.id);
    }

    if (room.readyPlayers.size >= 2 && room.players.size >= 2) {
      startRoomCountdown(roomId);
      return;
    }

    broadcastReadyStates(roomId);
  });

  socket.on('update', data => {
    const info = getRoomForSocket(socket);
    if (!info) {
      return;
    }

    const { roomId, room } = info;

    const previous = room.players.get(socket.id);
    if (!previous) {
      return;
    }

    const sanitizedName =
      typeof data.name === 'string'
        ? data.name.trim().slice(0, 16)
        : previous.name;

    const updatedState = {
      ...previous,
      x: typeof data.x === 'number' ? data.x : previous.x,
      y: typeof data.y === 'number' ? data.y : previous.y,
      hp: typeof data.hp === 'number' ? data.hp : previous.hp,
      guarding: Boolean(data.guarding),
      color:
        typeof data.color === 'number'
          ? data.color
          : previous.color ?? 0x000000,
      name: sanitizedName,
      projectilesRemaining:
        typeof previous.projectilesRemaining === 'number'
          ? previous.projectilesRemaining
          : DEFAULT_PROJECTILES,
      spawnIndex: previous.spawnIndex,
    };

    room.players.set(socket.id, updatedState);

    socket.to(roomId).emit('playerUpdate', {
      id: socket.id,
      ...updatedState,
    });
  });

  socket.on('attack', (attackerPos) => {
    const info = getRoomForSocket(socket);
    if (!info) {
      return;
    }

    const { roomId, room } = info;

    socket.to(roomId).emit('opponentAttack', { attackerId: socket.id });

    if (room.phase !== ROUND_PHASES.ACTIVE) {
      return;
    }

    for (const [id, target] of room.players.entries()) {
      if (id === socket.id) {
        continue;
      }
      if (!target) {
        continue;
      }

      const dx = attackerPos.x - target.x;
      const dy = attackerPos.y - target.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 60) {
        if (!target.guarding) {
          target.hp = Math.max(0, target.hp - 10);
          room.players.set(id, target);
          io.to(id).emit('attacked', { hp: target.hp });
        }

        io.to(roomId).emit('playerUpdate', { id, ...target });

        if (target.hp <= 0) {
          io.to(id).emit('gameover', { result: "LOSE" });
          io.to(socket.id).emit('gameover', { result: "WIN" });
          room.phase = ROUND_PHASES.WARMUP;
          broadcastRoundPhase(roomId);
          broadcastReadyStates(roomId);
        }
      }
    }
  });

  socket.on('projectile', ({ direction } = {}) => {
    const info = getRoomForSocket(socket);
    if (!info) {
      return;
    }

    const { roomId, room } = info;

    const shooter = room.players.get(socket.id);
    if (!shooter) {
      return;
    }

    const matchActive = room.phase === ROUND_PHASES.ACTIVE;

    const remaining =
      typeof shooter.projectilesRemaining === 'number'
        ? shooter.projectilesRemaining
        : DEFAULT_PROJECTILES;

    if (matchActive && remaining <= 0) {
      return;
    }

    const normalizedDirection = direction === 'left' ? 'left' : 'right';

    let shooterState = shooter;

    if (matchActive) {
      const updatedShooter = {
        ...shooter,
        projectilesRemaining: remaining - 1,
      };
      shooterState = updatedShooter;
      room.players.set(socket.id, updatedShooter);
      io.to(roomId).emit('playerUpdate', { id: socket.id, ...updatedShooter });
    } else {
      io.to(roomId).emit('playerUpdate', { id: socket.id, ...shooter });
    }

    io.to(roomId).emit('projectileFired', {
      shooterId: socket.id,
      x: shooterState.x,
      y: shooterState.y,
      direction: normalizedDirection,
      color: shooterState.color,
    });

    for (const [id, target] of room.players.entries()) {
      if (id === socket.id || !target) {
        continue;
      }

      const dx = target.x - shooterState.x;
      const dy = target.y - shooterState.y;
      const directionSign = normalizedDirection === 'left' ? -1 : 1;

      if (dx * directionSign <= 0) {
        continue;
      }

      if (
        Math.abs(dx) > PROJECTILE_RANGE ||
        Math.abs(dy) > PROJECTILE_VERTICAL_TOLERANCE
      ) {
        continue;
      }

      const distance = Math.abs(dx);
      const travelTime = Math.min(
        PROJECTILE_LIFETIME,
        (distance / PROJECTILE_SPEED) * 1000
      );

      setTimeout(() => {
        const latestTarget = room.players.get(id);
        if (!latestTarget || latestTarget.hp <= 0) {
          return;
        }

        if (room.phase !== ROUND_PHASES.ACTIVE) {
          return;
        }

        if (latestTarget.guarding) {
          io.to(roomId).emit('playerUpdate', { id, ...latestTarget });
          return;
        }

        latestTarget.hp = Math.max(0, latestTarget.hp - PROJECTILE_DAMAGE);
        room.players.set(id, latestTarget);
        io.to(id).emit('attacked', { hp: latestTarget.hp });
        io.to(roomId).emit('playerUpdate', { id, ...latestTarget });

        if (latestTarget.hp <= 0) {
          io.to(id).emit('gameover', { result: "LOSE" });
          io.to(socket.id).emit('gameover', { result: "WIN" });
          room.phase = ROUND_PHASES.WARMUP;
          broadcastRoundPhase(roomId);
          broadcastReadyStates(roomId);
        }
      }, travelTime);

      break;
    }
  });

  socket.on('latencyTest', ({ clientTime } = {}) => {
    if (typeof clientTime !== 'number') {
      return;
    }

    socket.emit('latencyPong', { clientTime });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    removeSocketFromCurrentRoom(socket);
  });
});

httpServer.listen(3000, () => {
  console.log("Socket.IO server running on http://localhost:3000");
});
