import Phaser from 'phaser';
import { io } from 'socket.io-client';

const socket = io("http://192.168.148.180:3000", );

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#ffffff",
  physics: {
    default: "arcade",
    arcade: { gravity: { y: 1000 }, debug: false },
  },
  scene: { preload, create, update },
};

const game = new Phaser.Game(config);

let player, opponent;
let cursors;
let playerGraphics, opponentGraphics;
let hp = 100;
let opponentHp = 100;
let hpText;
let isPunching = false;
let opponentIsPunching = false;
let resultText;
let waitingText;
let hasOpponent = false;
let gameOver = false;
let myId;
let opponentId;
let isLeft = true;

function preload() {}

function resetGame() {
  gameOver = false;
  hp = 100;
  opponentHp = 100;

  if (myId && opponentId) {
    isLeft = myId < opponentId;
    player.setPosition(isLeft ? 200 : 600, 500);
    opponent.setPosition(isLeft ? 600 : 200, 500);
  }

  isPunching = false;
  opponentIsPunching = false;
  resultText.setText("");

  socket.emit("update", { x: player.x, y: player.y, hp });
}

socket.on("restartGame", () => {
  startCountdownAndReset();
});

socket.on("yourId", (id) => {
  myId = id;
});

function startCountdownAndReset() {
  const countdownText = game.scene.scenes[0].add.text(400, 300, "", {
    fontSize: "64px",
    color: "#000",
    fontStyle: "bold"
  }).setOrigin(0.5);

  let count = 3;
  countdownText.setText(count);

  const timer = setInterval(() => {
    count--;
    if (count > 0) {
      countdownText.setText(count);
    } else if (count === 0) {
      countdownText.setText("FIGHT!");
    } else {
      countdownText.destroy();
      clearInterval(timer);
      resetGame();
    }
  }, 1000);
}

function create() {
  const ground = this.add.rectangle(400, 580, 800, 40, 0x888888);
  this.physics.add.existing(ground, true);

  player = this.physics.add.sprite(200, 500, null);
  player.body.setCollideWorldBounds(true);
  this.physics.add.collider(player, ground);

  opponent = this.physics.add.sprite(600, 500, null);
  opponent.body.setCollideWorldBounds(true);
  this.physics.add.collider(opponent, ground);

  cursors = this.input.keyboard.createCursorKeys();

  playerGraphics = this.add.graphics();
  opponentGraphics = this.add.graphics();

  hpText = this.add.text(10, 10, "Your HP: 100 | Opponent HP: 100", {
    fontSize: "20px", color: "#000"
  });

  resultText = this.add.text(400, 300, "", {
    fontSize: "48px",
    color: "#ff0000",
    fontStyle: "bold"
  }).setOrigin(0.5);

  waitingText = this.add.text(400, 250, "Waiting for opponent...", {
    fontSize: "32px",
    color: "#888888"
  }).setOrigin(0.5);

  this.input.keyboard.on("keydown-R", () => {
    socket.emit("restart");
  });

  socket.on("opponentAttack", () => {
    opponentIsPunching = true;
    setTimeout(() => {
      opponentIsPunching = false;
    }, 200);
  });

  socket.on("playerUpdate", ({ id, x, y, hp }) => {
    if (!opponentId) opponentId = id;
    hasOpponent = true;
    waitingText.setVisible(false);
    opponent.x = x;
    opponent.y = y;
    opponentHp = hp;
  });

  socket.on("attacked", (data) => {
    hp = data.hp;
  });

  socket.on("gameover", ({ result }) => {
    resultText.setText(`You ${result}!`);
    gameOver = true;
  });
}

function drawStickman(gfx, x, y, color, isAttacking = false, faceLeft = false) {
  gfx.clear();
  gfx.lineStyle(4, color);
  gfx.strokeCircle(x, y - 30, 10);
  gfx.beginPath();
  gfx.moveTo(x, y - 20);
  gfx.lineTo(x, y + 30);
  gfx.strokePath();

  gfx.beginPath();
  gfx.moveTo(x, y - 10);
  gfx.lineTo(x - 20, y + 10);
  if (isAttacking) {
    gfx.moveTo(x, y - 10);
    gfx.lineTo(faceLeft ? x - 40 : x + 40, y);
  } else {
    gfx.moveTo(x, y - 10);
    gfx.lineTo(faceLeft ? x - 20 : x + 20, y + 10);
  }
  gfx.strokePath();

  gfx.beginPath();
  gfx.moveTo(x, y + 30);
  gfx.lineTo(x - 10, y + 60);
  gfx.moveTo(x, y + 30);
  gfx.lineTo(x + 10, y + 60);
  gfx.strokePath();
}

function update() {
  if (!player || gameOver) return;
  if (!hasOpponent) waitingText.setVisible(true);

  let moved = false;
  if (cursors.left.isDown) {
    player.setVelocityX(-160);
    moved = true;
  } else if (cursors.right.isDown) {
    player.setVelocityX(160);
    moved = true;
  } else {
    player.setVelocityX(0);
  }

  if (cursors.up.isDown && player.body.blocked.down) {
    player.setVelocityY(-400);
    moved = true;
  }

  if (Phaser.Input.Keyboard.JustDown(cursors.space) && !isPunching) {
    isPunching = true;
    socket.emit("attack", { x: player.x, y: player.y });
    socket.emit("update", { x: player.x, y: player.y, hp });
    setTimeout(() => { isPunching = false; }, 200);
  }

  if (moved) {
    socket.emit("update", { x: player.x, y: player.y, hp });
  }

  drawStickman(playerGraphics, player.x, player.y, 0x000000, isPunching, isLeft);
  drawStickman(opponentGraphics, opponent.x, opponent.y, 0xff0000, opponentIsPunching, !isLeft);
  hpText.setText(`Your HP: ${hp} | Opponent HP: ${opponentHp}`);

  socket.emit("update", { x: player.x, y: player.y, hp });
}
