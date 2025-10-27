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

const roomSelectionOverlay = document.getElementById('room-selection');
const colorSelectionOverlay = document.getElementById('color-selection');
const roomListContainer = document.getElementById('room-list');
const roomNameInput = document.getElementById('room-name-input');
const joinRoomButton = document.getElementById('join-room-button');
const refreshRoomsButton = document.getElementById('refresh-rooms');
const roomErrorLabel = document.getElementById('room-error');
const colorOptionsContainer = document.getElementById('color-options');
const nameInput = document.getElementById('player-name');
const startButton = document.getElementById('start-game');
const pingValueLabel = document.getElementById('ping-value');
const currentRoomLabel = document.getElementById('current-room');
const readyButton = document.getElementById('ready-button');
const readyStatusLabel = document.getElementById('ready-status');

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
const ROOM_CAPACITY = SPAWN_POSITIONS.length;

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
let controlsLocked = false;
let countdownTimerId = null;
let countdownTextObject = null;
let currentRoomId = null;
let isReady = false;
let knownReadyIds = new Set();
let pendingRoomJoin = false;

const updateStartButtonState = () => {
  const hasName = nameInput.value.trim().length > 0;
  const canStart = Boolean(selectedColorButton) && hasName && Boolean(currentRoomId);
  startButton.disabled = !canStart;
};

const updateReadyButtonState = () => {
  if (!readyButton) {
    return;
  }

  const canReady = hasSelectedColor && Boolean(currentRoomId);
  readyButton.disabled = !canReady;
  readyButton.classList.toggle('is-ready', isReady && canReady);
  readyButton.textContent = isReady && canReady ? '準備解除' : '準備する';
};

const generateRoomName = () => `room-${Math.floor(Math.random() * 9000 + 1000)}`;

if (roomNameInput && !roomNameInput.value) {
  roomNameInput.value = generateRoomName();
}

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
  updateReadyButtonState();
  sendPlayerUpdate(true);
});

updateStartButtonState();
updateReadyButtonState();

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

const updateRoomLabel = () => {
  if (!currentRoomLabel) {
    return;
  }

  currentRoomLabel.textContent = currentRoomId ?? '未参加';
};

const updateReadyStatusText = (readyCount = 0, playerCount = 0) => {
  if (!readyStatusLabel) {
    return;
  }

  const normalizedPlayers = Math.min(Math.max(playerCount, 0), ROOM_CAPACITY);
  const normalizedReady = Math.min(Math.max(readyCount, 0), ROOM_CAPACITY);
  readyStatusLabel.textContent = `参加者 ${normalizedPlayers}/${ROOM_CAPACITY} | 準備 ${normalizedReady}/${ROOM_CAPACITY}`;
};

const setRoomError = (message = '') => {
  if (roomErrorLabel) {
    roomErrorLabel.textContent = message;
  }
};

const setJoinButtonLoading = (loading) => {
  if (!joinRoomButton) {
    return;
  }

  pendingRoomJoin = loading;
  joinRoomButton.disabled = loading;
  joinRoomButton.textContent = loading ? '接続中...' : 'このルームで遊ぶ';
};

const joinSelectedRoom = (roomId) => {
  const trimmed = typeof roomId === 'string' ? roomId.trim() : '';
  if (!trimmed) {
    setRoomError('ルーム名を入力してください。');
    return;
  }

  if (!socket.connected) {
    setRoomError('サーバーに接続されていません。');
    return;
  }

  setRoomError('');
  setJoinButtonLoading(true);
  socket.emit('joinRoom', { roomId: trimmed });
};

const renderRoomList = (rooms = []) => {
  if (!roomListContainer) {
    return;
  }

  roomListContainer.innerHTML = '';

  if (!Array.isArray(rooms) || rooms.length === 0) {
    const placeholder = document.createElement('p');
    placeholder.className = 'room-placeholder';
    placeholder.textContent = '公開されているルームはありません。';
    roomListContainer.appendChild(placeholder);
    return;
  }

  rooms.forEach(({ id, playerCount, readyCount, capacity }) => {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'room-item';

    const maxPlayers = typeof capacity === 'number' && capacity > 0 ? capacity : ROOM_CAPACITY;
    const playersInRoom = Math.min(Math.max(typeof playerCount === 'number' ? playerCount : 0, 0), maxPlayers);
    const readyInRoom = Math.min(Math.max(typeof readyCount === 'number' ? readyCount : 0, 0), maxPlayers);

    if (playersInRoom >= maxPlayers || id === currentRoomId) {
      entry.disabled = true;
    }

    if (playersInRoom >= maxPlayers) {
      entry.classList.add('full');
    }

    const meta = document.createElement('div');
    meta.className = 'room-meta';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'room-name';
    nameSpan.textContent = id;

    const statsSpan = document.createElement('span');
    statsSpan.className = 'room-stats';
    statsSpan.textContent = `参加 ${playersInRoom}/${maxPlayers} | 準備 ${readyInRoom}`;

    meta.appendChild(nameSpan);
    meta.appendChild(statsSpan);
    entry.appendChild(meta);

    const actionLabel = document.createElement('span');
    actionLabel.className = 'room-stats';
    actionLabel.textContent = id === currentRoomId
      ? '参加中'
      : playersInRoom >= maxPlayers
        ? '満員'
        : '参加';
    entry.appendChild(actionLabel);

    if (!entry.disabled) {
      entry.addEventListener('click', () => {
        if (pendingRoomJoin) {
          return;
        }

        if (roomNameInput) {
          roomNameInput.value = id;
        }
        joinSelectedRoom(id);
      });
    }

    roomListContainer.appendChild(entry);
  });
};

