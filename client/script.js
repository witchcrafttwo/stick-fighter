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
const pingValueLabel = document.getElementById('ping-value');

const hexToNumber = (hex) => parseInt(hex.replace('#', ''), 16);

const MAX_PROJECTILES = 5;
const PROJECTILE_SPEED = 520;
const PROJECTILE_LIFETIME = 2200;
const GUARD_MAX_DURATION = 3000;
const GUARD_COOLDOWN = 1000;
const PROJECTILE_VERTICAL_TOLERANCE = 60;
const SPAWN_POSITIONS = [
  { x: 200, y: 500 },
  { x: 600, y: 500 },
];
const PING_INTERVAL_MS = 4000;

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
let spawnIndex = null;
let opponentSpawnIndex = null;
const DEFAULT_DISPLAY_LAG_MS = 100;
let displayLagMs = DEFAULT_DISPLAY_LAG_MS;
const laggedTimeouts = new Set();
let latestPing = null;
let pingIntervalId = null;
let isRoundStarting = false;
let restartRequestPending = false;
let controlsLocked = false;
let countdownTimerId = null;
let restartUnlockTimeoutId = null;

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

const updatePingLabel = (value) => {
  if (!pingValueLabel) {
    return;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    pingValueLabel.textContent = `${Math.round(value)}`;
  } else {
    pingValueLabel.textContent = '--';
  }
};

const scheduleWithLag = (callback) => {
  if (displayLagMs <= 0) {
    callback();
    return;
  }

  const timeoutId = window.setTimeout(() => {
    laggedTimeouts.delete(timeoutId);
    callback();
  }, displayLagMs);

  laggedTimeouts.add(timeoutId);
};

const clearLaggedTimeouts = () => {
  laggedTimeouts.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  laggedTimeouts.clear();
};

const positionPlayersForSpawn = () => {
  if (!player || !opponent) {
    return;
  }

  const myIndex = typeof spawnIndex === 'number' ? spawnIndex : 0;
  const opponentIndex =
    typeof opponentSpawnIndex === 'number'
      ? opponentSpawnIndex
      : myIndex === 0
        ? 1
        : 0;

  const mySpawn = SPAWN_POSITIONS[myIndex] ?? SPAWN_POSITIONS[0];
  const opponentSpawn = SPAWN_POSITIONS[opponentIndex] ?? SPAWN_POSITIONS[1] ?? SPAWN_POSITIONS[0];

  player.setPosition(mySpawn.x, mySpawn.y);
  opponent.setPosition(opponentSpawn.x, opponentSpawn.y);

  if (player.body) {
    player.body.setVelocity(0, 0);
  }
  if (opponent.body) {
    opponent.body.setVelocity(0, 0);
  }

  isLeft = myIndex === 0;
};

const ensurePingInterval = () => {
  if (pingIntervalId !== null) {
    return;
  }

  pingIntervalId = window.setInterval(() => {
    if (!socket.connected) {
      return;
    }

    socket.emit('latencyTest', { clientTime: performance.now() });
  }, PING_INTERVAL_MS);
};

ensurePingInterval();

socket.on("connect", () => {
  updatePingLabel(latestPing);
  socket.emit("latencyTest", { clientTime: performance.now() });
});

socket.on("disconnect", () => {
  updatePingLabel(null);
});

socket.on("latencyPong", ({ clientTime } = {}) => {
  if (typeof clientTime !== "number") {
    return;
  }

  latestPing = Math.max(0, performance.now() - clientTime);
  updatePingLabel(latestPing);
});

function preload() {}

function resetGame() {
  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }

  if (restartUnlockTimeoutId !== null) {
    clearTimeout(restartUnlockTimeoutId);
    restartUnlockTimeoutId = null;
  }

  gameOver = false;
  hp = 100;
  opponentHp = 100;
  lastSentState = { x: null, y: null, hp: null, guarding: null, color: null, name: null };
  hadoukenRemaining = MAX_PROJECTILES;
  opponentHadoukenRemaining = MAX_PROJECTILES;
  guardCooldownUntil = 0;
  guardStartTime = 0;
  wasGuarding = false;
  clearLaggedTimeouts();

  projectiles.forEach((proj) => {
    proj.sprite.destroy();
  });
  projectiles = [];

  if (guardCooldownText) {
    guardCooldownText.setText("");
  }

  positionPlayersForSpawn();

  isPunching = false;
  isGuarding = false;
  opponentIsPunching = false;
  opponentIsGuarding = false;
  resultText.setText("");

  sendPlayerUpdate(true);

  restartRequestPending = false;
  isRoundStarting = false;
  controlsLocked = false;
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
  if (player) {
    positionPlayersForSpawn();
    sendPlayerUpdate(true);
  }
});

socket.on("spawnInfo", ({ id, spawnIndex: incomingSpawn }) => {
  if (typeof incomingSpawn !== "number") {
    return;
  }

  if (id === myId) {
    spawnIndex = incomingSpawn;
    if (player) {
      positionPlayersForSpawn();
      sendPlayerUpdate(true);
    }
    return;
  }

  if (!opponentId || opponentId !== id) {
    opponentId = id;
    hasOpponent = true;
    if (waitingText) {
      waitingText.setVisible(false);
    }
  }

  opponentSpawnIndex = incomingSpawn;
  positionPlayersForSpawn();
});

