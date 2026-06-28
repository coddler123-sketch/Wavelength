// Runs in both Node (require) and browser (sets window.WavelengthVisualizer).
(function (exports) {
  const BAR_COUNT = 44;
  const VISUALIZER_MODES = [
    'bars', 'oscilloscope',
    'wave', 'particles', 'tunnel', 'medwaves', 'neonpulse',
    'flexi', 'unchained', 'starburst', 'geiss', 'idiot',
    'tunnel3d', 'valley3d', 'matrix3d', 'mandala3d'
  ];
  const VISUALIZER_LABELS = {
    bars:        'Bars',
    oscilloscope:'Oscilloscope',
    wave:        'Waveform',
    particles:   'Particles',
    tunnel:      'Tunnel',
    medwaves:    'Wavelength Waves',
    neonpulse:   'Neon Pulse',
    flexi:       'Flexi',
    unchained:   'Unchained',
    starburst:   'Starburst',
    geiss:       'Geiss',
    idiot:       'Idiot',
    tunnel3d:    '3D Neon Tunnel (WebGL)',
    valley3d:    '3D Infinite Valley (WebGL)',
    matrix3d:    '3D Audio Matrix (WebGL)',
    mandala3d:   '3D Psychedelic Mandala (WebGL)',
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
    let idiotFlashes  = [];

    // WebGL state
    let webglCanvas   = null;
    let gl            = null;
    let positionBuffer = null;
    let webglPrograms = {}; // maps mode -> { program, uniforms: { u_resolution, u_time, u_bass, u_treble, u_frequencies } }

    // Dynamic theme colors
    let primaryColorVec = null;
    let secondaryColorVec = null;
    let tertiaryColorVec = null;
    let primaryColorStr = 'rgba(0, 240, 255, 1.0)';
    let secondaryColorStr = 'rgba(112, 0, 255, 1.0)';
    let tertiaryColorStr = 'rgba(255, 0, 153, 1.0)';

    const primaryColorStrAlpha = (a) => primaryColorVec ? `rgba(${Math.round(primaryColorVec[0]*255)}, ${Math.round(primaryColorVec[1]*255)}, ${Math.round(primaryColorVec[2]*255)}, ${a})` : `rgba(0, 240, 255, ${a})`;
    const secondaryColorStrAlpha = (a) => secondaryColorVec ? `rgba(${Math.round(secondaryColorVec[0]*255)}, ${Math.round(secondaryColorVec[1]*255)}, ${Math.round(secondaryColorVec[2]*255)}, ${a})` : `rgba(112, 0, 255, ${a})`;
    const tertiaryColorStrAlpha = (a) => tertiaryColorVec ? `rgba(${Math.round(tertiaryColorVec[0]*255)}, ${Math.round(tertiaryColorVec[1]*255)}, ${Math.round(tertiaryColorVec[2]*255)}, ${a})` : `rgba(255, 0, 153, ${a})`;

    // Interactive mouse state
    let mouseX = 0.5;
    let mouseY = 0.5;

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

      if (webglCanvas && gl) {
        const w = webglCanvas.offsetWidth, h = webglCanvas.offsetHeight;
        if (w > 0 && h > 0) {
          const targetW = Math.round(w * dpr);
          const targetH = Math.round(h * dpr);
          if (webglCanvas.width !== targetW || webglCanvas.height !== targetH) {
            webglCanvas.width = targetW;
            webglCanvas.height = targetH;
            gl.viewport(0, 0, targetW, targetH);
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
      grad.addColorStop(0, tertiaryColorStrAlpha(1.0));
      grad.addColorStop(1, primaryColorStrAlpha(1.0));

      miniCanvasCtx.fillStyle = grad;
      miniCanvasCtx.shadowColor = primaryColorStrAlpha(0.3);
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
      grad.addColorStop(0.0,  secondaryColorStrAlpha(1.0));
      grad.addColorStop(0.52, tertiaryColorStrAlpha(1.0));
      grad.addColorStop(1.0,  primaryColorStrAlpha(1.0));

      canvasCtx.save();
      canvasCtx.shadowColor = primaryColorStrAlpha(0.16);
      canvasCtx.shadowBlur  = 7;
      for (let i = 0; i < BAR_COUNT; i++) {
        const x    = i * (barW + gap);
        // Mirror: bass in center, highs on both sides
        const half = BAR_COUNT / 2;
        const si   = i < half ? Math.floor(half - 1 - i) : Math.floor(i - half);
        const barH = Math.max(2, values[si] * H * 0.84);
        const y    = H - barH;
        canvasCtx.fillStyle = grad;
        canvasCtx.beginPath();
        if (canvasCtx.roundRect) canvasCtx.roundRect(x, y, barW, barH, [1.5, 1.5, 0, 0]);
        else canvasCtx.rect(x, y, barW, barH);
        canvasCtx.fill();

        if (peaks[si] > 0.04) {
          const peakY = H - peaks[si] * H * 0.84 - 2.5;
          canvasCtx.shadowColor = primaryColorStrAlpha(0.55);
          canvasCtx.shadowBlur  = 5;
          canvasCtx.fillStyle   = 'rgba(255, 255, 255, 0.85)';
          canvasCtx.fillRect(x, peakY, barW, 1.5);
          canvasCtx.shadowBlur  = 7;
          canvasCtx.shadowColor = primaryColorStrAlpha(0.16);
        }
      }
      canvasCtx.restore();
    }

    function drawMirror(values, W, H) {
      const gap  = 2;
      const barW = (W - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      const mid  = H / 2;
      const grad = canvasCtx.createLinearGradient(0, H, 0, 0);
      grad.addColorStop(0.0,  secondaryColorStrAlpha(1.0));
      grad.addColorStop(0.52, tertiaryColorStrAlpha(1.0));
      grad.addColorStop(1.0,  primaryColorStrAlpha(1.0));

      canvasCtx.save();
      canvasCtx.shadowColor = primaryColorStrAlpha(0.18);
      canvasCtx.shadowBlur  = 6;
      canvasCtx.fillStyle   = grad;
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barW + gap);
        const h = Math.max(2, values[i] * mid * 0.88);
        canvasCtx.fillRect(x, mid - h, barW, h);
        canvasCtx.fillRect(x, mid,     barW, h);
      }
      canvasCtx.shadowBlur    = 0;
      canvasCtx.strokeStyle   = primaryColorStrAlpha(0.07);
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

    function drawFlexi(values, W, H) {
      const ctx = canvasCtx;
      const cx = W / 2, cy = H / 2;
      const bass = values.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      const baseR = Math.min(W, H) * (0.18 + bass * 0.12);
      const steps = 128;
      const n = values.length;

      // Build a circular-interpolated value ring so index wraps without a jump
      const ring = new Float32Array(steps);
      for (let i = 0; i < steps; i++) {
        const f  = (i / steps) * n;
        const lo = Math.floor(f) % n;
        const hi = (lo + 1) % n;
        ring[i]  = values[lo] * (1 - (f - Math.floor(f))) + values[hi] * (f - Math.floor(f));
      }

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, W, H);

      // Pre-compute blob points once per layer set
      function blobPoints(scale) {
        const pts = [];
        for (let i = 0; i < steps; i++) {
          const a    = (i / steps) * Math.PI * 2;
          const v    = ring[i];
          const warp = Math.sin(a * 3 + clock * 1.2) * 0.15 + Math.sin(a * 5 - clock * 0.8) * 0.1;
          const r    = (baseR + v * baseR * 0.9 + warp * baseR) * scale;
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        return pts;
      }

      for (let layer = 0; layer < 3; layer++) {
        const hue  = (clock * 30 + layer * 120) % 360;
        const pts  = blobPoints(1 - layer * 0.18);

        if (layer === 0) {
          // Fill: use closePath (fine for fill, no stroke seam)
          ctx.beginPath();
          pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
          ctx.closePath();
          const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * 1.8);
          fill.addColorStop(0, `hsla(${hue},70%,40%,0.18)`);
          fill.addColorStop(1, 'transparent');
          ctx.fillStyle = fill;
          ctx.fill();
        }

        // Stroke: repeat first point at end — no closePath, no join artifact
        ctx.beginPath();
        ctx.lineJoin = 'round';
        ctx.lineCap  = 'round';
        pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.lineTo(pts[0][0], pts[0][1]); // explicit close with lineTo
        ctx.strokeStyle = `hsla(${hue},90%,65%,${0.75 - layer * 0.2})`;
        ctx.shadowColor = `hsla(${hue},90%,65%,0.6)`;
        ctx.shadowBlur  = 12 + bass * 20;
        ctx.lineWidth   = 2.2 - layer * 0.5;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawUnchained(values, W, H) {
      const ctx  = canvasCtx;
      const cx   = W / 2, cy = H / 2;
      const size = Math.min(W, H);
      const n    = 96;
      const R0   = size * 0.2;   // inner corona circle radius
      const maxSpike = size * 0.28;

      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.fillRect(0, 0, W, H);

      // Draw base glow ring
      const bass = values.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      ctx.beginPath();
      ctx.arc(cx, cy, R0 + bass * size * 0.04, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${(clock * 18) % 360},80%,60%,0.25)`;
      ctx.lineWidth   = 2 + bass * 6;
      ctx.shadowColor = `hsla(${(clock * 18) % 360},80%,60%,0.4)`;
      ctx.shadowBlur  = 10 + bass * 20;
      ctx.stroke();

      // Spikes from corona perimeter outward — symmetric freq mapping
      const half = n / 2;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const a    = (i / n) * Math.PI * 2 + clock * 0.04; // slow drift
        const t    = i < half ? i / half : (n - i) / half; // 2-fold mirror
        const fi   = Math.min(Math.floor(t * values.length), values.length - 1);
        const v    = values[fi] || 0;
        const spike = v * maxSpike;
        const hue  = (i / n * 320 + clock * 18) % 360;
        const x0   = cx + Math.cos(a) * R0;
        const y0   = cy + Math.sin(a) * R0;
        const x1   = cx + Math.cos(a) * (R0 + spike);
        const y1   = cy + Math.sin(a) * (R0 + spike);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.strokeStyle = `hsla(${hue},100%,65%,${0.4 + v * 0.6})`;
        ctx.shadowColor = `hsla(${hue},100%,65%,0.7)`;
        ctx.shadowBlur  = 4 + v * 14;
        ctx.lineWidth   = 1.2 + v * 2;
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawStarburst(values, W, H) {
      const ctx = canvasCtx;
      const cx = W / 2, cy = H / 2;
      const n  = 64;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, W, H);
      const quarter = n / 4;
      for (let i = 0; i < n; i++) {
        const a   = (i / n) * Math.PI * 2;
        const pos = i % quarter;
        const t   = pos / quarter;
        const fi  = Math.min(Math.floor(t * values.length), values.length - 1);
        const v   = values[fi] || 0;
        const len = Math.min((0.06 + v * 0.38) * Math.min(W, H), Math.min(W, H) * 0.42);
        const hue = (pos / quarter * 280 + clock * 20) % 360;
        ctx.strokeStyle = `hsla(${hue},100%,68%,${0.5 + v * 0.5})`;
        ctx.shadowColor = `hsla(${hue},100%,68%,0.8)`;
        ctx.shadowBlur  = 6 + v * 16;
        ctx.lineWidth   = 1 + v * 2.5;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
        ctx.stroke();
      }
      ctx.restore();
    }

    function drawGeiss(values, W, H) {
      const ctx  = canvasCtx;
      const bass = values.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
      const mid  = values.slice(8, 24).reduce((a, b) => a + b, 0) / 16;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, 0, W, H);
      const cols = 8, rows = 6;
      for (let row = 0; row <= rows; row++) {
        for (let col = 0; col <= cols; col++) {
          const px  = (col / cols) * W;
          const py  = (row / rows) * H;
          const v   = values[Math.floor((col / cols) * values.length)] || 0;
          const hue = ((Math.sin(px / W * 3 + clock) * 120 + Math.cos(py / H * 2 - clock * 0.7) * 80 + clock * 50) % 360 + 360) % 360;
          const r   = (20 + v * 60 + bass * 30) * (0.6 + mid * 0.5);
          const g   = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, `hsla(${hue},100%,65%,${0.18 + v * 0.22})`);
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
      ctx.restore();
    }

    function drawIdiot(values, W, H) {
      const ctx  = canvasCtx;
      const bass = values.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, 0, W, H);
      if (bass > 0.55 && idiotFlashes.length < 14) {
        const hue = Math.random() * 360;
        idiotFlashes.push({
          x1: Math.random() * W, y1: Math.random() * H,
          x2: Math.random() * W, y2: Math.random() * H,
          hue, life: 1.0, width: 1 + Math.random() * 3,
        });
      }
      idiotFlashes = idiotFlashes.filter(f => f.life > 0);
      ctx.lineCap = 'round';
      for (const f of idiotFlashes) {
        ctx.strokeStyle = `hsla(${f.hue},100%,75%,${f.life})`;
        ctx.shadowColor = `hsla(${f.hue},100%,65%,${f.life * 0.8})`;
        ctx.shadowBlur  = 14 * f.life;
        ctx.lineWidth   = f.width * f.life;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
        f.life -= 0.04;
      }
      ctx.globalAlpha = bass * 0.55;
      const grd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.4);
      grd.addColorStop(0, `hsl(${(clock * 80) % 360},100%,75%)`);
      grd.addColorStop(1, 'transparent');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function drawNeonPulse(values, W, H) {
      const n   = 46;
      const gap = W / n;
      const mid = H / 2;
      const ctx = canvasCtx;
      ctx.save();
      ctx.lineCap = 'round';
      for (let j = 0; j < n; j++) {
        const f   = j / (n - 1);
        const val = values[Math.floor(f * (values.length - 1))] || 0;
        const hgt = val * mid * 0.92;
        const x   = j * gap + gap * 0.5;
        // Pink (#ff2d95) → Cyan (#21d3ee) across bars
        const hue = 320 - f * 200;
        const col = `hsl(${hue},95%,62%)`;
        ctx.strokeStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur  = 10 + val * 14;
        ctx.lineWidth   = Math.max(2, gap * 0.42);
        ctx.beginPath();
        ctx.moveTo(x, mid - hgt);
        ctx.lineTo(x, mid + hgt);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    function initWebGL() {
      if (webglCanvas) return true;
      try {
        const isAudit = window.location.search.includes('audit=1');
        if (isAudit) return false;

        webglCanvas = document.createElement('canvas');
        webglCanvas.id = 'visualizer-webgl';
        webglCanvas.className = canvas.className;
        webglCanvas.style.cssText = 'display: block; width: 100%; height: 100%; cursor: pointer; position: relative; z-index: 1; -webkit-app-region: no-drag;';
        webglCanvas.setAttribute('role', 'img');
        webglCanvas.setAttribute('aria-label', 'Audio-Visualizer, Modus: 3D Neon Tunnel (WebGL)');
        webglCanvas.setAttribute('title', canvas.getAttribute('title') || '');

        webglCanvas.addEventListener('click', () => {
          toggleMode();
        });
        webglCanvas.addEventListener('contextmenu', (e) => {
          const newEvent = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: e.clientX,
            clientY: e.clientY,
            button: 2
          });
          canvas.dispatchEvent(newEvent);
        });
        canvas.parentNode.insertBefore(webglCanvas, canvas.nextSibling);

        gl = webglCanvas.getContext('webgl', { antialias: true, alpha: false });
        if (!gl) {
          gl = webglCanvas.getContext('experimental-webgl', { antialias: true, alpha: false });
        }
        if (!gl) return false;

        const vsSource = `
          attribute vec2 position;
          void main() {
            gl_Position = vec4(position, 0.0, 1.0);
          }
        `;

        const fsTunnel3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          mat2 rot(float a) {
            float c = cos(a), s = sin(a);
            return mat2(c, -s, s, c);
          }

          float map(vec3 p) {
            return 1.8 - length(p.xy);
          }

          void main() {
            float shake = sin(u_time * 60.0) * u_bass * u_bass * 0.012;
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y) + vec2(shake, -shake);
            vec3 ro = vec3((u_mouse.x - 0.5) * 1.5, (u_mouse.y - 0.5) * 1.5, u_time * 2.0);
            vec3 rd = normalize(vec3(uv, 1.0));
            ro.x += sin(u_time * 0.5) * 0.2;
            ro.y += cos(u_time * 0.4) * 0.2;
            rd = vec3(rd.xy * rot(sin(u_time * 0.1) * 0.1), rd.z);
            
            float t = 0.0;
            float max_d = 24.0;
            int steps = 0;
            
            for (int i = 0; i < 48; i++) {
              vec3 p = ro + rd * t;
              float d = map(p);
              if (d < 0.005 || t > max_d) {
                steps = i;
                break;
              }
              t += d * 0.95;
            }
            
            vec3 color = vec3(0.0);
            if (t < max_d) {
              vec3 p = ro + rd * t;
              float waveX = sin(p.z * 0.25 + u_time * 0.5) * 0.3;
              float waveY = cos(p.z * 0.22 + u_time * 0.4) * 0.25;
              vec3 wp = p;
              wp.x += waveX;
              wp.y += waveY;
              
              float angle = atan(wp.y, wp.x);
              float ringLine = sin(p.z * 3.0 - u_time * 2.5);
              float spiralLine = sin(angle * 6.0 + p.z * 0.4);
              float grid = smoothstep(0.7, 0.96, ringLine) + smoothstep(0.7, 0.96, spiralLine);
              
              float freqVal = 0.0;
              int bandIdx = int(mod(abs(p.z * 1.2), 16.0));
              if (bandIdx == 0) freqVal = u_frequencies[0];
              else if (bandIdx == 1) freqVal = u_frequencies[1];
              else if (bandIdx == 2) freqVal = u_frequencies[2];
              else if (bandIdx == 3) freqVal = u_frequencies[3];
              else if (bandIdx == 4) freqVal = u_frequencies[4];
              else if (bandIdx == 5) freqVal = u_frequencies[5];
              else if (bandIdx == 6) freqVal = u_frequencies[6];
              else if (bandIdx == 7) freqVal = u_frequencies[7];
              else if (bandIdx == 8) freqVal = u_frequencies[8];
              else if (bandIdx == 9) freqVal = u_frequencies[9];
              else if (bandIdx == 10) freqVal = u_frequencies[10];
              else if (bandIdx == 11) freqVal = u_frequencies[11];
              else if (bandIdx == 12) freqVal = u_frequencies[12];
              else if (bandIdx == 13) freqVal = u_frequencies[13];
              else if (bandIdx == 14) freqVal = u_frequencies[14];
              else if (bandIdx == 15) freqVal = u_frequencies[15];

              float colorPos = sin(p.z * 0.1) * 0.5 + 0.5;
              vec3 neonBase = mix(u_primary_color, u_secondary_color, colorPos);
              neonBase = mix(neonBase, u_tertiary_color, freqVal * 0.4);
              
              float glow = (0.2 + freqVal * 1.6) * (0.25 + grid * 0.75);
              color = neonBase * glow;
              
              float ridges = smoothstep(0.9, 0.96, ringLine);
              color += vec3(0.8, 0.95, 1.0) * ridges * u_bass * 0.4;
              
              float fog = 1.0 - (t / max_d);
              color *= fog * fog;
              color += neonBase * (float(steps) * 0.012) * (0.4 + u_bass * 0.6);
            } else {
              vec3 bgCyan = u_primary_color * 0.15 * (0.4 + u_bass * 0.6);
              vec3 bgPurple = u_secondary_color * 0.12 * (0.4 + u_treble * 0.6);
              color = mix(bgCyan, bgPurple, clamp(uv.x * 0.5 + 0.5, 0.0, 1.0));
              color += vec3(0.5, 0.85, 1.0) * (0.012 / (length(uv) + 0.03)) * (0.5 + u_bass * 0.5);
            }
            color = pow(max(color, vec3(0.0)), vec3(1.2));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        const fsHorizon3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          mat2 rot(float a) {
            float c = cos(a), s = sin(a);
            return mat2(c, -s, s, c);
          }

          void main() {
            float shake = sin(u_time * 60.0) * u_bass * u_bass * 0.012;
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y) + vec2(shake, -shake);
            vec3 ro = vec3(0.0, 0.2, 0.0);
            vec3 rd = normalize(vec3(uv, 0.8));
            rd = vec3(rd.xy * rot((u_mouse.x - 0.5) * 0.5), rd.z);
            
            vec3 color = vec3(0.0);
            
            if (rd.y < -0.02) {
              float t = (-0.5 - ro.y) / rd.y;
              vec3 p = ro + rd * t;
              float ripple = sin(p.x * 2.0 + p.z * 0.4 - u_time * 3.5) * (0.04 + u_bass * 0.16) * exp(-p.z * 0.08);
              float lineX = sin(p.x * 1.5);
              float lineZ = sin(p.z * 1.2 - u_time * 4.0 + ripple * 4.0);
              float grid = smoothstep(0.9, 0.98, abs(lineX)) + smoothstep(0.9, 0.98, abs(lineZ));
              
              vec3 gridColor = mix(u_primary_color, u_secondary_color, clamp(p.z * 0.05, 0.0, 1.0));
              
              float glow = (0.25 + u_bass * 1.2) * (0.3 + grid * 0.7);
              color = gridColor * glow;
              
              float fog = clamp(1.0 - (t / 30.0), 0.0, 1.0);
              color *= fog * fog;
            } else {
              color = mix(u_secondary_color * 0.12, u_tertiary_color * 0.15, clamp(uv.y * 2.0, 0.0, 1.0));
              
              float starNoise = sin(uv.x * 123.4) * cos(uv.y * 345.6);
              if (starNoise > 0.994) {
                float starPulse = sin(u_time * 3.0 + starNoise * 10.0) * 0.5 + 0.5;
                color += vec3(0.8, 0.9, 1.0) * starPulse * (0.3 + u_treble * 0.7);
              }
              
              vec2 sunCenter = vec2(0.0, 0.12);
              float distToSun = length(uv - sunCenter);
              if (distToSun < 0.25) {
                float yPos = uv.y - sunCenter.y;
                float mask = step(0.04 + clamp(yPos * 0.6, 0.0, 0.18), mod(yPos * 30.0, 1.0));
                vec3 sunColorTop = u_primary_color;
                vec3 sunColorBot = u_tertiary_color;
                vec3 sunColor = mix(sunColorBot, sunColorTop, (yPos / 0.25) * 0.5 + 0.5);
                color = mix(color, sunColor * (1.0 + u_bass * 0.3), mask * (1.0 - smoothstep(0.2, 0.25, distToSun)));
              }
              
              float horizonGlow = exp(-abs(uv.y + 0.02) * 20.0);
              color += u_tertiary_color * horizonGlow * (0.5 + u_bass * 0.5);
            }
            
            color = pow(max(color, vec3(0.0)), vec3(1.15));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        const fsOrb3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          float noise(vec3 p) {
            return sin(p.x * 3.0 + u_time * 1.8) * cos(p.y * 2.8 - u_time * 1.4) * sin(p.z * 3.2 + u_time * 1.1) * 0.33 +
                   sin(p.x * 6.0 - u_time * 2.5) * cos(p.y * 5.5 + u_time * 2.0) * sin(p.z * 6.5 - u_time * 1.8) * 0.17;
          }

          float map(vec3 p) {
            vec3 center = vec3((u_mouse.x - 0.5) * 1.6, (u_mouse.y - 0.5) * 1.2, 0.0);
            float d = length(p - center) - 0.95;
            float n = noise(p * (1.2 + u_bass * 0.4));
            d += n * (0.06 + u_bass * 0.26);
            return d;
          }

          void main() {
            float shake = sin(u_time * 60.0) * u_bass * u_bass * 0.012;
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y) + vec2(shake, -shake);
            vec3 ro = vec3(0.0, 0.0, -3.0);
            vec3 rd = normalize(vec3(uv, 1.2));
            
            float t = 0.0;
            float max_d = 5.0;
            int steps = 0;
            
            for (int i = 0; i < 40; i++) {
              vec3 p = ro + rd * t;
              float d = map(p);
              if (d < 0.005 || t > max_d) {
                steps = i;
                break;
              }
              t += d * 0.85;
            }
            
            vec3 color = vec3(0.0);
            
            if (t < max_d) {
              vec3 p = ro + rd * t;
              vec2 eps = vec2(0.005, 0.0);
              vec3 normal = normalize(vec3(
                map(p + eps.xyy) - map(p - eps.xyy),
                map(p + eps.yxy) - map(p - eps.yxy),
                map(p + eps.yyx) - map(p - eps.yyx)
              ));
              
              float Fresnel = pow(1.0 - max(0.0, dot(normal, -rd)), 3.0);
              
              vec3 surfaceColor = mix(u_secondary_color, u_primary_color, noise(p * 1.5) * 0.5 + 0.5);
              surfaceColor = mix(surfaceColor, u_tertiary_color, Fresnel);
              
              float filaments = smoothstep(0.4, 0.95, sin(p.x * 12.0 + u_time * 4.0) * cos(p.y * 10.0 - u_time * 3.0) * sin(p.z * 14.0 + u_time * 2.0));
              color = surfaceColor * (0.2 + Fresnel * 0.8) + vec3(1.0, 0.95, 0.8) * filaments * (0.3 + u_bass * 0.7);
              color += surfaceColor * (float(steps) * 0.015);
            } else {
              vec3 spaceCyan = u_primary_color * 0.08 * (0.5 + u_bass * 0.5);
              vec3 spaceMagenta = u_secondary_color * 0.07 * (0.5 + u_treble * 0.5);
              color = mix(spaceCyan, spaceMagenta, uv.y * 0.5 + 0.5);
            }
            
            vec3 center = vec3((u_mouse.x - 0.5) * 1.6, (u_mouse.y - 0.5) * 1.2, 0.0);
            float halo = exp(-abs(length(uv - center.xy) - 0.7) * 4.5);
            vec3 haloColor = mix(u_primary_color, u_secondary_color, sin(u_time * 0.5) * 0.5 + 0.5);
            color += haloColor * halo * (0.12 + u_bass * 0.4) * (0.01 / (abs(length(uv - center.xy) - 0.72) + 0.01));
            
            color = pow(max(color, vec3(0.0)), vec3(1.15));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        const fsWarp3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          float hash(vec3 p) {
            vec3 q = fract(p * vec3(443.8975, 397.2973, 491.1871));
            q += dot(q.xyz, q.yzx + 19.19);
            return fract(q.x * q.y * q.z);
          }

          void main() {
            float shake = sin(u_time * 60.0) * u_bass * u_bass * 0.012;
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y) + vec2(shake, -shake);
            
            float speed = u_time * (2.2 + u_bass * 4.5);
            float stretch = 0.02 + u_bass * 0.15;
            vec3 color = vec3(0.0);
            
            vec2 center = (u_mouse - 0.5) * 0.8;
            
            for (float layer = 1.0; layer <= 3.0; layer++) {
              float z = fract(0.123 * layer - speed * 0.05);
              float fade = smoothstep(0.0, 0.2, z) * smoothstep(1.0, 0.8, z);
              
              vec2 p = (uv - center) * z * 8.0;
              vec2 gridId = floor(p);
              vec2 gridUv = fract(p) - 0.5;
              
              float seed = hash(vec3(gridId, layer * 17.3));
              
              if (seed > 0.85) {
                vec2 offset = vec2(hash(vec3(gridId, 1.1)), hash(vec3(gridId, 2.2))) - 0.5;
                vec2 dir = normalize(gridId + offset);
                float len = stretch * (1.0 - z);
                vec2 localP = gridUv - offset;
                float proj = clamp(dot(localP, dir), -len, len);
                float distToStreak = length(localP - dir * proj);
                
                float brightness = (0.0015 / (distToStreak + 0.0015)) * fade;
                vec3 starColor = mix(u_primary_color, u_secondary_color, hash(vec3(gridId, 9.9)));
                starColor = mix(starColor, vec3(1.0, 1.0, 1.0), seed * 0.5);
                
                int bandIdx = int(mod(seed * 100.0, 16.0));
                float fVal = 0.0;
                if (bandIdx == 0) fVal = u_frequencies[0];
                else if (bandIdx == 1) fVal = u_frequencies[1];
                else if (bandIdx == 2) fVal = u_frequencies[2];
                else if (bandIdx == 3) fVal = u_frequencies[3];
                else if (bandIdx == 4) fVal = u_frequencies[4];
                else if (bandIdx == 5) fVal = u_frequencies[5];
                else if (bandIdx == 6) fVal = u_frequencies[6];
                else if (bandIdx == 7) fVal = u_frequencies[7];
                else if (bandIdx == 8) fVal = u_frequencies[8];
                else if (bandIdx == 9) fVal = u_frequencies[9];
                else if (bandIdx == 10) fVal = u_frequencies[10];
                else if (bandIdx == 11) fVal = u_frequencies[11];
                else if (bandIdx == 12) fVal = u_frequencies[12];
                else if (bandIdx == 13) fVal = u_frequencies[13];
                else if (bandIdx == 14) fVal = u_frequencies[14];
                else if (bandIdx == 15) fVal = u_frequencies[15];

                color += starColor * brightness * (0.8 + fVal * 1.5);
              }
            }
            
            color += u_primary_color * (0.015 / (length(uv - center) + 0.04)) * (0.5 + u_bass * 0.5);
            color = pow(max(color, vec3(0.0)), vec3(1.2));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        const fsValley3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          mat2 rot(float a) {
            float c = cos(a), s = sin(a);
            return mat2(c, -s, s, c);
          }

          float height(vec2 p) {
            float canyon = smoothstep(0.15, 0.85, abs(p.x));
            float h = (sin(p.x * 2.0) * cos(p.y * 1.2) * 0.35 + sin(p.x * 4.5) * cos(p.y * 2.8) * 0.16) * canyon;
            float freq = p.x < 0.0 ? u_bass : u_treble;
            h += canyon * freq * 0.42 * (sin(p.y * 4.0 - u_time * 2.5) * 0.5 + 0.5);
            return h;
          }

          float map(vec3 p) {
            return p.y - height(p.xz);
          }

          void main() {
            float shake = sin(u_time * 60.0) * u_bass * u_bass * 0.012;
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y) + vec2(shake, -shake);
            
            vec3 ro = vec3(0.0, 0.28, u_time * 2.0);
            vec3 rd = normalize(vec3(uv, 0.8));
            rd = vec3(rd.xy * rot((u_mouse.x - 0.5) * 0.5), rd.z);
            rd.y += (u_mouse.y - 0.5) * 0.3;
            
            float t = 0.0;
            float max_d = 20.0;
            int steps = 0;
            
            for (int i = 0; i < 40; i++) {
              vec3 p = ro + rd * t;
              float d = map(p);
              if (d < 0.005 || t > max_d) {
                steps = i;
                break;
              }
              t += d * 0.9;
            }
            
            vec3 color = vec3(0.0);
            if (t < max_d) {
              vec3 p = ro + rd * t;
              float grid = smoothstep(0.9, 0.98, sin(p.x * 3.0)) + smoothstep(0.9, 0.98, sin(p.z * 3.0));
              
              vec3 canyonColor = mix(u_secondary_color * 0.3, u_tertiary_color * 0.4, p.y + 0.5);
              vec3 gridColor = u_primary_color * (0.3 + grid * 0.7) * (0.8 + u_bass * 0.8);
              color = mix(canyonColor, gridColor, grid);
              
              float fog = clamp(1.0 - (t / max_d), 0.0, 1.0);
              color *= fog * fog;
            } else {
              color = mix(u_secondary_color * 0.1, u_tertiary_color * 0.12, clamp(uv.y * 1.5, 0.0, 1.0));
            }
            
            color = pow(max(color, vec3(0.0)), vec3(1.15));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        const fsMatrix3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          mat2 rot(float a) {
            float c = cos(a), s = sin(a);
            return mat2(c, -s, s, c);
          }

          float box(vec3 p, vec3 b) {
            vec3 d = abs(p) - b;
            return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
          }

          float map(vec3 p) {
            vec3 q = p;
            q.xz = mod(p.xz, 0.5) - 0.25;
            vec2 id = floor(p.xz / 0.5);
            int idx = int(mod(abs(id.x) + abs(id.y), 16.0));
            
            float f = 0.0;
            if (idx == 0) f = u_frequencies[0];
            else if (idx == 1) f = u_frequencies[1];
            else if (idx == 2) f = u_frequencies[2];
            else if (idx == 3) f = u_frequencies[3];
            else if (idx == 4) f = u_frequencies[4];
            else if (idx == 5) f = u_frequencies[5];
            else if (idx == 6) f = u_frequencies[6];
            else if (idx == 7) f = u_frequencies[7];
            else if (idx == 8) f = u_frequencies[8];
            else if (idx == 9) f = u_frequencies[9];
            else if (idx == 10) f = u_frequencies[10];
            else if (idx == 11) f = u_frequencies[11];
            else if (idx == 12) f = u_frequencies[12];
            else if (idx == 13) f = u_frequencies[13];
            else if (idx == 14) f = u_frequencies[14];
            else if (idx == 15) f = u_frequencies[15];

            float h = 0.05 + f * 0.65;
            return box(q - vec3(0.0, -0.6 + h, 0.0), vec3(0.12, h, 0.12));
          }

          void main() {
            float shake = sin(u_time * 60.0) * u_bass * u_bass * 0.012;
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y) + vec2(shake, -shake);
            
            vec3 ro = vec3(0.0, 0.8, u_time * 0.6);
            vec3 rd = normalize(vec3(uv.x, uv.y - 0.28, 0.95));
            rd = vec3(rd.xy * rot((u_mouse.x - 0.5) * 0.5), rd.z);
            rd.y += (u_mouse.y - 0.5) * 0.35;
            
            float t = 0.0;
            float max_d = 16.0;
            int steps = 0;
            
            for (int i = 0; i < 40; i++) {
              vec3 p = ro + rd * t;
              float d = map(p);
              if (d < 0.005 || t > max_d) {
                steps = i;
                break;
              }
              t += d * 0.9;
            }
            
            vec3 color = vec3(0.0);
            if (t < max_d) {
              vec3 p = ro + rd * t;
              vec3 gridColor = mix(u_primary_color, u_secondary_color, sin(p.z * 0.5) * 0.5 + 0.5);
              color = gridColor * (0.3 + float(steps) * 0.03) * (0.5 + u_bass * 0.5);
              
              float fog = clamp(1.0 - (t / max_d), 0.0, 1.0);
              color *= fog * fog;
            } else {
              color = mix(u_secondary_color * 0.07, u_tertiary_color * 0.08, clamp(uv.y * 1.5, 0.0, 1.0));
            }
            
            color = pow(max(color, vec3(0.0)), vec3(1.15));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        const fsMandala3D = `
          precision mediump float;
          uniform vec2 u_resolution;
          uniform float u_time;
          uniform float u_bass;
          uniform float u_treble;
          uniform float u_frequencies[16];
          uniform vec3 u_primary_color;
          uniform vec3 u_secondary_color;
          uniform vec3 u_tertiary_color;
          uniform vec2 u_mouse;

          mat2 rot(float a) {
            float c = cos(a), s = sin(a);
            return mat2(c, -s, s, c);
          }

          void main() {
            vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / max(1.0, u_resolution.y);

            vec2 center = (u_mouse - 0.5) * 0.5;
            vec2 p = uv - center;

            float r = length(p);
            float a = atan(p.y, p.x);

            float segments = 8.0;
            a = mod(a, 2.0 * 3.14159 / segments) - 3.14159 / segments;
            p = vec2(cos(a), sin(a)) * r;

            for (int i = 0; i < 4; i++) {
              p = abs(p) - 0.25 - u_bass * 0.03;
              p = p * (1.4 + u_treble * 0.08);
              p = p * rot(u_time * 0.07 + float(i) * 0.1);
            }
            
            float d = length(p) - 0.14;
            
            vec3 neonColor = mix(u_primary_color, u_tertiary_color, sin(r * 4.0 - u_time) * 0.5 + 0.5);
            vec3 color = neonColor * (0.012 / abs(d)) + u_secondary_color * (0.15 + u_bass * 0.6) * (1.0 - smoothstep(0.2, 0.6, r));
            
            color = pow(max(color, vec3(0.0)), vec3(1.2));
            gl_FragColor = vec4(color, 1.0);
          }
        `;

        function compileShader(source, type) {
          const s = gl.createShader(type);
          gl.shaderSource(s, source);
          gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(s);
            gl.deleteShader(s);
            throw new Error(`Shader compile failed: ${info}`);
          }
          return s;
        }

        function compileProgram(fsSource) {
          const vs = compileShader(vsSource, gl.VERTEX_SHADER);
          const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
          const program = gl.createProgram();
          gl.attachShader(program, vs);
          gl.attachShader(program, fs);
          gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            throw new Error(`Program link failed: ${info}`);
          }
          return {
            program,
            uniforms: {
              u_resolution:      gl.getUniformLocation(program, 'u_resolution'),
              u_time:            gl.getUniformLocation(program, 'u_time'),
              u_bass:            gl.getUniformLocation(program, 'u_bass'),
              u_treble:          gl.getUniformLocation(program, 'u_treble'),
              u_frequencies:     gl.getUniformLocation(program, 'u_frequencies'),
              u_primary_color:   gl.getUniformLocation(program, 'u_primary_color'),
              u_secondary_color: gl.getUniformLocation(program, 'u_secondary_color'),
              u_tertiary_color:  gl.getUniformLocation(program, 'u_tertiary_color'),
              u_mouse:           gl.getUniformLocation(program, 'u_mouse')
            }
          };
        }

        webglPrograms = {};
        webglPrograms.tunnel3d  = compileProgram(fsTunnel3D);
        webglPrograms.valley3d  = compileProgram(fsValley3D);
        webglPrograms.matrix3d  = compileProgram(fsMatrix3D);
        webglPrograms.mandala3d = compileProgram(fsMandala3D);

        const vertices = new Float32Array([
          -1, -1,
           1, -1,
          -1,  1,
          -1,  1,
           1, -1,
           1,  1,
        ]);

        positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        resize();
        return true;
      } catch (err) {
        if (webglCanvas) {
          try { webglCanvas.remove(); } catch (e) {}
          webglCanvas = null;
        }
        gl = null;
        webglPrograms = {};
        Promise.reject(err);
        return false;
      }
    }

    function syncWebGLSize() {
      if (webglCanvas && canvas && gl) {
        if (webglCanvas.width !== canvas.width || webglCanvas.height !== canvas.height) {
          webglCanvas.width = canvas.width;
          webglCanvas.height = canvas.height;
          gl.viewport(0, 0, canvas.width, canvas.height);
        }
      }
    }

    function drawWebGL(values, W, H) {
      if (!initWebGL()) {
        drawBars(values, W, H);
        return;
      }

      syncWebGLSize();

      if (canvas.style.display !== 'none') {
        canvas.style.display = 'none';
      }
      if (webglCanvas && webglCanvas.style.display !== 'block') {
        webglCanvas.style.display = 'block';
      }

      const label = VISUALIZER_LABELS[mode] || mode;
      if (webglCanvas) {
        webglCanvas.setAttribute('aria-label', `Audio-Visualizer, Modus: ${label}`);
      }

      let bass = 0.0;
      let treble = 0.0;
      for (let i = 0; i < 8; i++) bass += values[i] || 0;
      bass /= 8;
      for (let i = BAR_COUNT - 8; i < BAR_COUNT; i++) treble += values[i] || 0;
      treble /= 8;

      const freq16 = new Float32Array(16);
      for (let i = 0; i < 16; i++) {
        const start = Math.floor((i / 16) * BAR_COUNT);
        const end = Math.floor(((i + 1) / 16) * BAR_COUNT);
        let sum = 0;
        for (let j = start; j < end; j++) sum += values[j] || 0;
        freq16[i] = sum / Math.max(1, end - start);
      }

      const progInfo = webglPrograms[mode];
      if (!progInfo) return;

      gl.useProgram(progInfo.program);

      // Re-bind the buffer and re-enable vertex attribute pointers to prevent losing state
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      const posAttr = gl.getAttribLocation(progInfo.program, 'position');
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(progInfo.uniforms.u_resolution, webglCanvas.width, webglCanvas.height);
      gl.uniform1f(progInfo.uniforms.u_time, clock);
      gl.uniform1f(progInfo.uniforms.u_bass, bass);
      gl.uniform1f(progInfo.uniforms.u_treble, treble);
      gl.uniform1fv(progInfo.uniforms.u_frequencies, freq16);

      if (progInfo.uniforms.u_primary_color) {
        gl.uniform3fv(progInfo.uniforms.u_primary_color, primaryColorVec || [0.0, 0.94, 1.0]);
      }
      if (progInfo.uniforms.u_secondary_color) {
        gl.uniform3fv(progInfo.uniforms.u_secondary_color, secondaryColorVec || [0.44, 0.0, 1.0]);
      }
      if (progInfo.uniforms.u_tertiary_color) {
        gl.uniform3fv(progInfo.uniforms.u_tertiary_color, tertiaryColorVec || [1.0, 0.0, 0.6]);
      }
      if (progInfo.uniforms.u_mouse) {
        gl.uniform2f(progInfo.uniforms.u_mouse, mouseX, mouseY);
      }

      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    function drawMain(values, W, H) {
      const isWebGL = ['tunnel3d', 'valley3d', 'matrix3d', 'mandala3d'].includes(mode);
      if (!isWebGL) {
        if (canvas.style.display === 'none') {
          canvas.style.display = 'block';
        }
        if (webglCanvas && webglCanvas.style.display !== 'none') {
          webglCanvas.style.display = 'none';
        }
      }

      if      (mode === 'mirror')       drawMirror(values, W, H);
      else if (mode === 'oscilloscope') drawOscilloscope(values, W, H);
      else if (mode === 'waterfall')    drawWaterfall(values, W, H);
      else if (mode === 'wave')         drawWave(values, W, H);
      else if (mode === 'particles')    drawParticles(values, W, H);
      else if (mode === 'tunnel')       drawTunnel(values, W, H);
      else if (mode === 'medwaves')     drawMedWaves(values, W, H);
      else if (mode === 'neonpulse')    drawNeonPulse(values, W, H);
      else if (mode === 'flexi')        drawFlexi(values, W, H);
      else if (mode === 'unchained')    drawUnchained(values, W, H);
      else if (mode === 'starburst')    drawStarburst(values, W, H);
      else if (mode === 'geiss')        drawGeiss(values, W, H);
      else if (mode === 'idiot')        drawIdiot(values, W, H);
      else if (isWebGL)                 drawWebGL(values, W, H);
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

    function setColors(c1, c2, c3) {
      if (!c1) {
        primaryColorVec = null;
        secondaryColorVec = null;
        tertiaryColorVec = null;
        primaryColorStr = 'rgba(0, 240, 255, 1.0)';
        secondaryColorStr = 'rgba(112, 0, 255, 1.0)';
        tertiaryColorStr = 'rgba(255, 0, 153, 1.0)';
      } else {
        primaryColorVec = [c1[0] / 255, c1[1] / 255, c1[2] / 255];
        secondaryColorVec = [c2[0] / 255, c2[1] / 255, c2[2] / 255];
        tertiaryColorVec = [c3[0] / 255, c3[1] / 255, c3[2] / 255];
        primaryColorStr = `rgba(${c1[0]}, ${c1[1]}, ${c1[2]}, 1.0)`;
        secondaryColorStr = `rgba(${c2[0]}, ${c2[1]}, ${c2[2]}, 1.0)`;
        tertiaryColorStr = `rgba(${c3[0]}, ${c3[1]}, ${c3[2]}, 1.0)`;
      }
      const state = getState();
      if (!state.playing || !running) drawIdle();
    }

    return { start, stop, drawIdle, toggleMode, resetMode, getMode, setMode, resize, setColors };
  }

  exports.create            = create;
  exports.VISUALIZER_MODES  = VISUALIZER_MODES;
  exports.VISUALIZER_LABELS = VISUALIZER_LABELS;
})(typeof module !== 'undefined' ? module.exports : (window.WavelengthVisualizer = {}));