if (joinRoomButton) {
  joinRoomButton.addEventListener('click', () => {
    if (pendingRoomJoin) {
      return;
    }

    joinSelectedRoom(roomNameInput?.value ?? '');
  });
}

if (roomNameInput) {
  roomNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (pendingRoomJoin) {
        return;
      }

      joinSelectedRoom(roomNameInput.value);
    }
  });

  roomNameInput.addEventListener('input', () => {
    setRoomError('');
  });
}

if (refreshRoomsButton) {
  refreshRoomsButton.addEventListener('click', () => {
    socket.emit('requestRoomList');
  });
}

updateRoomLabel();
updateReadyStatusText();

if (readyButton) {
  readyButton.addEventListener('click', () => {
    if (readyButton.disabled) {
      return;
    }

    const nextReadyState = !isReady;
    isReady = nextReadyState;
    updateReadyButtonState();
    socket.emit('setReadyState', { ready: nextReadyState });
  });
}

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
  socket.emit('requestRoomList');
});

socket.on("disconnect", () => {
  updatePingLabel(null);
  setJoinButtonLoading(false);
  currentRoomId = null;
  knownReadyIds = new Set();
  isReady = false;
  updateRoomLabel();
  updateReadyStatusText();
  updateReadyButtonState();
  if (roomSelectionOverlay) {
    roomSelectionOverlay.classList.remove('hidden');
  }
  setRoomError('サーバーとの接続が切断されました。');
});

socket.on("latencyPong", ({ clientTime } = {}) => {
  if (typeof clientTime !== "number") {
    return;
  }

  latestPing = Math.max(0, performance.now() - clientTime);
  updatePingLabel(latestPing);
});

socket.on('roomList', ({ rooms } = {}) => {
  renderRoomList(Array.isArray(rooms) ? rooms : []);
});

socket.on('roomJoinError', ({ message } = {}) => {
  setJoinButtonLoading(false);
  const errorMessage = typeof message === 'string' && message
    ? message
    : 'ルームに参加できませんでした。';
  setRoomError(errorMessage);
});

socket.on('roomJoined', ({ roomId } = {}) => {
  setJoinButtonLoading(false);
  setRoomError('');
  currentRoomId = typeof roomId === 'string' ? roomId : null;
  updateRoomLabel();
  knownReadyIds = new Set();
  isReady = false;
  updateReadyButtonState();
  updateReadyStatusText(0, currentRoomId ? 1 : 0);

  if (roomNameInput && currentRoomId) {
    roomNameInput.value = currentRoomId;
  }

  if (roomSelectionOverlay) {
    if (currentRoomId) {
      roomSelectionOverlay.classList.add('hidden');
    } else {
      roomSelectionOverlay.classList.remove('hidden');
    }
  }

  if (colorSelectionOverlay && !hasSelectedColor) {
    colorSelectionOverlay.classList.remove('hidden');
  }

  if (waitingText) {
    waitingText.setText('対戦相手を待っています...');
    waitingText.setVisible(true);
  }

  hasOpponent = false;
  opponentId = null;
  opponentName = '';
  opponentHp = 100;
  opponentHadoukenRemaining = MAX_PROJECTILES;
});

socket.on('readyStates', ({ readyPlayerIds, totalPlayers } = {}) => {
  const readyArray = Array.isArray(readyPlayerIds) ? readyPlayerIds : [];
  knownReadyIds = new Set(readyArray);
  const playerCount = typeof totalPlayers === 'number' ? totalPlayers : 0;
  updateReadyStatusText(readyArray.length, playerCount);

  if (myId) {
    const isSelfReady = knownReadyIds.has(myId);
    if (isReady !== isSelfReady) {
      isReady = isSelfReady;
    }
  }

  updateReadyButtonState();
});

socket.on('roundCountdownCancelled', () => {
  cancelCountdown();
});

socket.on('playerLeft', ({ id } = {}) => {
  if (typeof id === 'string') {
    knownReadyIds.delete(id);
  }

  if (id && id === opponentId) {
    cancelCountdown();
    hasOpponent = false;
    opponentId = null;
    opponentName = '';
    opponentHp = 100;
    opponentHadoukenRemaining = MAX_PROJECTILES;
    if (waitingText) {
      waitingText.setText('対戦相手を待っています...');
      waitingText.setVisible(true);
    }
  }

  updateReadyButtonState();
});

function preload() {}

function cancelCountdown() {
  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }

  if (countdownTextObject) {
    countdownTextObject.destroy();
    countdownTextObject = null;
  }

  isRoundStarting = false;
  controlsLocked = false;
}

function resetGame() {
  cancelCountdown();

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
  if (countdownTimerId !== null) {
    clearInterval(countdownTimerId);
    countdownTimerId = null;
  }

  if (countdownTextObject) {
    countdownTextObject.destroy();
    countdownTextObject = null;
  }

  countdownTextObject = scene
    .add.text(400, 300, "", {
      fontSize: "64px",
      color: "#000",
      fontStyle: "bold",
    })
    .setOrigin(0.5);

  let count = 3;
  countdownTextObject.setText(count);

  countdownTimerId = window.setInterval(() => {
    count -= 1;

    if (!countdownTextObject) {
      if (countdownTimerId !== null) {
        clearInterval(countdownTimerId);
        countdownTimerId = null;
      }
      return;
    }

    if (count > 0) {
      countdownTextObject.setText(count);
      return;
    }

    if (count === 0) {
      countdownTextObject.setText('FIGHT!');
      return;
    }

    countdownTextObject.destroy();
    countdownTextObject = null;
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
