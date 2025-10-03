import { createServer } from 'http';
import { Server } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

const players = {};

io.on('connection', socket => {
  console.log(`Player connected: ${socket.id}`);
  socket.emit("yourId", socket.id);

  socket.on('update', data => {
    const previous = players[socket.id] ?? {};

    players[socket.id] = {
      x: data.x,
      y: data.y,
      hp: data.hp ?? previous.hp ?? 100,
      guarding: Boolean(data.guarding),
      color: typeof data.color === 'number' ? data.color : previous.color ?? 0x000000,
    };
    socket.broadcast.emit('playerUpdate', {
      id: socket.id,
      ...players[socket.id]
    });
  });

  socket.on('restart', () => {
    io.emit('restartGame');  // 全員に再戦イベントを送信
  });

  socket.on('attack', (attackerPos) => {
    for (let id in players) {
      if (id !== socket.id) {
        const target = players[id];
        const dx = attackerPos.x - target.x;
        const dy = attackerPos.y - target.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 60) {
          if (!players[id].guarding) {
            players[id].hp = Math.max(0, players[id].hp - 10);
            io.to(id).emit('attacked', { hp: players[id].hp });
          }

          // ✅ 攻撃アニメ同期
          io.to(id).emit('opponentAttack');
          io.to(id).emit('opponentAttack'); // 攻撃された人に、相手の攻撃アニメを再生させる

          if (players[id].hp <= 0) {
            io.to(id).emit('gameover', { result: "LOSE" });
            io.to(socket.id).emit('gameover', { result: "WIN" });
          }
        }

      }
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
