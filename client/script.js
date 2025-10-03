import Phaser from 'phaser';
import { io } from 'socket.io-client';

const resolveSocketUrl = () => {
  const envUrl = import.meta.env?.VITE_SOCKET_URL;
  if (envUrl) {
    return envUrl;
  }

  const { protocol, hostname, port } = window.location;

  if (port && port !== '3000') {
    return `${protocol}//${hostname}:3000`;
  }

  return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
};

const socket = io(resolveSocketUrl());

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
const nameInput = document.getElementById('player-name');
const startButton = document.getElementById('start-game');

const hexToNumber = (hex) => parseInt(hex.replace('#', ''), 16);

const MAX_PROJECTILES = 5;
const PROJECTILE_SPEED = 520;
const PROJECTILE_LIFETIME = 2200;
const GUARD_MAX_DURATION = 3000;
const GUARD_COOLDOWN = 1000;

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
let playerName = '';
let opponentName = '';
let hadoukenRemaining = MAX_PROJECTILES;
let opponentHadoukenRemaining = MAX_PROJECTILES;
let lastSentState = {
  x: null,
  y: null,
  hp: null,
  guarding: null,
  color: null,
  name: null,
};

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
let projectileKey;
let playerNameText;
let opponentNameText;
let guardCooldownText;
let guardStartTime = 0;
let guardCooldownUntil = 0;
let wasGuarding = false;
let projectiles = [];

const updateStartButtonState = () => {
  const hasName = nameInput.value.trim().length > 0;
  startButton.disabled = !(hasName && selectedColorButton);
};

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

    if (selectedColorButton) {
      selectedColorButton.classList.remove('selected');
    }
    button.classList.add('selected');
    selectedColorButton = button;

    updateStartButtonState();
  });

  const label = document.createElement('span');
  label.className = 'color-label';
  label.textContent = option.label;

  optionWrapper.appendChild(button);
  optionWrapper.appendChild(label);
  colorOptionsContainer.appendChild(optionWrapper);
});

nameInput.addEventListener('input', () => {
  if (nameInput.value.length > 16) {
    nameInput.value = nameInput.value.slice(0, 16);
  }
  updateStartButtonState();
});

startButton.addEventListener('click', () => {
  if (startButton.disabled) {
    return;
  }

  playerName = nameInput.value.trim();
  if (!playerName) {
    return;
  }

  hasSelectedColor = true;
  colorSelectionOverlay.classList.add('hidden');
  sendPlayerUpdate(true);
});

updateStartButtonState();

function preload() {}

function resetGame() {
  gameOver = false;
  hp = 100;
  opponentHp = 100;
  lastSentState = { x: null, y: null, hp: null, guarding: null, color: null, name: null };
  hadoukenRemaining = MAX_PROJECTILES;
  opponentHadoukenRemaining = MAX_PROJECTILES;
  guardCooldownUntil = 0;
  guardStartTime = 0;
  wasGuarding = false;

  projectiles.forEach((proj) => {
    proj.sprite.destroy();
  });
  projectiles = [];

  if (guardCooldownText) {
    guardCooldownText.setText("");
  }

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

  sendPlayerUpdate(true);
}

