// GLSL shader sources for the WebGL visualizer modes.
// Runs in both Node (require) and browser (sets window.WavelengthShaders).
/* global module, window */
(function (exports) {
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

  exports.vsSource = vsSource;
  exports.fsTunnel3D = fsTunnel3D;
  exports.fsHorizon3D = fsHorizon3D;
  exports.fsOrb3D = fsOrb3D;
  exports.fsWarp3D = fsWarp3D;
  exports.fsValley3D = fsValley3D;
  exports.fsMatrix3D = fsMatrix3D;
  exports.fsMandala3D = fsMandala3D;
})(typeof module !== 'undefined' ? module.exports : (window.WavelengthShaders = {}));