function startCountdownAndReset() {
  if (isRoundStarting) {
    return;
  }

  const scene = game.scene.scenes[0];
  if (!scene) {
    return;
  }

  isRoundStarting = true;
  controlsLocked = true;
  restartRequestPending = false;

  if (restartUnlockTimeoutId !== null) {
    clearTimeout(restartUnlockTimeoutId);
    restartUnlockTimeoutId = null;
  }

  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }

  const countdownText = scene
    .add.text(400, 300, "", {
      fontSize: "64px",
      color: "#000",
      fontStyle: "bold",
    })
    .setOrigin(0.5);

  let count = 3;
  countdownText.setText(count);

  countdownTimerId = window.setInterval(() => {
    count -= 1;

    if (count > 0) {
      countdownText.setText(count);
      return;
    }

    if (count === 0) {
      countdownText.setText("FIGHT!");
      return;
    }

    countdownText.destroy();
    if (countdownTimerId !== null) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
    resetGame();
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
    if (restartRequestPending || isRoundStarting) {
      return;
    }

    restartRequestPending = true;
    controlsLocked = true;
    if (player) {
      player.setVelocityX(0);
      player.setVelocityY(0);
    }

    if (restartUnlockTimeoutId !== null) {
      clearTimeout(restartUnlockTimeoutId);
    }

    restartUnlockTimeoutId = window.setTimeout(() => {
      restartUnlockTimeoutId = null;
      if (isRoundStarting) {
        return;
      }

      controlsLocked = false;
      restartRequestPending = false;
    }, 1500);

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
      if (waitingText) {
        waitingText.setVisible(false);
      }
    }

    if (attackerId !== opponentId) {
      return;
    }

    const triggerPunch = () => {
      opponentIsPunching = true;
      window.setTimeout(() => {
        opponentIsPunching = false;
      }, 200);
    };

    if (displayLagMs > 0) {
      scheduleWithLag(triggerPunch);
    } else {
      triggerPunch();
    }
  });

  socket.on("playerUpdate", (data = {}) => {
    const {
      id,
      x,
      y,
      hp: incomingHp,
      guarding,
      color,
      name,
      projectilesRemaining,
      spawnIndex: incomingSpawn,
    } = data;

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
      if (typeof incomingSpawn === "number" && spawnIndex !== incomingSpawn) {
        spawnIndex = incomingSpawn;
        positionPlayersForSpawn();
      }
      return;
    }

    if (!opponentId || opponentId !== id) {
      opponentId = id;
      hasOpponent = true;
      if (waitingText) {
        waitingText.setVisible(false);
      }
    }

    const stateForLag = {
      x,
      y,
      incomingHp,
      guarding,
      color,
      name,
      projectilesRemaining,
      incomingSpawn,
    };

    const applyOpponentState = (state) => {
      if (!opponent) {
        return;
      }

      const {
        x: nextX,
        y: nextY,
        incomingHp: nextHp,
        guarding: nextGuarding,
        color: nextColor,
        name: nextName,
        projectilesRemaining: nextProjectiles,
        incomingSpawn: nextSpawn,
      } = state;

      if (typeof nextSpawn === "number" && opponentSpawnIndex !== nextSpawn) {
        opponentSpawnIndex = nextSpawn;
        positionPlayersForSpawn();
      }

      if (typeof nextX === "number") {
        opponent.x = nextX;
      }

      if (typeof nextY === "number") {
        opponent.y = nextY;
      }

      opponentHp = typeof nextHp === "number" ? nextHp : opponentHp;
      opponentIsGuarding = Boolean(nextGuarding);

      if (typeof nextColor === "number") {
        opponentColor = nextColor;
      }

      if (typeof nextName === "string") {
        opponentName = nextName;
      }

      if (typeof nextProjectiles === "number") {
        opponentHadoukenRemaining = nextProjectiles;
      }
    };

    if (displayLagMs > 0) {
      scheduleWithLag(() => applyOpponentState(stateForLag));
    } else {
      applyOpponentState(stateForLag);
    }
  });

  socket.on("projectileFired", (data) => {
    if (!data || !data.shooterId) {
      return;
    }

    const spawnAction = () => spawnProjectile(scene, data);

    if (data.shooterId === myId || displayLagMs <= 0) {
      spawnAction();
      return;
    }

    scheduleWithLag(spawnAction);
  });

  socket.on("attacked", (data) => {
    hp = data.hp;
  });

  socket.on("gameover", ({ result }) => {
    const message = result === "WIN" ? "勝利！" : "敗北…";
    resultText.setText(message);
    gameOver = true;
  });

  positionPlayersForSpawn();
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
    const verticalDiff = Math.abs(proj.sprite.y - target.y);

    if (distance < 40 && verticalDiff <= PROJECTILE_VERTICAL_TOLERANCE) {
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

  const controlsDisabled = controlsLocked || !hasSelectedColor;

  const guardKeyDown = !controlsDisabled && cursors.shift.isDown;
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

  if (controlsDisabled) {
    player.setVelocityX(0);
  } else if (isGuarding) {
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

  if (!controlsDisabled && !isGuarding && cursors.up.isDown && player.body.blocked.down) {
    player.setVelocityY(-400);
    moved = true;
  }

  if (
    !controlsDisabled &&
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
    !controlsDisabled &&
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
    (!controlsDisabled &&
      (Phaser.Input.Keyboard.JustDown(cursors.shift) ||
        Phaser.Input.Keyboard.JustUp(cursors.shift))) ||
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
