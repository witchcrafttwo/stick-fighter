import Phaser from 'phaser';
import { io } from 'socket.io-client';

const socket = io("http://192.168.148.180:3000", );

const COLORS = [
  { hex: '#000000', label: 'ブラック' },
  { hex: '#ff4d4d', label: 'レッド' },
  { hex: '#3498db', label: 'ブルー' },
  { hex: '#2ecc71', label: 'グリーン' },
  { hex: '#f1c40f', label: 'イエロー' },
  { hex: '#9b59b6', label: 'パープル' },
];

const colorSelectionOverlay = document.getElementById('color-selection');
const colorOptionsContainer = document.getElementById('color-options');

const hexToNumber = (hex) => parseInt(hex.replace('#', ''), 16);

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

let selectedColorButton = null;
let playerColorHex = COLORS[0].hex;
let playerColor = hexToNumber(playerColorHex);
let opponentColor = hexToNumber('#ff0000');
let hasSelectedColor = false;

let player, opponent;
let cursors;
let playerGraphics, opponentGraphics;
let hp = 100;
let opponentHp = 100;
let hpText;
let isPunching = false;
let isGuarding = false;
let opponentIsPunching = false;
let opponentIsGuarding = false;
let resultText;
let waitingText;
let hasOpponent = false;
let gameOver = false;
let myId;
let opponentId;
let isLeft = true;

COLORS.forEach((option) => {
  const optionWrapper = document.createElement('div');
  optionWrapper.className = 'color-option';

  const button = document.createElement('button');
  button.className = 'color-button';
  button.style.setProperty('--color', option.hex);
  button.setAttribute('aria-label', option.label);
  button.title = option.label;
  button.addEventListener('click', () => {
    playerColorHex = option.hex;
    playerColor = hexToNumber(option.hex);
    hasSelectedColor = true;

    if (selectedColorButton) {
      selectedColorButton.classList.remove('selected');
    }
    button.classList.add('selected');
    selectedColorButton = button;

    colorSelectionOverlay.classList.add('hidden');
    sendPlayerUpdate();
  });

  const label = document.createElement('span');
  label.className = 'color-label';
  label.textContent = option.label;

  optionWrapper.appendChild(button);
  optionWrapper.appendChild(label);
  colorOptionsContainer.appendChild(optionWrapper);
});

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
  isGuarding = false;
  opponentIsPunching = false;
  opponentIsGuarding = false;
  resultText.setText("");

  sendPlayerUpdate();
}

function sendPlayerUpdate() {
  if (!player || !hasSelectedColor) return;

  socket.emit("update", {
    x: player.x,
    y: player.y,
    hp,
    guarding: isGuarding,
    color: playerColor,
  });
}

socket.on("restartGame", () => {
  startCountdownAndReset();
});

socket.on("yourId", (id) => {
  myId = id;

  if (opponentId) {
    isLeft = myId < opponentId;
  }
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

  socket.on("opponentAttack", (payload) => {
    const attackerId =
      payload && typeof payload === "object"
        ? payload.attackerId
        : opponentId;

    if (!opponentId && attackerId) {
      opponentId = attackerId;
      hasOpponent = true;
      waitingText.setVisible(false);

      if (myId) {
        isLeft = myId < opponentId;
      }
    }

    if (attackerId !== opponentId) {
      return;
    }

    opponentIsPunching = true;
    setTimeout(() => {
      opponentIsPunching = false;
    }, 200);
  });

  socket.on("playerUpdate", ({ id, x, y, hp, guarding, color }) => {
    if (!id || id === myId) {
      return;
    }

    if (!opponentId || opponentId !== id) {
      opponentId = id;
      hasOpponent = true;
      waitingText.setVisible(false);

      if (myId) {
        isLeft = myId < opponentId;
      }
    }

    if (typeof x === "number") {
      opponent.x = x;
    }

    if (typeof y === "number") {
      opponent.y = y;
    }
    opponentHp = typeof hp === "number" ? hp : opponentHp;
    opponentIsGuarding = Boolean(guarding);

    if (typeof color === "number") {
      opponentColor = color;
    }
  });

  socket.on("attacked", (data) => {
    hp = data.hp;
  });

  socket.on("gameover", ({ result }) => {
    resultText.setText(`You ${result}!`);
    gameOver = true;
  });

  sendPlayerUpdate();
}

function drawStickman(
  gfx,
  x,
  y,
  color,
  { attacking = false, guarding = false, faceLeft = false } = {}
) {
  gfx.clear();
  gfx.lineStyle(4, color);
  gfx.strokeCircle(x, y - 30, 10);
  gfx.beginPath();
  gfx.moveTo(x, y - 20);
  gfx.lineTo(x, y + 30);
  gfx.strokePath();

  gfx.beginPath();
  if (guarding) {
    gfx.moveTo(x, y - 5);
    gfx.lineTo(x - 15, y + 10);
    gfx.moveTo(x, y - 5);
    gfx.lineTo(x + 15, y + 10);
  } else {
    gfx.moveTo(x, y - 10);
    gfx.lineTo(x - 20, y + 10);
    if (attacking) {
      gfx.moveTo(x, y - 10);
      gfx.lineTo(faceLeft ? x - 40 : x + 40, y);
    } else {
      gfx.moveTo(x, y - 10);
      gfx.lineTo(faceLeft ? x - 20 : x + 20, y + 10);
    }
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

  if (!hasSelectedColor) {
    player.setVelocityX(0);
    player.setVelocityY(0);

    drawStickman(playerGraphics, player.x, player.y, playerColor, {
      attacking: false,
      guarding: false,
      faceLeft: isLeft,
    });
    drawStickman(opponentGraphics, opponent.x, opponent.y, opponentColor, {
      attacking: opponentIsPunching,
      guarding: opponentIsGuarding,
      faceLeft: !isLeft,
    });
    hpText.setText(`Your HP: ${hp} | Opponent HP: ${opponentHp}`);
    return;
  }

  let moved = false;
  isGuarding = cursors.shift.isDown;

  if (isGuarding) {
    player.setVelocityX(0);
  } else if (cursors.left.isDown) {
    player.setVelocityX(-160);
    moved = true;
  } else if (cursors.right.isDown) {
    player.setVelocityX(160);
    moved = true;
  } else {
    player.setVelocityX(0);
  }

  if (!isGuarding && cursors.up.isDown && player.body.blocked.down) {
    player.setVelocityY(-400);
    moved = true;
  }

  if (
    Phaser.Input.Keyboard.JustDown(cursors.space) &&
    !isPunching &&
    !isGuarding
  ) {
    isPunching = true;
    socket.emit("attack", { x: player.x, y: player.y });
    sendPlayerUpdate();
    setTimeout(() => { isPunching = false; }, 200);
  }

  if (
    moved ||
    Phaser.Input.Keyboard.JustDown(cursors.shift) ||
    Phaser.Input.Keyboard.JustUp(cursors.shift)
  ) {
    sendPlayerUpdate();
  }

  drawStickman(playerGraphics, player.x, player.y, playerColor, {
    attacking: isPunching,
    guarding: isGuarding,
    faceLeft: isLeft,
  });
  drawStickman(opponentGraphics, opponent.x, opponent.y, opponentColor, {
    attacking: opponentIsPunching,
    guarding: opponentIsGuarding,
    faceLeft: !isLeft,
  });
  hpText.setText(`Your HP: ${hp} | Opponent HP: ${opponentHp}`);

  sendPlayerUpdate();
}
