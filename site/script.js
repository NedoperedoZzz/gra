/* Cell Runner — браузерный endless runner по мотивам TASK.md */
(() => {
  'use strict';

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  const W = canvas.width;   // 960
  const H = canvas.height;  // 360

  const scoreEl = document.getElementById('score');
  const speedEl = document.getElementById('speed');
  const overlay = document.getElementById('overlay');
  const panelTitle = document.getElementById('panel-title');
  const panelText = document.getElementById('panel-text');
  const startBtn = document.getElementById('start-btn');
  const recordsList = document.getElementById('records-list');

  // --- Константы игры -----------------------------------------------------
  const GROUND_Y = H - 70;          // уровень «дна» питательной среды
  const CELL_X = 140;               // клетка движется вперёд автоматически:
                                    // мир бежит навстречу, клетка на фикс. X
  const CELL_R = 22;                // радиус клетки
  const GRAVITY = 2600;             // px/с^2
  const JUMP_VY = -820;             // начальная скорость прыжка
  const BASE_SPEED = 240;           // базовая скорость мира, px/с
  const SPEED_PER_LEVEL = 30;       // прибавка скорости за каждые LEVEL_STEP очков
  const LEVEL_STEP = 5;             // раз в N очков растёт сложность
  const MAX_SPEED = 620;
  const FOOD_CHANCE = 0.62;         // вероятность полезного объекта

  // --- Состояние ----------------------------------------------------------
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let elapsed = 0;

  const cell = { y: GROUND_Y - CELL_R, vy: 0, onGround: true, pulse: 0 };
  let objects = [];      // летящие объекты: {type:'food'|'danger', ...}
  let particles = [];    // фон: «течение» среды
  let bubbles = [];      // всплывающие пузырьки
  let speed = BASE_SPEED;
  let score = 0;
  let spawnTimer = 0;
  let spawnInterval = 1.4;
  const records = [];    // таблица лучших результатов текущей сессии

  // --- Инициализация фона -------------------------------------------------
  function initAmbient() {
    particles = [];
    bubbles = [];
    for (let i = 0; i < 26; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        len: 30 + Math.random() * 70,
        depth: 0.25 + Math.random() * 0.6, // параллакс
      });
    }
    for (let i = 0; i < 12; i++) {
      bubbles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 2 + Math.random() * 5,
        wobble: Math.random() * Math.PI * 2,
        speed: 20 + Math.random() * 35,
      });
    }
  }

  // --- Спавн объектов -----------------------------------------------------
  function spawnObject() {
    const isFood = Math.random() < FOOD_CHANCE;
    if (isFood) {
      // глюкоза/аминокислоты: парят на разной высоте, иногда высоко — надо прыгать или наоборот не прыгать
      const high = Math.random() < 0.5;
      objects.push({
        type: 'food',
        kind: Math.random() < 0.5 ? 'glucose' : 'amino',
        x: W + 30,
        y: high ? GROUND_Y - 130 - Math.random() * 60 : GROUND_Y - 30 - Math.random() * 40,
        r: 13,
        spin: Math.random() * Math.PI * 2,
      });
    } else {
      // токсин (треугольник, на дне) или вирус (круг с шипами, в воздухе)
      const toxin = Math.random() < 0.6;
      if (toxin) {
        objects.push({ type: 'danger', kind: 'toxin', x: W + 30, y: GROUND_Y, r: 20 });
      } else {
        objects.push({
          type: 'danger', kind: 'virus',
          x: W + 30,
          y: GROUND_Y - 60 - Math.random() * 90,
          r: 16,
          spin: 0,
        });
      }
    }
  }

  // --- Управление (одна клавиша) ------------------------------------------
  function jump() {
    if (!running) return;
    if (cell.onGround) {
      cell.vy = JUMP_VY;
      cell.onGround = false;
    }
    // повторное нажатие в воздухе игнорируется — поведение не ломается
  }

  // удержание клавиши/кнопки не должно включать автоповтор прыжков
  let actionHeld = false;

  function onAction(e) {
    if (e.type === 'keydown') {
      if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
      e.preventDefault();
      if (actionHeld) return; // игнорируем автоповтор при удержании
      actionHeld = true;
      if (!running) { startGame(); return; }
      jump();
    } else if (e.type === 'keyup') {
      if (e.code === 'Space' || e.code === 'ArrowUp') actionHeld = false;
    } else {
      // клик по canvas тоже работает как одна клавиша
      if (!running) return;
      jump();
    }
  }

  window.addEventListener('keydown', onAction);
  window.addEventListener('keyup', onAction);
  canvas.addEventListener('pointerdown', onAction);
  startBtn.addEventListener('click', () => startGame());

  // --- Игровой цикл -------------------------------------------------------
  function startGame() {
    running = true;
    overlay.classList.add('hidden');
    objects = [];
    score = 0;
    speed = BASE_SPEED;
    spawnInterval = 1.4;
    spawnTimer = 0;
    elapsed = 0;
    cell.y = GROUND_Y - CELL_R;
    cell.vy = 0;
    cell.onGround = true;
    updateHud();
    lastTime = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    playTone(140, 0.5, 'sawtooth'); // звук проигрыша
    records.push(score);
    records.sort((a, b) => b - a);
    renderRecords();
    panelTitle.textContent = 'Забег завершён';
    panelText.textContent = `Ваш организм погиб. Итоговый счёт: ${score} ${plural(score, 'очко', 'очка', 'очков')}.`;
    startBtn.textContent = 'Играть снова';
    overlay.classList.remove('hidden');
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  function updateHud() {
    scoreEl.textContent = 'Очки: ' + score;
    speedEl.textContent = 'Скорость: x' + (speed / BASE_SPEED).toFixed(1);
  }

  function addScore() {
    score += 1;
    playTone(660 + Math.min(score, 20) * 12, 0.12, 'sine'); // звук собирания
    // рост сложности: раз в LEVEL_STEP очков увеличиваем скорость и частоту
    const level = Math.floor(score / LEVEL_STEP);
    speed = Math.min(BASE_SPEED + level * SPEED_PER_LEVEL, MAX_SPEED);
    spawnInterval = Math.max(1.4 - level * 0.12, 0.55);
    updateHud();
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;
    elapsed += dt;

    // физика клетки
    cell.vy += GRAVITY * dt;
    cell.y += cell.vy * dt;
    const floor = GROUND_Y - CELL_R;
    if (cell.y >= floor) {
      cell.y = floor;
      cell.vy = 0;
      cell.onGround = true;
    }
    cell.pulse += dt * 6;

    // спавн объектов
    spawnTimer += dt;
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      spawnObject();
    }

    // движение мира навстречу клетке (автобег)
    for (const o of objects) {
      o.x -= speed * dt;
      if (o.spin !== undefined) o.spin += dt * 3;
    }

    // фоновое течение
    for (const p of particles) {
      p.x -= speed * p.depth * 0.5 * dt;
      if (p.x + p.len < 0) {
        p.x = W + Math.random() * 100;
        p.y = Math.random() * H;
      }
    }
    for (const b of bubbles) {
      b.y -= b.speed * dt;
      b.wobble += dt * 2;
      b.x += Math.sin(b.wobble) * 12 * dt - speed * 0.15 * dt;
      if (b.y < -10) { b.y = H + 10; b.x = Math.random() * W; }
      if (b.x < -10) b.x = W + 10;
    }

    // столкновения
    const cx = CELL_X, cy = cell.y;
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (o.x < -60) { objects.splice(i, 1); continue; }
      const dx = o.x - cx;
      const dy = o.y - cy;
      const rr = o.r + CELL_R - 4; // чуть щадящий хитбокс
      if (dx * dx + dy * dy < rr * rr) {
        if (o.type === 'food') {
          objects.splice(i, 1); // объект исчезает с экрана
          addScore();           // счёт +1
        } else {
          gameOver();
          draw();
          return;
        }
      }
    }

    draw();
    rafId = requestAnimationFrame(loop);
  }

  // --- Отрисовка ----------------------------------------------------------
  function draw() {
    // градиент среды
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b3a2e');
    g.addColorStop(1, '#06231c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // линии течения
    ctx.strokeStyle = 'rgba(158, 240, 201, 0.10)';
    ctx.lineWidth = 2;
    for (const p of particles) {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.len, p.y);
      ctx.stroke();
    }

    // пузырьки
    ctx.strokeStyle = 'rgba(158, 240, 201, 0.25)';
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // дно
    ctx.fillStyle = 'rgba(88, 214, 163, 0.18)';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.strokeStyle = 'rgba(88, 214, 163, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(W, GROUND_Y);
    ctx.stroke();

    for (const o of objects) drawObject(o);
    drawCell();
  }

  function drawCell() {
    const r = CELL_R + Math.sin(cell.pulse) * 1.5;
    ctx.save();
    ctx.translate(CELL_X, cell.y);
    // мембрана
    ctx.fillStyle = 'rgba(88, 214, 163, 0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9ef0c9';
    ctx.lineWidth = 2;
    ctx.stroke();
    // ядро
    ctx.fillStyle = '#06231c';
    ctx.beginPath();
    ctx.arc(3, 2, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    // реснички (жгутики)
    ctx.strokeStyle = '#9ef0c9';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.quadraticCurveTo(
        Math.cos(a) * (r + 10), Math.sin(a) * (r + 10) + Math.sin(cell.pulse * 2 + i) * 4,
        Math.cos(a) * (r + 16), Math.sin(a) * (r + 16)
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawObject(o) {
    ctx.save();
    ctx.translate(o.x, o.y);
    if (o.type === 'food') {
      if (o.kind === 'glucose') {
        // шестиугольная молекула глюкозы
        ctx.rotate(o.spin || 0);
        ctx.fillStyle = '#ffd166';
        ctx.strokeStyle = '#ffe9b0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = Math.cos(a) * o.r, py = Math.sin(a) * o.r;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // аминокислота — круг с «боковой цепью»
        ctx.fillStyle = '#8ecae6';
        ctx.strokeStyle = '#d0f0ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, o.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(o.r * 0.5, -o.r * 0.5);
        ctx.lineTo(o.r * 1.3, -o.r * 1.1);
        ctx.stroke();
      }
    } else {
      if (o.kind === 'toxin') {
        // токсин — красный треугольник на дне
        ctx.fillStyle = '#ff6b6b';
        ctx.strokeStyle = '#ffb4b4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -o.r * 1.6);
        ctx.lineTo(o.r, 0);
        ctx.lineTo(-o.r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // вирус — круг с шипами
        ctx.rotate(o.spin || 0);
        ctx.fillStyle = '#c77dff';
        ctx.strokeStyle = '#eaccff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, o.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI / 4) * i;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * o.r * 0.6, Math.sin(a) * o.r * 0.6);
          ctx.lineTo(Math.cos(a) * o.r, Math.sin(a) * o.r);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // --- Звук (по желанию) --------------------------------------------------
  let audioCtx = null;
  function playTone(freq, dur, type) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (e) { /* звук не критичен */ }
  }

  // --- Таблица лучших результатов сессии ----------------------------------
  function renderRecords() {
    recordsList.innerHTML = '';
    records.slice(0, 5).forEach((s, i) => {
      const li = document.createElement('li');
      li.textContent = `${s} ${plural(s, 'очко', 'очка', 'очков')}`;
      recordsList.appendChild(li);
    });
  }

  // --- Первый кадр (персонаж виден до старта) -----------------------------
  initAmbient();
  cell.y = GROUND_Y - CELL_R;
  draw();
})();
