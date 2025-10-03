import { createServer } from 'http';
import { existsSync, readFileSync } from 'fs';
import { dirname, extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const clientDistPath = join(__dirname, '..', 'client', 'dist');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const serveStaticFile = (req, res) => {
  const urlPath = req.url?.split('?')[0] ?? '/';
  const requestedPath = urlPath === '/' ? '/index.html' : urlPath;
  const normalizedPath = normalize(requestedPath).replace(/\\/g, '/');
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const safePath = relativePath.startsWith('..') ? 'index.html' : relativePath;
  const resolvedPath = join(clientDistPath, safePath);

  if (existsSync(resolvedPath)) {
    const ext = extname(resolvedPath);
    const contentType = mimeTypes[ext] ?? 'application/octet-stream';
    try {
      const file = readFileSync(resolvedPath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(file);
      return true;
    } catch (error) {
      console.error('Failed to read static file:', resolvedPath, error);
      res.writeHead(500);
      res.end('Internal Server Error');
      return true;
    }
  }

  const fallbackPath = join(clientDistPath, 'index.html');
  if (existsSync(fallbackPath)) {
    try {
      const file = readFileSync(fallbackPath);
      res.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
      res.end(file);
      return true;
    } catch (error) {
      console.error('Failed to read fallback index.html:', error);
      res.writeHead(500);
      res.end('Internal Server Error');
      return true;
    }
  }

  return false;
};

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

httpServer.on('request', (req, res) => {
  if (req.url?.startsWith('/socket.io/')) {
    return;
  }

  const handled = serveStaticFile(req, res);
  if (!handled) {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const DEFAULT_PROJECTILES = 5;
const PROJECTILE_DAMAGE = 15;
const PROJECTILE_SPEED = 520;
const PROJECTILE_LIFETIME = 2200;
const PROJECTILE_VERTICAL_TOLERANCE = 120;
const PROJECTILE_RANGE = 800;

const players = {};

io.on('connection', socket => {
  console.log(`Player connected: ${socket.id}`);
  socket.emit("yourId", socket.id);

  players[socket.id] = players[socket.id] ?? {
    x: 0,
    y: 0,
    hp: 100,
    guarding: false,
    color: 0x000000,
    name: '',
    projectilesRemaining: DEFAULT_PROJECTILES,
  };

  // 既存プレイヤーの状態を新規接続に同期
  Object.entries(players).forEach(([id, state]) => {
    if (id === socket.id) {
      return;
    }
    socket.emit('playerUpdate', { id, ...state });
  });

  socket.emit('playerUpdate', { id: socket.id, ...players[socket.id] });

  socket.on('update', data => {
    const previous = players[socket.id] ?? {
      x: 0,
      y: 0,
      hp: 100,
      guarding: false,
      color: 0x000000,
      name: '',
      projectilesRemaining: DEFAULT_PROJECTILES,
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
    };

    socket.broadcast.emit('playerUpdate', {
      id: socket.id,
      ...players[socket.id]
    });
  });

  socket.on('restart', () => {
    Object.keys(players).forEach((id) => {
      if (!players[id]) {
        return;
      }

      players[id] = {
        ...players[id],
        hp: 100,
        guarding: false,
        projectilesRemaining: DEFAULT_PROJECTILES,
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

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    delete players[socket.id];
  });
});

httpServer.listen(3000, () => {
  console.log("Socket.IO server running on http://localhost:3000");
});
