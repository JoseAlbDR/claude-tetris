'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // 1 I - cyan
  '#ffd54f', // 2 O - yellow
  '#ba68c8', // 3 T - purple
  '#81c784', // 4 S - green
  '#e57373', // 5 Z - red
  '#64b5f6', // 6 J - pale blue
  '#ffb74d', // 7 L - orange
  '#b0bec5', // 8 N (nut) - steel gray
  '#f06292', // 9 + (plus pentomino) - pink
  '#4db6ac', // 10 U pentomino - teal
  '#9575cd', // 11 Y pentomino - deep purple
  '#fff59d', // 12 single (Tetris reward) - pale yellow
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // 1 I
  [[2,2],[2,2]],                               // 2 O
  [[0,3,0],[3,3,3],[0,0,0]],                  // 3 T
  [[0,4,4],[4,4,0],[0,0,0]],                  // 4 S
  [[5,5,0],[0,5,5],[0,0,0]],                  // 5 Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // 6 J
  [[0,0,7],[7,7,7],[0,0,0]],                  // 7 L
  [[8,8,8],[8,0,8],[8,8,8]],                  // 8 N (nut) - anillo con hueco central
  [[0,9,0],[9,9,9],[0,9,0]],                  // 9 + pentomino (5 celdas)
  [[10,0,10],[10,10,10]],                      // 10 U pentomino (5 celdas)
  [[0,11],[11,11],[0,11],[0,11]],             // 11 Y pentomino (5 celdas)
  [[12]],                                      // 12 single (recompensa tras Tetris)
];

// Piezas estándar con peso alto; pentominós raros y solo a partir de cierto progreso.
const STANDARD_TYPES = [1, 2, 3, 4, 5, 6, 7, 8];
const PENTOMINO_TYPES = [9, 10, 11];
const PENTOMINO_MIN_LEVEL = 2;
const PENTOMINO_WEIGHT = 0.03; // 3% cada una una vez desbloqueadas

const POWERUPS = ['bomb', 'lightning', 'paint', 'gravity', 'freeze'];
const POWERUP_COLOR = {
  bomb: '#ff5252',
  lightning: '#fff176',
  paint: '#ce93d8',
  gravity: '#90a4ae',
  freeze: '#80d8ff',
};
const POWERUP_LINES_MIN = 5;
const POWERUP_LINES_MAX = 8;

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORE = 400;
const PERFECT_CLEAR_SCORE = 2000;
const B2B_MULTIPLIER = 1.5;
const COMBO_CAP = 5;
const LOCK_DELAY = 500;
const REVERSE_ROTATION_LEVEL = 8;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeSwitch = document.getElementById('theme-switch');
const modeSelect = document.getElementById('mode-select');
const challengeList = document.getElementById('challenge-list');
const energyFill = document.getElementById('energy-fill');
const skillPrompt = document.getElementById('skill-prompt');
const toastLayer = document.getElementById('toast-layer');
const objectiveHud = document.getElementById('objective-hud');

let board, current, next, nextQueue, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gridLineColor;
let lastActionWasRotate = false;
let lockDelayAccum = 0;
let isLockDelayActive = false;
let forcedNext = [];
let holdPiece = null;
let holdUsed = false;
let comboCount = 0;
let lastClearWasTetris = false;
let linesUntilPowerup = 0;
let freezeUntil = 0;
let slowUntil = 0;
let energy = 0;
let skillPromptOpen = false;
let lastSnapshot = null;
let challenge = null; // { type, target, timeLeft, ... } o null en maratón
let audioCtx = null;

const THEME_KEY = 'tetris-theme';

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  themeSwitch.checked = theme === 'light';
  gridLineColor = getComputedStyle(document.body).getPropertyValue('--grid-line').trim();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeSwitch.addEventListener('change', () => {
  const theme = themeSwitch.checked ? 'light' : 'dark';
  applyTheme(theme);
  localStorage.setItem(THEME_KEY, theme);
});

initTheme();

/** Tablero prefijado para el objetivo de desafío "bloques fijos pre-colocados". */
const PRESET_BOARD_ROWS = [
  [6,6,0,0,0,0,0,0,7,7],
  [6,0,0,0,0,0,0,0,0,7],
];

function createBoard(preset) {
  const b = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  if (preset) {
    const startRow = ROWS - preset.length;
    preset.forEach((row, i) => { b[startRow + i] = [...row]; });
  }
  return b;
}

function pieceDescriptor(type, power) {
  const shape = PIECES[type].map(row => [...row]);
  return {
    type,
    power: power || null,
    shape,
    x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
    y: 0,
  };
}

