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
const RESTART_COOLDOWN_MS = 3500;

const SPAWN_POSITIONS = [
  { x: 200, y: 500 },
  { x: 600, y: 500 },
];

function getAvailableSpawnIndex() {
  const occupiedIndexes = new Set(
    Object.values(players)
      .map((state) => state?.spawnIndex)
      .filter((index) => typeof index === 'number')
  );

  for (let i = 0; i < SPAWN_POSITIONS.length; i += 1) {
    if (!occupiedIndexes.has(i)) {
      return i;
    }
  }

  return 0;
}

const players = {};

let restartCooldownUntil = 0;

io.on('connection', socket => {
  console.log(`Player connected: ${socket.id}`);
  socket.emit("yourId", socket.id);

  if (!players[socket.id]) {
    const spawnIndex = getAvailableSpawnIndex();
    const spawn = SPAWN_POSITIONS[spawnIndex] ?? SPAWN_POSITIONS[0];

    players[socket.id] = {
      x: spawn.x,
      y: spawn.y,
      hp: 100,
      guarding: false,
      color: 0x000000,
      name: '',
      projectilesRemaining: DEFAULT_PROJECTILES,
      spawnIndex,
    };
  }

  // 既存プレイヤーの状態を新規接続に同期
  Object.entries(players).forEach(([id, currentState]) => {
    if (id === socket.id) {
      return;
    }

    let state = currentState;
    if (typeof state.spawnIndex !== 'number') {
      const spawnIndex = getAvailableSpawnIndex();
      const spawn = SPAWN_POSITIONS[spawnIndex] ?? SPAWN_POSITIONS[0];
      players[id] = {
        ...players[id],
        spawnIndex,
        x: spawn.x,
        y: spawn.y,
      };
      state = players[id];
    }

    socket.emit('playerUpdate', { id, ...state });
  });

  socket.emit('playerUpdate', { id: socket.id, ...players[socket.id] });
  socket.emit('spawnInfo', {
    id: socket.id,
    spawnIndex: players[socket.id].spawnIndex,
  });

  Object.entries(players).forEach(([id, state]) => {
    if (id === socket.id) {
      return;
    }

    const spawnIndex =
      typeof state.spawnIndex === 'number'
        ? state.spawnIndex
        : getAvailableSpawnIndex();
    socket.emit('spawnInfo', { id, spawnIndex });
  });

  socket.broadcast.emit('playerUpdate', { id: socket.id, ...players[socket.id] });
  socket.broadcast.emit('spawnInfo', {
    id: socket.id,
    spawnIndex: players[socket.id].spawnIndex,
  });

  socket.on('update', data => {
    const previous = players[socket.id] ?? {
      x: 0,
      y: 0,
      hp: 100,
      guarding: false,
      color: 0x000000,
      name: '',
      projectilesRemaining: DEFAULT_PROJECTILES,
      spawnIndex: getAvailableSpawnIndex(),
    };

    const sanitizedName =
      typeof data.name === 'string'
        ? data.name.trim().slice(0, 16)
        : previous.name;

    players[socket.id] = {
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

    socket.broadcast.emit('playerUpdate', {
      id: socket.id,
      ...players[socket.id]
    });
  });

  socket.on('restart', () => {
    const now = Date.now();
    if (now < restartCooldownUntil) {
      return;
    }

    restartCooldownUntil = now + RESTART_COOLDOWN_MS;

    Object.keys(players).forEach((id) => {
      if (!players[id]) {
        return;
      }

      const spawnIndex =
        typeof players[id]?.spawnIndex === 'number'
          ? players[id].spawnIndex
          : getAvailableSpawnIndex();
      const spawn = SPAWN_POSITIONS[spawnIndex] ?? SPAWN_POSITIONS[0];

      players[id] = {
        ...players[id],
        x: spawn.x,
        y: spawn.y,
        hp: 100,
        guarding: false,
        projectilesRemaining: DEFAULT_PROJECTILES,
        spawnIndex,
      };

      io.to(id).emit('attacked', { hp: 100 });
    });

    io.emit('restartGame');

    Object.entries(players).forEach(([id, state]) => {
      io.emit('playerUpdate', { id, ...state });
    });
  });

  socket.on('attack', (attackerPos) => {
    // 攻撃アニメを全員に通知（自分以外）
    socket.broadcast.emit('opponentAttack', { attackerId: socket.id });

    for (let id in players) {
      if (id === socket.id) {
        continue;
      }

      const target = players[id];
      if (!target) {
        continue;
      }

      const dx = attackerPos.x - target.x;
      const dy = attackerPos.y - target.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 60) {
        if (!target.guarding) {
          players[id].hp = Math.max(0, players[id].hp - 10);
          io.to(id).emit('attacked', { hp: players[id].hp });
        }

        // HP やガード状態を最新化
        io.emit('playerUpdate', { id, ...players[id] });

        if (players[id].hp <= 0) {
          io.to(id).emit('gameover', { result: "LOSE" });
          io.to(socket.id).emit('gameover', { result: "WIN" });
        }
      }
    }
  });

  socket.on('projectile', ({ direction } = {}) => {
    const shooter = players[socket.id];
    if (!shooter) {
      return;
    }

    const remaining =
      typeof shooter.projectilesRemaining === 'number'
        ? shooter.projectilesRemaining
        : DEFAULT_PROJECTILES;

    if (remaining <= 0) {
      return;
    }

    const normalizedDirection = direction === 'left' ? 'left' : 'right';

    const updatedShooter = {
      ...shooter,
      projectilesRemaining: remaining - 1,
    };
    players[socket.id] = updatedShooter;

    io.emit('playerUpdate', { id: socket.id, ...updatedShooter });

    io.emit('projectileFired', {
      shooterId: socket.id,
      x: updatedShooter.x,
      y: updatedShooter.y,
      direction: normalizedDirection,
      color: updatedShooter.color,
    });

    for (const [id, target] of Object.entries(players)) {
      if (id === socket.id || !target) {
        continue;
      }

      const dx = target.x - updatedShooter.x;
      const dy = target.y - updatedShooter.y;
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
        const latestTarget = players[id];
        if (!latestTarget || latestTarget.hp <= 0) {
          return;
        }

        if (latestTarget.guarding) {
          io.emit('playerUpdate', { id, ...latestTarget });
          return;
        }

        latestTarget.hp = Math.max(0, latestTarget.hp - PROJECTILE_DAMAGE);
        io.to(id).emit('attacked', { hp: latestTarget.hp });
        io.emit('playerUpdate', { id, ...latestTarget });

        if (latestTarget.hp <= 0) {
          io.to(id).emit('gameover', { result: "LOSE" });
          io.to(socket.id).emit('gameover', { result: "WIN" });
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
    delete players[socket.id];
  });
});

httpServer.listen(3000, () => {
  console.log("Socket.IO server running on http://localhost:3000");
});