function sendPlayerUpdate(force = false) {
  if (!player || !hasSelectedColor) return;

  const payload = {
    x: Math.round(player.x),
    y: Math.round(player.y),
    hp,
    guarding: isGuarding,
    color: playerColor,
    name: playerName,
  };

  const hasChanged =
    force ||
    Object.keys(payload).some((key) => payload[key] !== lastSentState[key]);

  if (!hasChanged) {
    return;
  }

  lastSentState = { ...payload };

  socket.emit("update", payload);
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
  const scene = this;
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

  hpText = this.add.text(10, 10, "あなた HP: 100 | 相手 HP: 100", {
    fontSize: "20px", color: "#000"
  });

  guardCooldownText = this.add.text(400, 40, "", {
    fontSize: "16px",
    color: "#000",
  }).setOrigin(0.5);

  playerNameText = this.add.text(player.x, player.y - 70, "", {
    fontSize: "16px",
    color: "#000",
    fontStyle: "bold",
  }).setOrigin(0.5);

  opponentNameText = this.add.text(opponent.x, opponent.y - 70, "", {
    fontSize: "16px",
    color: "#000",
    fontStyle: "bold",
  }).setOrigin(0.5);

  resultText = this.add.text(400, 300, "", {
    fontSize: "48px",
    color: "#ff0000",
    fontStyle: "bold"
  }).setOrigin(0.5);

  waitingText = this.add.text(400, 250, "対戦相手を待っています...", {
    fontSize: "32px",
    color: "#888888"
  }).setOrigin(0.5);

  projectileKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
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

  socket.on(
    "playerUpdate",
    ({ id, x, y, hp: incomingHp, guarding, color, name, projectilesRemaining }) => {
      if (!id) {
        return;
      }

      if (id === myId) {
        if (typeof incomingHp === "number") {
          hp = incomingHp;
        }
        if (typeof projectilesRemaining === "number") {
          hadoukenRemaining = projectilesRemaining;
        }
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
      opponentHp = typeof incomingHp === "number" ? incomingHp : opponentHp;
      opponentIsGuarding = Boolean(guarding);

      if (typeof color === "number") {
        opponentColor = color;
      }

      if (typeof name === "string") {
        opponentName = name;
      }

      if (typeof projectilesRemaining === "number") {
        opponentHadoukenRemaining = projectilesRemaining;
      }
    }
  );

  socket.on("projectileFired", (data) => {
    if (!data || !data.shooterId) {
      return;
    }
    spawnProjectile(scene, data);
  });

  socket.on("attacked", (data) => {
    hp = data.hp;
  });

  socket.on("gameover", ({ result }) => {
    const message = result === "WIN" ? "勝利！" : "敗北…";
    resultText.setText(message);
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

function spawnProjectile(scene, { shooterId, x, y, direction, color }) {
  const fillColor = typeof color === "number" ? color : 0x000000;
  const rect = scene.add.rectangle(x, y - 15, 36, 6, fillColor);
  rect.setOrigin(0.5);
  rect.setStrokeStyle(2, 0xffffff, 0.8);
  rect.setDepth(5);

  projectiles.push({
    ownerId: shooterId,
    sprite: rect,
    direction: direction === "left" ? -1 : 1,
    speed: PROJECTILE_SPEED,
    createdAt: performance.now(),
  });
}

function updateProjectiles(delta) {
  const deltaSeconds = delta / 1000;
  const now = performance.now();

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    if (!proj?.sprite) {
      projectiles.splice(i, 1);
      continue;
    }

    proj.sprite.x += proj.direction * proj.speed * deltaSeconds;

    if (
      now - proj.createdAt > PROJECTILE_LIFETIME ||
      proj.sprite.x < -50 ||
      proj.sprite.x > config.width + 50
    ) {
      proj.sprite.destroy();
      projectiles.splice(i, 1);
      continue;
    }

    const target = proj.ownerId === myId ? opponent : player;
    if (!target) {
      continue;
    }

    const distance = Phaser.Math.Distance.Between(
      proj.sprite.x,
      proj.sprite.y,
      target.x,
      target.y
    );

    if (distance < 40) {
      proj.sprite.destroy();
      projectiles.splice(i, 1);
    }
  }
}

function update(_time, delta) {
  if (!player || gameOver) return;
  if (!hasOpponent) waitingText.setVisible(true);

  const now = performance.now();

  if (!hasSelectedColor) {
    player.setVelocityX(0);
    player.setVelocityY(0);

    drawStickman(playerGraphics, player.x, player.y, playerColor, {
      attacking: false,
      guarding: false,
      faceLeft: player.x > opponent.x,
    });
    drawStickman(opponentGraphics, opponent.x, opponent.y, opponentColor, {
      attacking: opponentIsPunching,
      guarding: opponentIsGuarding,
      faceLeft: opponent.x > player.x,
    });
    hpText.setText(`あなた HP: ${hp} | 相手 HP: ${opponentHp}`);
    guardCooldownText.setText("");
    playerNameText.setVisible(false);
    opponentNameText.setVisible(false);
    updateProjectiles(delta);
    return;
  }

  playerNameText.setVisible(Boolean(playerName));
  opponentNameText.setVisible(hasOpponent && Boolean(opponentName));

  const guardKeyDown = cursors.shift.isDown;
  const previousGuarding = wasGuarding;
  let nextIsGuarding = false;

  if (guardKeyDown && now >= guardCooldownUntil) {
    if (!previousGuarding) {
      guardStartTime = now;
    }
    if (now - guardStartTime <= GUARD_MAX_DURATION) {
      nextIsGuarding = true;
    } else {
      guardCooldownUntil = now + GUARD_COOLDOWN;
    }
  }

  if (!guardKeyDown && previousGuarding) {
    guardCooldownUntil = Math.max(guardCooldownUntil, now + GUARD_COOLDOWN);
  }

  if (!nextIsGuarding && previousGuarding && guardKeyDown) {
    guardCooldownUntil = Math.max(guardCooldownUntil, now + GUARD_COOLDOWN);
  }

  isGuarding = nextIsGuarding;
  wasGuarding = nextIsGuarding;

  if (isGuarding) {
    const remaining = Math.max(0, GUARD_MAX_DURATION - (now - guardStartTime));
    guardCooldownText.setText(`ガード中 (残り ${(remaining / 1000).toFixed(1)}s)`);
  } else if (now < guardCooldownUntil) {
    const remaining = Math.max(0, guardCooldownUntil - now);
    guardCooldownText.setText(`ガード再使用まで ${(remaining / 1000).toFixed(1)}s`);
  } else {
    guardCooldownText.setText("");
  }

  let moved = false;

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
    sendPlayerUpdate(true);
    setTimeout(() => { isPunching = false; }, 200);
  }

  if (
    Phaser.Input.Keyboard.JustDown(projectileKey) &&
    hadoukenRemaining > 0 &&
    !isGuarding &&
    !isPunching
  ) {
    const direction = player.x > opponent.x ? "left" : "right";
    socket.emit("projectile", { direction });
  }

  const guardStateChanged = isGuarding !== previousGuarding;

  if (
    moved ||
    Phaser.Input.Keyboard.JustDown(cursors.shift) ||
    Phaser.Input.Keyboard.JustUp(cursors.shift) ||
    guardStateChanged
  ) {
    sendPlayerUpdate();
  }

  const playerFacesLeft = player.x > opponent.x;
  const opponentFacesLeft = opponent.x > player.x;

  drawStickman(playerGraphics, player.x, player.y, playerColor, {
    attacking: isPunching,
    guarding: isGuarding,
    faceLeft: playerFacesLeft,
  });
  drawStickman(opponentGraphics, opponent.x, opponent.y, opponentColor, {
    attacking: opponentIsPunching,
    guarding: opponentIsGuarding,
    faceLeft: opponentFacesLeft,
  });

  playerNameText.setPosition(player.x, player.y - 70);
  playerNameText.setText(playerName);

  opponentNameText.setPosition(opponent.x, opponent.y - 70);
  opponentNameText.setText(opponentName || "???");

  const playerLabel = playerName || "あなた";
  const opponentLabel = opponentName || "相手";
  hpText.setText(
    `${playerLabel} HP: ${hp} (波動拳 ${hadoukenRemaining}/${MAX_PROJECTILES}) | ` +
      `${opponentLabel} HP: ${opponentHp} (波動拳 ${opponentHadoukenRemaining}/${MAX_PROJECTILES})`
  );

  updateProjectiles(delta);

  sendPlayerUpdate();
}