function weightedRandomPiece() {
  const pool = STANDARD_TYPES.map(t => ({ type: t, weight: 1 }));
  if (level >= PENTOMINO_MIN_LEVEL) {
    PENTOMINO_TYPES.forEach(t => pool.push({ type: t, weight: PENTOMINO_WEIGHT }));
  }
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;
  for (const p of pool) {
    roll -= p.weight;
    if (roll <= 0) return pieceDescriptor(p.type);
  }
  return pieceDescriptor(STANDARD_TYPES[0]);
}

/** Sirve la siguiente pieza: primero cola forzada (recompensas/power-ups), si no, pool ponderado. */
function drawNextPiece() {
  if (forcedNext.length) return forcedNext.shift();
  return weightedRandomPiece();
}

function resetPowerupCounter() {
  linesUntilPowerup = POWERUP_LINES_MIN + Math.floor(Math.random() * (POWERUP_LINES_MAX - POWERUP_LINES_MIN + 1));
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function rotateCCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

function tryRotate() {
  const useReverse = level >= REVERSE_ROTATION_LEVEL;
  const rotated = useReverse ? rotateCCW(current.shape) : rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastActionWasRotate = true;
      resetLockDelayIfGrounded();
      return;
    }
  }
}

function resetLockDelayIfGrounded() {
  if (isLockDelayActive) lockDelayAccum = 0;
}

function snapshotState() {
  lastSnapshot = {
    board: board.map(row => [...row]),
    score,
    lines,
    level,
  };
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

/** Regla de las 3 esquinas para detectar T-spin (solo pieza T, tipo 3). */
function detectTSpin() {
  if (current.type !== 3 || !lastActionWasRotate) return false;
  const cx = current.x + 1;
  const cy = current.y + 1;
  const corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]];
  let occupied = 0;
  for (const [x, y] of corners) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS || board[y][x]) occupied++;
  }
  return occupied >= 3;
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    comboCount++;
    const comboMultiplier = Math.min(comboCount, COMBO_CAP);
    let gained = (LINE_SCORES[cleared] || 0) * level * comboMultiplier;
    const isTetris = cleared === 4;
    if (isTetris && lastClearWasTetris) {
      gained = Math.round(gained * B2B_MULTIPLIER);
      showToast('B2B TETRIS!');
      beep(880, 0.25);
    }
    lastClearWasTetris = isTetris;
    if (comboCount > 1) {
      showToast(`COMBO x${comboCount}`);
      beep(520 + comboCount * 40, 0.15);
    }
    score += gained;
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    energy = Math.min(100, energy + 10 * cleared);
    if (board.every(row => row.every(v => v === 0))) {
      score += PERFECT_CLEAR_SCORE;
      showToast('PERFECT CLEAR!');
      beep(1200, 0.35);
    }
    if (isTetris) forcedNext.push(pieceDescriptor(12));
    linesUntilPowerup -= cleared;
    if (linesUntilPowerup <= 0) {
      resetPowerupCounter();
      const power = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
      forcedNext.push(pieceDescriptor(3, power));
    }
    updateHUD();
  } else {
    comboCount = 0;
  }
  return cleared;
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    lastActionWasRotate = false;
    updateHUD();
  } else {
    lockPiece();
  }
}

/** Aplica el efecto de una pieza power-up sobre el tablero; no deja bloques propios. */
function applyPowerup() {
  const landX = current.x + 1;
  const landY = current.y + 1;
  switch (current.power) {
    case 'bomb':
      for (let r = landY - 1; r <= landY + 1; r++)
        for (let c = landX - 1; c <= landX + 1; c++)
          if (r >= 0 && r < ROWS && c >= 0 && c < COLS) board[r][c] = 0;
      showToast('¡BOMBA!');
      break;
    case 'lightning':
      if (landY >= 0 && landY < ROWS) board[landY] = new Array(COLS).fill(0);
      for (let r = 0; r < ROWS; r++) if (landX >= 0 && landX < COLS) board[r][landX] = 0;
      showToast('¡RAYO!');
      break;
    case 'paint': {
      const targetColor = landY >= 0 && landY < ROWS ? board[landY][landX] : 0;
      if (targetColor) {
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++)
            if (board[r][c] === targetColor) board[r][c] = 0;
      }
      showToast('¡TINTE!');
      break;
    }
    case 'gravity':
      for (let c = 0; c < COLS; c++) {
        const colVals = [];
        for (let r = 0; r < ROWS; r++) if (board[r][c]) colVals.push(board[r][c]);
        for (let r = 0; r < ROWS; r++) {
          const fromBottom = ROWS - 1 - r;
          const idx = colVals.length - 1 - fromBottom;
          board[r][c] = idx >= 0 ? colVals[idx] : 0;
        }
      }
      showToast('¡GRAVEDAD!');
      break;
    case 'freeze':
      freezeUntil = performance.now() + 5000;
      showToast('¡CONGELAR!');
      break;
  }
  beep(660, 0.2);
}

