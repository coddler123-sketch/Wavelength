// Runs in both Node (require) and browser (sets window.WavelengthVisualizer).
(function (exports) {
  const BAR_COUNT = 44;
  const VISUALIZER_MODES = [
    'bars', 'mirror', 'oscilloscope', 'waterfall',
    'wave', 'dna', 'particles', 'tunnel', 'scanner', 'medwaves',
  ];
  const VISUALIZER_LABELS = {
    bars:        'Bars',
    mirror:      'Mirror',
    oscilloscope:'Oscilloscope',
    waterfall:   'Waterfall',
    wave:        'Waveform',
    dna:         'DNA Helix',
    particles:   'Particles',
    tunnel:      'Tunnel',
    scanner:     'Signal Scanner',
    medwaves:    'Wavelength Waves',
  };

  function create(options) {
    const canvas     = options.canvas;
    const canvasCtx  = canvas.getContext('2d');
    const miniCanvas    = options.miniCanvas;
    const miniCanvasCtx = miniCanvas ? miniCanvas.getContext('2d') : null;
    const storageKey  = options.storageKey;
    const averageLevel = options.averageLevel;
    const getAnalyser  = options.getAnalyser;
    const getState     = options.getState;
    const onLevel      = options.onLevel;
    const showToast    = options.showToast;

    let running = false;
    let clock   = 0;
    let mode    = localStorage.getItem(storageKey) || 'bars';

    // Shared buffers
    let freqBuf       = null;
    let timeDomainBuf = null;
    const peaks   = new Float32Array(BAR_COUNT);
    const peakVel = new Float32Array(BAR_COUNT);
    const barBuf  = new Float32Array(BAR_COUNT);

    // Stateful mode data — reset on mode change
    let wfallBuf      = null; // waterfall ring buffer
    let wfallHead     = 0;
    let tunnelHistory = null; // tunnel ring buffer
    let tunnelHead    = 0;
    let particles     = [];

    const WFALL_FRAMES  = 80;
    const TUNNEL_RINGS  = 22;
    const MAX_PARTICLES = 90;

    const idleData = Array.from({ length: BAR_COUNT }, (_, i) => {
      const shape = Math.sin((i / BAR_COUNT) * Math.PI);
      return 0.18 + shape * 0.22;
    });

    if (!VISUALIZER_MODES.includes(mode)) mode = 'bars';

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const pairs = [[canvas, canvasCtx]];
      if (miniCanvas && miniCanvasCtx) pairs.push([miniCanvas, miniCanvasCtx]);
      for (const [c, ctx] of pairs) {
        const w = c.offsetWidth, h = c.offsetHeight;
        if (w > 0 && h > 0) {
          if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
            c.width  = Math.round(w * dpr);
            c.height = Math.round(h * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }
      }
    }

    function fakeBar(t, i, count) {
      const shape = Math.pow(Math.sin((i / count) * Math.PI), 0.6);
      const n = (
        Math.sin(t * 1.1  + i * 0.35) * 0.30 +
        Math.sin(t * 2.3  + i * 0.19) * 0.22 +
        Math.sin(t * 0.7  + i * 0.52) * 0.18 +
        Math.sin(t * 3.7  + i * 0.11) * 0.14 +
        Math.sin(t * 0.31 + i * 0.73) * 0.08 +
        Math.sin(t * 5.1  + i * 0.27) * 0.05
      );
      return Math.max(0, Math.min(1, (n + 0.62) * shape));
    }

    function drawMiniSignal(values) {
      if (!miniCanvas || !miniCanvasCtx) return;
      const dpr = window.devicePixelRatio || 1;
      const W = miniCanvas.width / dpr, H = miniCanvas.height / dpr;
      miniCanvasCtx.clearRect(0, 0, W, H);
      miniCanvasCtx.save();

      const count = 16; // 16 small bars
      const gap = 1.5;
      const barW = (W - gap * (count - 1)) / count;
      const grad = miniCanvasCtx.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0, '#0072ff'); // Electric Blue
      grad.addColorStop(1, '#00f0ff'); // Neon Cyan

      miniCanvasCtx.fillStyle = grad;
      miniCanvasCtx.shadowColor = 'rgba(0, 240, 255, 0.3)';
      miniCanvasCtx.shadowBlur = 3;

      for (let i = 0; i < count; i++) {
        const valIdx = Math.floor((i / count) * values.length);
        const v = values[valIdx] || 0;
        const barH = Math.max(1.5, v * H * 0.9);
        const x = i * (barW + gap);
        const y = H - barH;
        
        miniCanvasCtx.beginPath();
        if (miniCanvasCtx.roundRect) {
          miniCanvasCtx.roundRect(x, y, barW, barH, 0.8);
        } else {
          miniCanvasCtx.rect(x, y, barW, barH);
        }
        miniCanvasCtx.fill();
      }
      miniCanvasCtx.restore();
    }

    // ── Draw modes ────────────────────────────────────────────────

    function drawBars(values, W, H) {
      const gap  = 2;
      const barW = (W - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      const grad = canvasCtx.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0.0,  '#7000ff'); // Neon Purple
      grad.addColorStop(0.52, '#0072ff'); // Electric Blue
      grad.addColorStop(1.0,  '#00f0ff'); // Neon Cyan

      canvasCtx.save();
      canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.16)';
      canvasCtx.shadowBlur  = 7;
      for (let i = 0; i < BAR_COUNT; i++) {
        const x    = i * (barW + gap);
        const barH = Math.max(2, values[i] * H * 0.84);
        const y    = H - barH;
        canvasCtx.fillStyle = grad;
        canvasCtx.beginPath();
        if (canvasCtx.roundRect) canvasCtx.roundRect(x, y, barW, barH, [1.5, 1.5, 0, 0]);
        else canvasCtx.rect(x, y, barW, barH);
        canvasCtx.fill();

        if (peaks[i] > 0.04) {
          const peakY = H - peaks[i] * H * 0.84 - 2.5;
          canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.55)';
          canvasCtx.shadowBlur  = 5;
          canvasCtx.fillStyle   = 'rgba(255, 255, 255, 0.85)';
          canvasCtx.fillRect(x, peakY, barW, 1.5);
          canvasCtx.shadowBlur  = 7;
          canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.16)';
        }
      }
      canvasCtx.restore();
    }

    function drawMirror(values, W, H) {
      const gap  = 2;
      const barW = (W - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      const mid  = H / 2;
      const grad = canvasCtx.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0.0,  '#7000ff');
      grad.addColorStop(0.52, '#0072ff');
      grad.addColorStop(1.0,  '#00f0ff');

      canvasCtx.save();
      canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.18)';
      canvasCtx.shadowBlur  = 6;
      canvasCtx.fillStyle   = grad;
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barW + gap);
        const h = Math.max(2, values[i] * mid * 0.88);
        canvasCtx.fillRect(x, mid - h, barW, h);
        canvasCtx.fillRect(x, mid,     barW, h);
      }
      canvasCtx.shadowBlur    = 0;
      canvasCtx.strokeStyle   = 'rgba(0, 240, 255, 0.07)';
      canvasCtx.lineWidth     = 1;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, mid);
      canvasCtx.lineTo(W, mid);
      canvasCtx.stroke();
      canvasCtx.restore();
    }

    function drawOscilloscope(values, W, H) {
      const mid = H / 2;
      const avg = averageLevel(values);
      const amp = H * (0.3 + avg * 0.14);

      let hasReal = false;
      const analyser = getAnalyser();
      if (analyser) {
        if (!timeDomainBuf || timeDomainBuf.length !== analyser.fftSize) {
          timeDomainBuf = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteTimeDomainData(timeDomainBuf);
        const variance = timeDomainBuf.reduce((s, v) => s + Math.abs(v - 128), 0);
        if (variance > 200) hasReal = true;
      }

      const grad = canvasCtx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0,   'rgba(0, 114, 255, 0.55)');
      grad.addColorStop(0.5, 'rgba(0, 240, 255, 1.0)');
      grad.addColorStop(1,   'rgba(0, 114, 255, 0.55)');

      canvasCtx.save();
      canvasCtx.strokeStyle = grad;
      canvasCtx.lineWidth   = 2.5;
      canvasCtx.lineCap     = 'round';
      canvasCtx.lineJoin    = 'round';
      canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.55)';
      canvasCtx.shadowBlur  = 10;
      canvasCtx.beginPath();

      const STEPS = Math.floor(W * 1.5);
      for (let i = 0; i < STEPS; i++) {
        const x = (i / STEPS) * W;
        let y;
        if (hasReal) {
          const si = Math.floor((i / STEPS) * timeDomainBuf.length);
          y = mid + ((timeDomainBuf[si] / 128.0) - 1.0) * H * 0.42;
        } else {
          const t  = (i / STEPS) * Math.PI * 4;
          const v  = values[Math.floor((i / STEPS) * values.length)] || 0;
          y = mid
            + Math.sin(t + clock * 2.1) * amp * 0.6 * (0.35 + v * 0.85)
            + Math.sin(t * 1.5 + clock * 3.3) * amp * 0.28 * v
            + Math.sin(t * 3.1 + clock * 1.1) * amp * 0.1;
        }
        if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
      }
      canvasCtx.stroke();

      canvasCtx.shadowBlur   = 0;
      canvasCtx.globalAlpha  = 0.07;
      canvasCtx.strokeStyle  = 'rgba(0, 240, 255, 1)';
      canvasCtx.lineWidth    = 1;
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, mid);
      canvasCtx.lineTo(W, mid);
      canvasCtx.stroke();
      canvasCtx.restore();
    }

    function drawWaterfall(values, W, H) {
      if (!wfallBuf) {
        wfallBuf = [];
        for (let i = 0; i < WFALL_FRAMES; i++) wfallBuf.push(new Float32Array(BAR_COUNT));
        wfallHead = 0;
      }
      wfallBuf[wfallHead].set(values);
      wfallHead = (wfallHead + 1) % WFALL_FRAMES;

      const colW = W / WFALL_FRAMES;
      const rowH = H / BAR_COUNT;

      canvasCtx.save();
      for (let t = 0; t < WFALL_FRAMES; t++) {
        const histIdx = (wfallHead + t) % WFALL_FRAMES;
        const x       = t * colW;
        const snap    = wfallBuf[histIdx];
        const age     = t / WFALL_FRAMES; 

        for (let i = 0; i < BAR_COUNT; i++) {
          const v = snap[i];
          if (v < 0.04) continue;
          const freqY = (1 - i / BAR_COUNT) * H;
          const alpha = v * (0.15 + age * 0.8);
          canvasCtx.fillStyle = v > 0.58
            ? `rgba(0, 240, 255, ${alpha})`
            : `rgba(0, 114, 255, ${alpha})`;
          canvasCtx.fillRect(x, freqY, Math.ceil(colW) + 0.5, Math.ceil(rowH) + 0.5);
        }
      }
      canvasCtx.restore();
    }

    function drawWave(values, W, H) {
      const mid = H * 0.55, amp = H * 0.32;
      const grad = canvasCtx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0.0, 'rgba(112, 0, 255, 0.35)');
      grad.addColorStop(0.5, 'rgba(0, 240, 255, 0.95)');
      grad.addColorStop(1.0, 'rgba(0, 114, 255, 0.55)');

      const wavePts = [];
      for (let i = 0; i < values.length; i++) {
        const x = (i / (values.length - 1)) * W;
        const wobble = Math.sin(clock * 1.4 + i * 0.42) * H * 0.05;
        wavePts.push({ x, y: mid - (values[i] - 0.35) * amp + wobble });
      }

      canvasCtx.save();

      const fillGrad = canvasCtx.createLinearGradient(0, mid, 0, H);
      fillGrad.addColorStop(0, 'rgba(0, 240, 255, 0.10)');
      fillGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
      canvasCtx.fillStyle = fillGrad;
      canvasCtx.beginPath();
      wavePts.forEach(({ x, y }, i) => i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y));
      canvasCtx.lineTo(W, H); canvasCtx.lineTo(0, H); canvasCtx.closePath();
      canvasCtx.fill();

      canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.38)';
      canvasCtx.shadowBlur  = 9;
      canvasCtx.strokeStyle = grad;
      canvasCtx.lineWidth   = 3;
      canvasCtx.lineCap     = 'round';
      canvasCtx.beginPath();
      wavePts.forEach(({ x, y }, i) => i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y));
      canvasCtx.stroke();

      canvasCtx.shadowBlur  = 0;
      canvasCtx.globalAlpha = 0.07;
      canvasCtx.lineWidth   = 1;
      canvasCtx.strokeStyle = '#00f0ff';
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, mid); canvasCtx.lineTo(W, mid);
      canvasCtx.stroke();
      canvasCtx.restore();
    }

    function drawDNA(values, W, H) {
      const avg   = averageLevel(values);
      const amp   = H * (0.28 + avg * 0.12);
      const freq  = (2 * Math.PI * 2) / W;
      const phase1 = clock * 1.2;
      const phase2 = phase1 + Math.PI;
      const STEPS  = Math.floor(W / 3);

      canvasCtx.save();
      canvasCtx.lineCap = 'round';

      for (let i = 0; i <= STEPS; i++) {
        if (i % 4 !== 0) continue;
        const x  = (i / STEPS) * W;
        const y1 = H / 2 + Math.sin(x * freq + phase1) * amp;
        const y2 = H / 2 + Math.sin(x * freq + phase2) * amp;
        const fi = Math.floor((i / STEPS) * values.length);
        const v  = values[fi] || 0;
        canvasCtx.strokeStyle = v > 0.48 ? `rgba(0, 240, 255, ${0.15 + v * 0.45})` : `rgba(112, 0, 255, ${0.1 + v * 0.35})`;
        canvasCtx.lineWidth   = 1 + v * 1.2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(x, y1); canvasCtx.lineTo(x, y2);
        canvasCtx.stroke();
      }

      const grad1 = canvasCtx.createLinearGradient(0, 0, W, 0);
      grad1.addColorStop(0,   'rgba(112, 0, 255, 0.55)');
      grad1.addColorStop(0.5, 'rgba(0, 114, 255, 0.95)');
      grad1.addColorStop(1,   'rgba(112, 0, 255, 0.55)');

      const grad2 = canvasCtx.createLinearGradient(0, 0, W, 0);
      grad2.addColorStop(0,   'rgba(0, 240, 255, 0.38)');
      grad2.addColorStop(0.5, 'rgba(0, 240, 255, 0.78)');
      grad2.addColorStop(1,   'rgba(0, 240, 255, 0.38)');

      for (const [grad, phase] of [[grad1, phase1], [grad2, phase2]]) {
        canvasCtx.strokeStyle = grad;
        canvasCtx.lineWidth   = 2.5;
        canvasCtx.shadowColor = phase === phase1 ? 'rgba(112, 0, 255, 0.45)' : 'rgba(0, 240, 255, 0.35)';
        canvasCtx.shadowBlur  = 8;
        canvasCtx.beginPath();
        for (let i = 0; i <= STEPS; i++) {
          const x = (i / STEPS) * W;
          const y = H / 2 + Math.sin(x * freq + phase) * amp;
          if (i === 0) canvasCtx.moveTo(x, y); else canvasCtx.lineTo(x, y);
        }
        canvasCtx.stroke();
      }
      canvasCtx.restore();
    }

    function drawParticles(values, W, H) {
      const avg = averageLevel(values);

      const spawnN = Math.floor(avg * 7);
      for (let k = 0; k < spawnN && particles.length < MAX_PARTICLES; k++) {
        const fi = Math.floor(Math.random() * values.length);
        const v  = values[fi];
        if (v < 0.18) continue;
        particles.push({
          x:     (fi / values.length) * W,
          y:     H * 0.88,
          vx:    (Math.random() - 0.5) * 2.2,
          vy:    -(1.2 + v * 4.5 + Math.random() * 1.8),
          life:  1,
          decay: 0.016 + Math.random() * 0.018,
          r:     1.4 + v * 3.2,
          cyan:  v > 0.58,
        });
      }

      canvasCtx.save();
      particles = particles.filter(p => {
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy *= 0.982;
        p.vx *= 0.994;
        p.life -= p.decay;
        if (p.life <= 0) return false;

        const a = p.life * 0.82;
        const color = p.cyan ? `rgba(0, 240, 255, ${a})` : `rgba(112, 0, 255, ${a})`;
        canvasCtx.fillStyle   = color;
        canvasCtx.shadowColor = color;
        canvasCtx.shadowBlur  = p.r * 2.2;
        canvasCtx.beginPath();
        canvasCtx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
        canvasCtx.fill();
        return true;
      });
      canvasCtx.restore();
    }

    function drawTunnel(values, W, H) {
      if (!tunnelHistory) {
        tunnelHistory = [];
        for (let i = 0; i < TUNNEL_RINGS; i++) tunnelHistory.push(new Float32Array(BAR_COUNT));
        tunnelHead = 0;
      }

      if (Math.round(clock / 0.048) % 3 === 0) {
        tunnelHistory[tunnelHead].set(values);
        tunnelHead = (tunnelHead + 1) % TUNNEL_RINGS;
      }

      const cx = W / 2, cy = H / 2;
      canvasCtx.save();

      for (let t = 0; t < TUNNEL_RINGS; t++) {
        const age     = t / TUNNEL_RINGS; 
        const histIdx = (tunnelHead + t) % TUNNEL_RINGS;
        const snap    = tunnelHistory[histIdx];
        const avg     = averageLevel(snap);
        const scale   = 1 - age * 0.92;
        const rx      = (W / 2) * scale * (0.88 + avg * 0.18);
        const ry      = (H / 2) * scale * (0.88 + avg * 0.18);
        if (rx < 2 || ry < 2) continue;

        const alpha = age * (0.15 + avg * 0.55);
        canvasCtx.strokeStyle = avg > 0.42
          ? `rgba(0, 240, 255, ${alpha})`
          : `rgba(0, 114, 255, ${alpha})`;
        canvasCtx.lineWidth   = 0.8 + age * 2;
        canvasCtx.shadowColor = 'rgba(0, 240, 255, 0.28)';
        canvasCtx.shadowBlur  = age * 8;
        canvasCtx.beginPath();
        canvasCtx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        canvasCtx.stroke();
      }
      canvasCtx.restore();
    }

    function drawScanner(values, W, H) {
      const rows   = 13;
      const rowGap = H / (rows + 1);

      canvasCtx.save();
      canvasCtx.lineCap = 'round';
      for (let row = 0; row < rows; row++) {
        const y     = rowGap * (row + 1);
        const value = values[Math.floor((row / rows) * values.length)] || 0;
        const left  = W * (0.09 + value * 0.14);
        const right = W * (0.91 - value * 0.14);

        canvasCtx.strokeStyle = row % 3 === 0 ? 'rgba(0, 240, 255, 0.22)' : 'rgba(112, 0, 255, 0.24)';
        canvasCtx.lineWidth   = 1;
        canvasCtx.beginPath();
        canvasCtx.moveTo(left, y); canvasCtx.lineTo(right, y);
        canvasCtx.stroke();

        canvasCtx.strokeStyle = value > 0.48 ? 'rgba(0, 240, 255, 0.95)' : 'rgba(0, 114, 255, 0.68)';
        canvasCtx.lineWidth   = 1.6 + value * 2.2;
        canvasCtx.beginPath();
        canvasCtx.moveTo(W / 2 - value * W * 0.38, y);
        canvasCtx.lineTo(W / 2 + value * W * 0.38, y);
        canvasCtx.stroke();
      }
      canvasCtx.restore();
    }

    function drawMedWaves(values, W, H) {
      const mid = H * 0.46;
      
      let bassSum = 0, midSum = 0, highSum = 0;
      for (let i = 0; i < 12; i++) bassSum += values[i];
      for (let i = 12; i < 32; i++) midSum += values[i];
      for (let i = 32; i < 44; i++) highSum += values[i];
      const bassLvl = bassSum / 12;
      const midLvl  = midSum / 20;
      const highLvl = highSum / 12;

      canvasCtx.save();
      canvasCtx.lineCap = 'round';
      canvasCtx.lineJoin = 'round';

      const waves = [
        // Bass wave - Neon Purple
        {
          color: 'rgba(112, 0, 255, 0.75)',
          fillColorStart: 'rgba(112, 0, 255, 0.08)',
          level: bassLvl,
          speed: 1.1,
          phaseOffset: 0,
          frequency: 0.22,
          thickness: 3.2,
          shadowColor: 'rgba(112, 0, 255, 0.4)',
          ampFactor: H * 0.28
        },
        // Mid wave - Electric Blue
        {
          color: 'rgba(0, 114, 255, 0.70)',
          fillColorStart: 'rgba(0, 114, 255, 0.06)',
          level: midLvl,
          speed: 1.6,
          phaseOffset: Math.PI * 0.6,
          frequency: 0.28,
          thickness: 2.2,
          shadowColor: 'rgba(0, 114, 255, 0.35)',
          ampFactor: H * 0.24
        },
        // High wave - Neon Cyan
        {
          color: 'rgba(0, 240, 255, 0.65)',
          fillColorStart: 'rgba(0, 240, 255, 0.04)',
          level: highLvl,
          speed: 2.2,
          phaseOffset: Math.PI * 1.2,
          frequency: 0.36,
          thickness: 1.4,
          shadowColor: 'rgba(0, 240, 255, 0.3)',
          ampFactor: H * 0.18
        }
      ];

      waves.forEach(w => {
        const pts = [];
        const amp = w.ampFactor * (0.3 + w.level * 0.82);
        
        for (let i = 0; i < values.length; i++) {
          const x = (i / (values.length - 1)) * W;
          const wobble = Math.sin(clock * w.speed + i * w.frequency + w.phaseOffset) * amp;
          pts.push({ x, y: mid + wobble });
        }

        const fillGrad = canvasCtx.createLinearGradient(0, mid, 0, H);
        fillGrad.addColorStop(0, w.fillColorStart);
        fillGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        canvasCtx.fillStyle = fillGrad;

        canvasCtx.beginPath();
        pts.forEach(({ x, y }, i) => i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y));
        canvasCtx.lineTo(W, H);
        canvasCtx.lineTo(0, H);
        canvasCtx.closePath();
        canvasCtx.fill();

        canvasCtx.strokeStyle = w.color;
        canvasCtx.lineWidth = w.thickness;
        canvasCtx.shadowColor = w.shadowColor;
        canvasCtx.shadowBlur = 8;
        canvasCtx.beginPath();
        pts.forEach(({ x, y }, i) => i === 0 ? canvasCtx.moveTo(x, y) : canvasCtx.lineTo(x, y));
        canvasCtx.stroke();
      });

      canvasCtx.restore();
    }

    function drawMain(values, W, H) {
      if      (mode === 'mirror')       drawMirror(values, W, H);
      else if (mode === 'oscilloscope') drawOscilloscope(values, W, H);
      else if (mode === 'waterfall')    drawWaterfall(values, W, H);
      else if (mode === 'wave')         drawWave(values, W, H);
      else if (mode === 'dna')          drawDNA(values, W, H);
      else if (mode === 'particles')    drawParticles(values, W, H);
      else if (mode === 'tunnel')       drawTunnel(values, W, H);
      else if (mode === 'scanner')      drawScanner(values, W, H);
      else if (mode === 'medwaves')     drawMedWaves(values, W, H);
      else                              drawBars(values, W, H);
    }

    function getBarData() {
      const analyser = getAnalyser();
      if (analyser) {
        if (!freqBuf || freqBuf.length !== analyser.frequencyBinCount) {
          freqBuf = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(freqBuf);
        if (freqBuf.reduce((a, b) => a + b, 0) > 0) {
          for (let i = 0; i < BAR_COUNT; i++) {
            const start = Math.floor((i / BAR_COUNT) * 90);
            const end   = Math.max(start + 1, Math.floor(((i + 1) / BAR_COUNT) * 90));
            let sum = 0;
            for (let b = start; b < end; b++) sum += freqBuf[b];
            barBuf[i] = (sum / (end - start)) / 255;
          }
          return barBuf;
        }
      }
      for (let i = 0; i < BAR_COUNT; i++) barBuf[i] = fakeBar(clock, i, BAR_COUNT);
      return barBuf;
    }

    function updatePeaks(values) {
      for (let i = 0; i < BAR_COUNT; i++) {
        if (values[i] >= peaks[i]) {
          peaks[i] = values[i]; peakVel[i] = 0;
        } else {
          peakVel[i] += 0.0018;
          peaks[i] = Math.max(0, peaks[i] - peakVel[i]);
        }
      }
    }

    function drawIdle() {
      const dpr = window.devicePixelRatio || 1;
      const W   = canvas.width  / dpr;
      const H   = canvas.height / dpr;
      canvasCtx.clearRect(0, 0, W, H);
      onLevel(0.08);
      drawMain(idleData, W, H);
      drawMiniSignal(idleData);
    }

    function drawFrame() {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const W   = canvas.width  / dpr;
      const H   = canvas.height / dpr;
      const state = getState();

      if (!state.playing || !state.windowVisible) {
        running = false;
        if (!state.playing) drawIdle();
        return;
      }

      requestAnimationFrame(drawFrame);
      clock += 0.048;
      const values = state.muted ? idleData : getBarData();
      updatePeaks(values);
      onLevel(averageLevel(values));

      if (document.body.classList.contains('mini-mode')) {
        drawMiniSignal(values);
      } else {
        canvasCtx.clearRect(0, 0, W, H);
        drawMain(values, W, H);
      }
    }

    function start() {
      if (running) return;
      running = true;
      drawFrame();
    }

    function stop() {
      running = false;
    }

    function toggleMode() {
      const index = VISUALIZER_MODES.indexOf(mode);
      mode = VISUALIZER_MODES[(index + 1) % VISUALIZER_MODES.length];
      localStorage.setItem(storageKey, mode);
      showToast(VISUALIZER_LABELS[mode] || mode);
      wfallBuf = null; tunnelHistory = null; particles = [];
      const label = VISUALIZER_LABELS[mode] || mode;
      canvas.setAttribute('aria-label', `Audio-Visualizer, Modus: ${label}`);
      const state = getState();
      if (!state.playing || !running) drawIdle();
    }

    function resetMode() {
      mode = 'bars';
      localStorage.setItem(storageKey, mode);
      wfallBuf = null; tunnelHistory = null; particles = [];
      const label = VISUALIZER_LABELS[mode] || mode;
      canvas.setAttribute('aria-label', `Audio-Visualizer, Modus: ${label}`);
      drawIdle();
    }

    function getMode() {
      return mode;
    }

    function setMode(newMode) {
      if (!VISUALIZER_MODES.includes(newMode)) return;
      mode = newMode;
      localStorage.setItem(storageKey, mode);
      showToast(VISUALIZER_LABELS[mode] || mode);
      wfallBuf = null; tunnelHistory = null; particles = [];
      const label = VISUALIZER_LABELS[mode] || mode;
      canvas.setAttribute('aria-label', `Audio-Visualizer, Modus: ${label}`);
      const state = getState();
      if (!state.playing || !running) drawIdle();
    }

    let resizeTimer = null;
    function onWindowResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resize();
        resizeTimer = null;
      }, 100);
    }
    window.addEventListener('resize', onWindowResize);
    resize();

    return { start, stop, drawIdle, toggleMode, resetMode, getMode, setMode, resize };
  }

  exports.create            = create;
  exports.VISUALIZER_MODES  = VISUALIZER_MODES;
  exports.VISUALIZER_LABELS = VISUALIZER_LABELS;
})(typeof module !== 'undefined' ? module.exports : (window.WavelengthVisualizer = {}));