function lockPiece() {
  snapshotState();
  isLockDelayActive = false;
  lockDelayAccum = 0;
  if (current.power) {
    applyPowerup();
  } else {
    const wasTSpin = detectTSpin();
    merge();
    if (wasTSpin) {
      score += TSPIN_SCORE * level;
      showToast('T-SPIN!');
      beep(740, 0.25);
    }
  }
  clearLines();
  checkChallengeProgress();
  if (gameOver) return;
  holdUsed = false;
  spawn();
}

function spawn() {
  current = nextQueue.shift();
  nextQueue.push(drawNextPiece());
  next = nextQueue[0];
  if (collide(current.shape, current.x, current.y)) {
    endGame(challenge ? 'DESAFÍO FALLIDO' : 'GAME OVER');
    return;
  }
  drawNext();
  drawHold();
}

function holdSwap() {
  if (holdUsed || gameOver || paused) return;
  holdUsed = true;
  if (holdPiece === null) {
    holdPiece = pieceDescriptor(current.type, current.power);
    spawn();
  } else {
    const swapped = pieceDescriptor(holdPiece.type, holdPiece.power);
    holdPiece = pieceDescriptor(current.type, current.power);
    current = swapped;
    if (collide(current.shape, current.x, current.y)) {
      endGame('GAME OVER');
      return;
    }
  }
  drawHold();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  energyFill.style.width = `${energy}%`;
  updateObjectiveHud();
  if (energy >= 100 && !skillPromptOpen) openSkillPrompt();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

/** Dibuja una pieza (power-up usa su propio color en vez del de la shape). */
function drawPieceBlock(context, x, y, colorIndex, size, alpha, power) {
  if (!colorIndex) return;
  if (power) {
    context.globalAlpha = alpha ?? 1;
    context.fillStyle = POWERUP_COLOR[power];
    context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
    context.globalAlpha = 1;
    return;
  }
  drawBlock(context, x, y, colorIndex, size, alpha);
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawPieceBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2, current.power);

  // current piece (invisible si el objetivo de desafío lo exige y ya está apoyada)
  const invisible = challenge && challenge.type === 'invisible-landed' && isLockDelayActive;
  if (!invisible) {
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawPieceBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK, 1, current.power);
  }
}

function drawPreview(context, canvasEl, piece) {
  const NB = canvasEl.width / 4;
  context.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!piece) return;
  const shape = piece.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawPieceBlock(context, offX + c, offY + r, shape[r][c], NB, 1, piece.power);
}

function drawNext() {
  drawPreview(nextCtx, nextCanvas, next);
}

function drawHold() {
  drawPreview(holdCtx, holdCanvas, holdPiece);
  holdCanvas.classList.toggle('dim', holdUsed);
}

function beep(freq, dur) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = 'square';
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio no disponible, se ignora */ }
}

function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  toastLayer.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  }, 1000);
}

function openSkillPrompt() {
  skillPromptOpen = true;
  skillPrompt.classList.remove('hidden');
}

function closeSkillPrompt() {
  skillPromptOpen = false;
  skillPrompt.classList.add('hidden');
}

function useSkill(n) {
  if (!skillPromptOpen) return;
  switch (n) {
    case 1: // ver próximas 5 piezas
      while (nextQueue.length < 5) nextQueue.push(drawNextPiece());
      renderNextQueuePreview();
      break;
    case 2: // intercambiar pieza actual
      current = weightedRandomPiece();
      break;
    case 3: // ralentizar
      slowUntil = performance.now() + 10000;
      break;
    case 4: // deshacer última jugada
      if (lastSnapshot) {
        board = lastSnapshot.board.map(row => [...row]);
        score = lastSnapshot.score;
        lines = lastSnapshot.lines;
        level = lastSnapshot.level;
        lastSnapshot = null;
      }
      break;
  }
  energy = 0;
  closeSkillPrompt();
  updateHUD();
  drawNext();
}

/** Muestra hasta 5 piezas en cola en el canvas de "next" (habilidad "ver próximas 5"). */
function renderNextQueuePreview() {
  const NB = nextCanvas.width / 6;
  const rowHeight = nextCanvas.height / 5;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  nextQueue.slice(0, 5).forEach((piece, i) => {
    const shape = piece.shape;
    const offX = Math.floor((6 - shape[0].length) / 2);
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        drawPieceBlock(nextCtx, offX + c, r, shape[r][c], NB, 1, piece.power);
    nextCtx.translate(0, rowHeight);
  });
  nextCtx.setTransform(1, 0, 0, 1, 0, 0);
}

// ---- Modo desafío ----

const CHALLENGE_TYPES = {
  'lines-in-time': { label: 'Limpia 40 líneas en 2 minutos', target: 40, timeLimit: 120 },
  'garbage-rising': { label: 'Sobrevive con basura subiendo cada 10s' },
  'preset-board': { label: 'Tablero con bloques fijos pre-colocados' },
  'invisible-landed': { label: 'Piezas invisibles tras tocar suelo' },
  'reverse-rotation': { label: 'Rotación inversa en niveles altos' },
};

let garbageTimer = 0;
let challengeTimeLeft = 0;

function startChallenge(type) {
  const cfg = CHALLENGE_TYPES[type];
  challenge = { type, ...cfg };
  challengeTimeLeft = cfg.timeLimit || 0;
  garbageTimer = 0;
  init();
}

function checkChallengeProgress() {
  if (!challenge) return;
  if (challenge.type === 'lines-in-time' && lines >= challenge.target) {
    endGame('¡DESAFÍO SUPERADO!');
  }
}

function updateObjectiveHud() {
  if (!challenge) { objectiveHud.classList.add('hidden'); return; }
  objectiveHud.classList.remove('hidden');
  if (challenge.type === 'lines-in-time') {
    objectiveHud.textContent = `Objetivo: ${lines}/${challenge.target} líneas — ${Math.ceil(challengeTimeLeft)}s`;
  } else {
    objectiveHud.textContent = `Desafío: ${challenge.label}`;
  }
}

function pushGarbageRow() {
  const gapCol = Math.floor(Math.random() * COLS);
  const row = new Array(COLS).fill(8).map((v, i) => (i === gapCol ? 0 : v));
  if (board[0].some(v => v !== 0)) {
    endGame('DESAFÍO FALLIDO');
    return;
  }
  board.shift();
  board.push(row);
}

function endGame(title) {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = title || 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  modeSelect.classList.remove('hidden');
  challengeList.classList.add('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
    modeSelect.classList.add('hidden');
    challengeList.classList.add('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;

  if (performance.now() >= freezeUntil) {
    const speedFactor = performance.now() < slowUntil ? 2 : 1;
    dropAccum += dt;
    if (dropAccum >= dropInterval * speedFactor) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
        isLockDelayActive = false;
        lockDelayAccum = 0;
      } else {
        isLockDelayActive = true;
        lockDelayAccum += dropInterval * speedFactor;
        if (lockDelayAccum >= LOCK_DELAY) {
          lockPiece();
          if (gameOver) { draw(); return; }
        }
      }
    }
  }

  if (challenge && challenge.type === 'lines-in-time') {
    challengeTimeLeft -= dt / 1000;
    if (challengeTimeLeft <= 0) {
      endGame('TIEMPO AGOTADO');
      return;
    }
    updateObjectiveHud();
  }

  if (challenge && challenge.type === 'garbage-rising') {
    garbageTimer += dt;
    if (garbageTimer >= 10000) {
      garbageTimer = 0;
      pushGarbageRow();
    }
  }

  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  const preset = challenge && challenge.type === 'preset-board' ? PRESET_BOARD_ROWS : null;
  board = createBoard(preset);
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  comboCount = 0;
  lastClearWasTetris = false;
  holdPiece = null;
  holdUsed = false;
  energy = 0;
  lastSnapshot = null;
  freezeUntil = 0;
  slowUntil = 0;
  isLockDelayActive = false;
  lockDelayAccum = 0;
  forcedNext = [];
  resetPowerupCounter();
  closeSkillPrompt();
  nextQueue = [weightedRandomPiece(), weightedRandomPiece()];
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (skillPromptOpen) {
    if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
      useSkill(Number(e.code.slice(-1)));
    }
    return;
  }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastActionWasRotate = false; resetLockDelayIfGrounded(); }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastActionWasRotate = false; resetLockDelayIfGrounded(); }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      holdSwap();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => init());

modeSelect.addEventListener('click', e => {
  const btn = e.target.closest('[data-mode]');
  if (!btn) return;
  if (btn.dataset.mode === 'marathon') {
    challenge = null;
    init();
  } else {
    modeSelect.classList.add('hidden');
    challengeList.classList.remove('hidden');
  }
});

challengeList.addEventListener('click', e => {
  const btn = e.target.closest('[data-challenge]');
  if (!btn) return;
  startChallenge(btn.dataset.challenge);
});

init();
