import {
  AdditiveBlending, AmbientLight, BackSide, BoxGeometry, BufferGeometry, CatmullRomCurve3,
  Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, DynamicDrawUsage,
  Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh, Material, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, OctahedronGeometry, PerspectiveCamera,
  QuadraticBezierCurve3, Scene, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3,
  WebGLRenderer,
} from 'three';

type Effect = { group: Group; update: (seconds: number, delta: number) => boolean; dispose?: () => void };
type Rect = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};

function release(group: Group): void {
  const materials = new Set<Material>();
  group.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach((m) => materials.add(m));
  });
  for (const material of materials) material.dispose();
  group.removeFromParent();
}

/** Shared WebGL 3D overlay for all spells, sigil constructs, combat strikes, and abilities. */
export class BattleEffects3D {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 1, 4000);
  private readonly effects = new Map<string, Effect>();
  private frame = 0;
  private previous = 0;
  private width = 0;
  private height = 0;
  private serial = 0;
  private lost = false;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor() {
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.domElement.className = 'battle-effects-3d';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.hidden = true;
    document.body.append(this.renderer.domElement);

    this.camera.position.set(0, 0, 1000);
    this.scene.add(new AmbientLight('#b8d4c8', 1.5));
    const key = new DirectionalLight('#ffe2b5', 2.65);
    key.position.set(-260, 440, 640);
    this.scene.add(key);
    const rim = new DirectionalLight('#8ee69b', 1.25);
    rim.position.set(360, -180, 300);
    this.scene.add(rim);

    this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      this.clear();
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.lost = false;
    });
    this.resize();
  }

  private resize(): void {
    if (this.width === window.innerWidth && this.height === window.innerHeight) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    // At z = 0, 1 world unit equals 1 CSS pixel.
    this.camera.fov = (2 * Math.atan(this.height / 2000) * 180) / Math.PI;
    this.camera.aspect = this.width / Math.max(1, this.height);
    this.camera.updateProjectionMatrix();
  }

  private center(rect: Rect, z = 0): Vector3 {
    return new Vector3(
      rect.left + rect.width / 2 - window.innerWidth / 2,
      window.innerHeight / 2 - rect.top - rect.height / 2,
      z,
    );
  }

  private add(key: string, effect: Effect): void {
    this.remove(key);
    this.scene.add(effect.group);
    this.effects.set(key, effect);
    this.renderer.domElement.hidden = false;
    if (!this.frame && !this.lost) this.frame = requestAnimationFrame(this.draw);
  }

  private remove(key: string): void {
    const effect = this.effects.get(key);
    if (!effect) return;
    effect.dispose?.();
    release(effect.group);
    this.effects.delete(key);
  }

  private draw = (now: number): void => {
    this.frame = 0;
    this.resize();
    const delta = Math.min(0.05, this.previous ? (now - this.previous) / 1000 : 0.016);
    this.previous = now;
    for (const [key, effect] of this.effects) {
      if (effect.update(now / 1000, delta)) this.remove(key);
    }
    if (!this.lost) this.renderer.render(this.scene, this.camera);
    if (this.effects.size && !this.lost) {
      this.frame = requestAnimationFrame(this.draw);
    } else {
      this.renderer.domElement.hidden = true;
      this.previous = 0;
    }
  };

  clear(): void {
    for (const key of [...this.effects.keys()]) this.remove(key);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (!this.lost) this.renderer.clear();
    this.renderer.domElement.hidden = true;
  }

  /**
   * Large, high-impact 3D Fireball sphere that emerges from inside the spell card,
   * arcs across the arena with a blazing tail and 96 3D flame particles, and detonates
   * with a 3D shockwave ring and magma burst on impact.
   */
  fireball(source: Rect, target: () => HTMLElement | null): Promise<void> {
    if (this.lost) return Promise.resolve();
    const initialTarget = target();
    if (!initialTarget) return Promise.resolve();

    const group = new Group();
    const flameGroup = new Group();
    group.add(flameGroup);

    const radius = Math.max(26, Math.min(44, source.width * 0.42));

    // Inner molten 3D sphere with rolling magma veins and intense Fresnel rim
    const coreMaterial = new ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vec3 p = position;
          float wave = sin(p.y * 6.5 - time * 10.0) * 0.055 + cos(p.x * 5.5 + time * 8.0) * 0.04;
          p *= 1.0 + wave;
          vPos = p;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPos;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }
        void main() {
          vec3 n = normalize(vNormal);
          vec3 q = normalize(vPos) * 3.4 + vec3(0.0, -time * 4.4, time * 1.9);
          float f = noise(q) * 0.65 + noise(q * 2.4 - time * 2.8) * 0.35;
          float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 1.65);
          vec3 darkRed = vec3(0.65, 0.04, 0.01);
          vec3 brightOrange = vec3(1.0, 0.38, 0.02);
          vec3 hotGold = vec3(1.0, 0.82, 0.24);
          vec3 whiteHot = vec3(1.0, 0.98, 0.88);
          vec3 col = mix(darkRed, brightOrange, smoothstep(0.16, 0.58, f));
          col = mix(col, hotGold, smoothstep(0.42, 0.78, f));
          col = mix(col, whiteHot, smoothstep(0.68, 0.94, f) * (1.0 - rim * 0.45));
          col += vec3(1.0, 0.48, 0.06) * rim * 0.95;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const coreMesh = new Mesh(new SphereGeometry(radius * 0.78, 30, 22), coreMaterial);
    flameGroup.add(coreMesh);

    // Outer volumetric 3D fire corona
    const coronaMaterial = new ShaderMaterial({
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { time: { value: 0 }, radius: { value: radius }, localEye: { value: new Vector3(0, 0, 1000) } },
      vertexShader: `
        varying vec3 p;
        void main() {
          p = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 p;
        uniform vec3 localEye;
        uniform float time;
        uniform float radius;
        float hash(vec3 v) { return fract(sin(dot(v, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float noise(vec3 v) {
          vec3 i = floor(v), f = fract(v);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }
        void main() {
          vec3 o = localEye / radius;
          vec3 d = normalize(p - localEye);
          float b = dot(o, d), h = b * b - dot(o, o) + 2.45;
          if (h < 0.0) discard;
          float entry = max(0.0, -b - sqrt(h)), end = -b + sqrt(h);
          float stepSize = (end - entry) / 22.0;
          vec4 sum = vec4(0.0);
          for (int i = 0; i < 22; i++) {
            vec3 q = o + d * (entry + (float(i) + 0.5) * stepSize);
            float n = noise(q * 3.6 + vec3(0.0, -time * 4.8, 0.0)) * 0.65 + noise(q * 7.8 - time * 3.0) * 0.35;
            float density = max(0.0, 1.18 - length(q * vec3(1.0, 0.78, 1.0)) + (n - 0.5) * 0.78);
            float alpha = 1.0 - exp(-density * stepSize * 3.8);
            vec3 hot = mix(vec3(0.95, 0.14, 0.01), vec3(1.0, 0.56, 0.05), smoothstep(0.08, 0.52, density));
            hot = mix(hot, vec3(1.0, 0.96, 0.65), smoothstep(0.56, 0.9, density));
            sum.rgb += (1.0 - sum.a) * hot * alpha;
            sum.a += (1.0 - sum.a) * alpha;
          }
          if (sum.a < 0.02) discard;
          gl_FragColor = vec4(sum.rgb, sum.a * 0.94);
        }
      `,
    });
    const coronaMesh = new Mesh(new SphereGeometry(radius * 1.6, 26, 20), coronaMaterial);
    flameGroup.add(coronaMesh);

    // 3D Impact Shockwave Ring & Explosion Flash Sphere
    const shockwaveMat = new MeshBasicMaterial({
      color: '#ff9424',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const shockwaveRing = new Mesh(new TorusGeometry(radius * 0.55, radius * 0.14, 14, 36), shockwaveMat);
    shockwaveRing.rotation.x = 0.42;
    shockwaveRing.visible = false;
    group.add(shockwaveRing);

    const flashMat = new MeshBasicMaterial({
      color: '#ffe89c',
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const flashSphere = new Mesh(new SphereGeometry(radius * 0.75, 20, 16), flashMat);
    flashSphere.visible = false;
    group.add(flashSphere);

    // 96 3D Flame particles and embers
    const particleCount = 96;
    const sparkGeometry = new IcosahedronGeometry(1, 0);
    const sparkMaterial = new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.96,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const sparks = new InstancedMesh(sparkGeometry, sparkMaterial, particleCount);
    sparks.instanceMatrix.setUsage(DynamicDrawUsage);
    sparks.frustumCulled = false;
    group.add(sparks);

    const dummy = new Object3D();
    const colorHot = new Color('#fff7ba');
    const colorMid = new Color('#ff7412');
    const colorCool = new Color('#cc1806');
    const tempColor = new Color();

    const particles = Array.from({ length: particleCount }, (_, i) => ({
      position: new Vector3(),
      velocity: new Vector3(),
      life: 0,
      maxLife: 0.38,
      size: 1,
      seed: i * 2.39996,
    }));
    for (let i = 0; i < particleCount; i++) sparks.setColorAt(i, colorHot);
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;

    // Occlusion plane at the source card so the sphere visibly emerges from inside the card
    const sourceMask = new Mesh(
      new BoxGeometry(source.width * 0.92, source.height * 0.92, 2),
      new MeshBasicMaterial({ colorWrite: false }),
    );
    sourceMask.position.copy(this.center(source, -2));
    sourceMask.renderOrder = -10;
    group.add(sourceMask);

    const began = performance.now() / 1000;
    let impacted = false;
    let impactTime = 0;
    let emitIndex = 0;
    let emitClock = 0;
    const startCenter = this.center(source, -radius * 0.85);
    const position = startCenter.clone();
    const previousPosition = startCenter.clone();
    const duration = this.reduced ? 0.18 : 0.82;
    const emergeDuration = duration * 0.24;

    return new Promise((resolve) => {
      let resolved = false;
      const timer = window.setTimeout(() => safeResolve(), Math.ceil((duration + 0.15) * 1000));
      const safeResolve = () => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timer);
        resolve();
      };

      this.add(`fire-${++this.serial}`, {
        group,
        update: (now, delta) => {
          const elapsed = now - began;
          const unit = target();
          const targetRect = unit?.getBoundingClientRect() ?? initialTarget.getBoundingClientRect();
          const end = this.center(targetRect, 14);

          if (elapsed < emergeDuration) {
            const tEmerge = smooth(elapsed / emergeDuration);
            position.copy(this.center(source, -radius * 0.85 + tEmerge * (radius * 0.85 + 52)));
            flameGroup.scale.setScalar(0.16 + 0.84 * tEmerge);
          } else {
            const tTravel = clamp((elapsed - emergeDuration) / (duration - emergeDuration));
            const eased = tTravel * tTravel * (3 - 2 * tTravel);
            const launch = this.center(source, 52);
            const dx = end.x - launch.x;
            const dy = end.y - launch.y;
            const dist = Math.hypot(dx, dy);
            const sideArc = (dx >= 0 ? -1 : 1) * Math.min(48, dist * 0.12);
            const control = launch.clone().lerp(end, 0.48);
            control.x += sideArc;
            control.y += Math.min(96, Math.max(46, dist * 0.24));
            control.z = 175;

            const curve = new QuadraticBezierCurve3(launch, control, end);
            position.copy(curve.getPoint(eased));

            const tangent = curve.getTangent(eased);
            const stretch = 1 + 0.34 * Math.sin(tTravel * Math.PI);
            flameGroup.scale.set(1, stretch, 1);
            flameGroup.rotation.z = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
          }

          flameGroup.position.copy(position);
          flameGroup.updateMatrixWorld();
          coronaMaterial.uniforms.localEye.value.copy(this.camera.position);
          flameGroup.worldToLocal(coronaMaterial.uniforms.localEye.value);
          coreMaterial.uniforms.time.value = elapsed;
          coronaMaterial.uniforms.time.value = elapsed;

          const velocity = position.clone().sub(previousPosition).divideScalar(Math.max(delta, 0.001));
          previousPosition.copy(position);

          emitClock += delta;
          while (!impacted && emitClock >= 0.009) {
            emitClock -= 0.009;
            const p = particles[emitIndex++ % particles.length];
            const angle = p.seed + elapsed * 8.5;
            const spread = radius * (elapsed < emergeDuration ? 0.48 : 0.68);
            p.position.copy(position).add(
              new Vector3(
                Math.cos(angle) * spread,
                Math.sin(angle) * spread,
                Math.sin(angle * 1.7) * spread * 0.65,
              ),
            );
            p.velocity
              .copy(velocity)
              .multiplyScalar(-0.18)
              .add(
                new Vector3(
                  Math.cos(angle) * 38,
                  28 + Math.sin(angle) * 24,
                  Math.sin(angle * 1.3) * 32,
                ),
              );
            p.maxLife = 0.34 + (emitIndex % 5) * 0.035;
            p.life = p.maxLife;
            p.size = Math.max(4.2, radius * 0.25);
          }

          if (elapsed >= duration && !impacted) {
            impacted = true;
            impactTime = elapsed;
            flameGroup.visible = false;
            sourceMask.visible = false;
            shockwaveRing.visible = true;
            shockwaveRing.position.copy(end);
            flashSphere.visible = true;
            flashSphere.position.copy(end);

            for (let i = 0; i < 64; i++) {
              const p = particles[emitIndex++ % particles.length];
              const theta = (i / 64) * Math.PI * 2;
              const ringLayer = i % 3;
              const speed = 78 + ringLayer * 48;
              p.position.copy(end).add(new Vector3(Math.cos(theta) * 10, Math.sin(theta) * 10, 8));
              p.velocity.set(
                Math.cos(theta) * speed - Math.sin(theta) * 46,
                Math.sin(theta) * speed + Math.cos(theta) * 46,
                38 + (i % 4) * 22,
              );
              p.maxLife = 0.42;
              p.life = p.maxLife;
              p.size = Math.max(5.2, radius * 0.28);
            }
            safeResolve();
          }

          if (impacted) {
            const post = clamp((elapsed - impactTime) / 0.42);
            shockwaveRing.scale.setScalar(1 + post * 2.8);
            shockwaveMat.opacity = (1 - post) * 0.92;
            flashSphere.scale.setScalar(1 + post * 1.9);
            flashMat.opacity = Math.max(0, 1 - post * 1.6) * 0.85;
          }

          particles.forEach((p, i) => {
            if (p.life <= 0) {
              dummy.scale.setScalar(0);
              dummy.updateMatrix();
              sparks.setMatrixAt(i, dummy.matrix);
              return;
            }
            p.life = Math.max(0, p.life - delta);
            p.position.addScaledVector(p.velocity, delta);
            p.velocity.multiplyScalar(Math.max(0, 1 - delta * 2.9));
            const ratio = p.life / p.maxLife;
            dummy.position.copy(p.position);
            dummy.scale.setScalar(p.size * Math.sin(ratio * Math.PI * 0.88));
            dummy.rotation.set(p.seed + elapsed * 4, elapsed * 5, p.seed);
            dummy.updateMatrix();
            sparks.setMatrixAt(i, dummy.matrix);

            if (ratio > 0.55) {
              tempColor.copy(colorHot).lerp(colorMid, (1 - ratio) / 0.45);
            } else {
              tempColor.copy(colorMid).lerp(colorCool, (0.55 - ratio) / 0.55);
            }
            sparks.setColorAt(i, tempColor);
          });
          sparks.instanceMatrix.needsUpdate = true;
          if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;

          return elapsed > duration + 0.45;
        },
        dispose: safeResolve,
      });
    });
  }

  /**
   * 3D Healing spell stream: emerges from the spell card, arcs to the wounded ally,
   * and wraps the ally in an ascending 3D emerald-gold helix.
   */
  healSpell(source: Rect, target: () => HTMLElement | null): Promise<void> {
    if (this.lost) return Promise.resolve();
    const initialTarget = target();
    if (!initialTarget) return Promise.resolve();

    const group = new Group();
    const orbRadius = Math.max(14, Math.min(24, source.width * 0.24));
    const orbMat = new MeshBasicMaterial({
      color: '#88ffbe',
      transparent: true,
      opacity: 0.92,
      blending: AdditiveBlending,
    });
    const orb = new Mesh(new OctahedronGeometry(orbRadius, 2), orbMat);
    group.add(orb);

    const count = 52;
    const sparks = new InstancedMesh(
      new OctahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
      count,
    );
    sparks.instanceMatrix.setUsage(DynamicDrawUsage);
    sparks.frustumCulled = false;
    group.add(sparks);

    const dummy = new Object3D();
    const cMint = new Color('#b5ffd9');
    const cGold = new Color('#ffe98a');
    for (let i = 0; i < count; i++) sparks.setColorAt(i, i % 2 === 0 ? cMint : cGold);
    if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;

    const began = performance.now() / 1000;
    const flightDuration = this.reduced ? 0.15 : 0.62;
    const totalDuration = flightDuration + 0.55;
    let resolved = false;

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => safeResolve(), Math.ceil(totalDuration * 1000));
      const safeResolve = () => {
        if (resolved) return;
        resolved = true;
        window.clearTimeout(timer);
        resolve();
      };

      this.add(`heal-${++this.serial}`, {
        group,
        update: (now) => {
          const elapsed = now - began;
          const unit = target() ?? initialTarget;
          const tRect = unit.getBoundingClientRect();
          const start = this.center(source, 28);
          const end = this.center(tRect, 18);
          const control = start.clone().lerp(end, 0.5);
          control.y += 65;
          control.z = 120;
          const curve = new QuadraticBezierCurve3(start, control, end);

          if (elapsed < flightDuration) {
            const t = smooth(elapsed / flightDuration);
            orb.position.copy(curve.getPoint(t));
            orb.rotation.set(elapsed * 4, elapsed * 5, 0);
            orb.scale.setScalar(0.35 + 0.65 * Math.sin(t * Math.PI));
          } else {
            orb.visible = false;
            safeResolve();
          }

          for (let i = 0; i < count; i++) {
            const frac = i / count;
            if (elapsed < flightDuration) {
              const trailT = clamp(elapsed / flightDuration - frac * 0.35);
              const pt = curve.getPoint(smooth(trailT));
              const angle = elapsed * 8 + i * 0.6;
              const r = 10 * Math.sin(frac * Math.PI);
              dummy.position.set(pt.x + Math.cos(angle) * r, pt.y + Math.sin(angle) * r, pt.z + 8);
              dummy.scale.setScalar(trailT > 0 ? (1 - frac * 0.6) * 4.8 : 0);
            } else {
              const post = clamp((elapsed - flightDuration) / 0.55);
              const angle = frac * Math.PI * 4 + post * 6;
              const rad = Math.max(22, tRect.width * 0.46) * (1 - post * 0.25);
              const yOff = (frac - 0.5) * tRect.height * 0.85 + post * 36;
              dummy.position.set(end.x + Math.cos(angle) * rad, end.y + yOff, end.z + Math.sin(angle) * 18);
              dummy.scale.setScalar((1 - post) * 5.2);
            }
            dummy.rotation.set(elapsed * 3, elapsed * 4, i);
            dummy.updateMatrix();
            sparks.setMatrixAt(i, dummy.matrix);
          }
          sparks.instanceMatrix.needsUpdate = true;
          return elapsed >= totalDuration;
        },
        dispose: safeResolve,
      });
    });
  }

  /**
   * 3D Volcano mountain cone that emerges right on the Vulcão card's slot, stays active
   * while all 3 waves erupt, and sinks back into the card when the eruption finishes.
   */
  volcano(id: string, slotTarget: () => HTMLElement | null, remainingMs: () => number): void {
    if (this.lost) return;
    const first = slotTarget();
    if (!first) return;

    const group = new Group();
    const rect = first.getBoundingClientRect();
    const baseRadius = Math.max(36, Math.min(58, rect.width * 0.68));
    const topRadius = baseRadius * 0.35;
    const height = Math.max(52, Math.min(84, rect.height * 0.66));
    const tiltX = 0.34;

    // 3D Volcanic Mountain Cone with rugged ridges and glowing magma rivers flowing down the slopes
    const volcanoMaterial = new ShaderMaterial({
      side: DoubleSide,
      uniforms: { time: { value: 0 }, pulse: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vUv = uv;
          vec3 p = position;
          float angle = atan(p.z, p.x);
          float ridge = (sin(angle * 7.0 + uv.y * 4.0) * 2.8 + cos(angle * 11.0 - uv.y * 6.0) * 1.4) * (1.0 - uv.y * 0.35);
          vec2 dir = normalize(p.xz + vec2(0.0001));
          p.x += dir.x * ridge;
          p.z += dir.y * ridge;
          vPos = p;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        varying vec3 vNormal;
        uniform float time;
        uniform float pulse;
        void main() {
          float angle = vUv.x * 6.28318;
          float stream1 = pow(max(0.0, sin(angle * 5.0 + sin(vUv.y * 9.0 + time * 3.8) * 0.85)), 5.0);
          float stream2 = pow(max(0.0, cos(angle * 3.0 - sin(vUv.y * 6.0 + time * 2.6) * 0.7)), 6.0);
          float streams = clamp((stream1 + stream2 * 0.8) * smoothstep(0.08, 0.88, vUv.y), 0.0, 1.0);
          float craterRim = smoothstep(0.68, 0.98, vUv.y);
          float baseGlow = smoothstep(0.22, 0.0, vUv.y) * 0.55;
          float lava = clamp(streams * 0.9 + craterRim * 0.85 + baseGlow + pulse * 0.22, 0.0, 1.0);

          vec3 n = normalize(vNormal);
          float diff = 0.45 + 0.55 * max(dot(n, normalize(vec3(-0.35, 0.65, 1.0))), 0.0);
          vec3 rock = mix(vec3(0.11, 0.08, 0.08), vec3(0.26, 0.17, 0.14), diff);
          vec3 magma = mix(vec3(0.88, 0.14, 0.01), vec3(1.0, 0.54, 0.04), smoothstep(0.2, 0.65, lava));
          magma = mix(magma, vec3(1.0, 0.94, 0.52), smoothstep(0.68, 0.98, lava));
          vec3 col = mix(rock, magma, smoothstep(0.15, 0.85, lava));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    const mountGroup = new Group();
    mountGroup.rotation.x = tiltX;
    mountGroup.position.set(0, -rect.height * 0.06, 26);
    group.add(mountGroup);

    const coneGeom = new CylinderGeometry(topRadius, baseRadius, height, 32, 18, false);
    const coneMesh = new Mesh(coneGeom, volcanoMaterial);
    mountGroup.add(coneMesh);

    // Rocky crater rim torus at the summit
    const rimMesh = new Mesh(
      new TorusGeometry(topRadius * 0.94, topRadius * 0.24, 14, 28),
      new MeshStandardMaterial({ color: '#2b1915', emissive: '#ff4508', emissiveIntensity: 0.65, roughness: 0.82 }),
    );
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = height * 0.49;
    mountGroup.add(rimMesh);

    // Bubbling molten lava pool inside the crater peak
    const craterMat = new MeshBasicMaterial({
      color: '#ffdf66',
      transparent: true,
      opacity: 0.98,
    });
    const craterPool = new Mesh(new SphereGeometry(topRadius * 0.84, 20, 14), craterMat);
    craterPool.scale.set(1, 0.35, 1);
    craterPool.position.y = height * 0.49;
    mountGroup.add(craterPool);

    // Glowing magma fissure ring at the base of the volcano on the card
    const baseRingMat = new MeshBasicMaterial({
      color: '#ff6e14',
      transparent: true,
      opacity: 0.78,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const baseRing = new Mesh(new TorusGeometry(baseRadius * 0.95, 3.2, 12, 32), baseRingMat);
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = -height * 0.48;
    mountGroup.add(baseRing);

    // Continuous 3D fountain of 48 lava embers & smoke sparks erupting from the crater
    const emberCount = 48;
    const embers = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.94, blending: AdditiveBlending, depthWrite: false }),
      emberCount,
    );
    embers.instanceMatrix.setUsage(DynamicDrawUsage);
    embers.frustumCulled = false;
    mountGroup.add(embers);
    const dummy = new Object3D();
    const cHot = new Color('#fff3a1');
    const cOrange = new Color('#ff6810');
    for (let i = 0; i < emberCount; i++) embers.setColorAt(i, i % 2 === 0 ? cHot : cOrange);
    if (embers.instanceColor) embers.instanceColor.needsUpdate = true;

    const began = performance.now() / 1000;
    let retractStarted: number | null = null;

    this.add(`volcano-${id}`, {
      group,
      update: (now) => {
        const slot = slotTarget();
        if (!slot || !slot.isConnected) return true;
        const r = slot.getBoundingClientRect();
        group.position.copy(this.center(r, 18));

        if (remainingMs() <= 0 && retractStarted === null) {
          retractStarted = now;
        }
        const grown = smooth((now - began) / (this.reduced ? 0.08 : 0.52));
        const progress =
          retractStarted === null
            ? grown
            : grown * (1 - smooth((now - retractStarted) / (this.reduced ? 0.08 : 0.48)));

        const breathe = 1 + 0.045 * Math.sin((now - began) * 4.5);
        mountGroup.scale.set(progress * breathe, progress, progress * breathe);
        volcanoMaterial.uniforms.time.value = now - began;
        volcanoMaterial.uniforms.pulse.value = 0.5 + 0.5 * Math.sin((now - began) * 5.2);
        craterPool.scale.set(0.9 + 0.14 * Math.sin((now - began) * 7.5), 0.35, 0.9 + 0.14 * Math.cos((now - began) * 7.5));

        for (let i = 0; i < emberCount; i++) {
          const cycle = ((now - began) * 1.35 + i / emberCount) % 1;
          const angle = i * 2.39996 + (now - began) * 1.8;
          const spread = topRadius * (0.25 + cycle * 1.45);
          const arcY = height * 0.5 + Math.sin(cycle * Math.PI * 0.85) * 46;
          dummy.position.set(
            Math.cos(angle) * spread,
            arcY,
            Math.sin(angle) * spread,
          );
          dummy.scale.setScalar(progress * (1 - cycle * 0.85) * 4.4);
          dummy.rotation.set(now * 4, angle, i);
          dummy.updateMatrix();
          embers.setMatrixAt(i, dummy.matrix);
        }
        embers.instanceMatrix.needsUpdate = true;

        return retractStarted !== null && progress <= 0.002;
      },
    });
  }

  /**
   * Launches 3D molten lava bombs from the Volcano card's crater in arcs to every unit on the board.
   */
  volcanoWave(slotTarget: () => HTMLElement | null, unitTargets: () => HTMLElement[], wave: number): void {
    if (this.lost) return;
    const originEl = slotTarget();
    const targets = unitTargets();
    if (!originEl) return;

    const group = new Group();
    const originRect = originEl.getBoundingClientRect();
    const start = this.center(originRect, 42);

    // Expanding 3D crater eruption ring at the volcano slot
    const ringMat = new MeshBasicMaterial({
      color: '#ff8a1e',
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const ring = new Mesh(new TorusGeometry(Math.max(18, originRect.width * 0.28), 4, 12, 32), ringMat);
    ring.position.copy(start);
    ring.rotation.x = 0.55;
    group.add(ring);

    const bombCount = Math.max(1, targets.length);
    const bombRadius = Math.max(9, Math.min(15, originRect.width * 0.16));
    const bombMat = new MeshStandardMaterial({
      color: '#ff4808',
      emissive: '#ff8818',
      emissiveIntensity: 2.2,
      roughness: 0.6,
    });
    const bombs = targets.map((el, i) => {
      const mesh = new Mesh(new DodecahedronBombGeometry(bombRadius), bombMat);
      group.add(mesh);
      return { el, mesh, index: i };
    });

    const sparkCount = Math.max(24, bombCount * 14);
    const sparks = new InstancedMesh(
      new IcosahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: '#ffbe42', transparent: true, opacity: 0.92, blending: AdditiveBlending, depthWrite: false }),
      sparkCount,
    );
    sparks.instanceMatrix.setUsage(DynamicDrawUsage);
    sparks.frustumCulled = false;
    group.add(sparks);
    const dummy = new Object3D();

    const began = performance.now() / 1000;
    const flightDuration = this.reduced ? 0.15 : 0.58;
    const totalDuration = flightDuration + 0.34;

    this.add(`volcano-wave-${wave}-${++this.serial}`, {
      group,
      update: (now) => {
        const elapsed = now - began;
        const ringT = clamp(elapsed / 0.45);
        ring.scale.setScalar(1 + ringT * 2.4);
        ringMat.opacity = (1 - ringT) * 0.9;

        const tFlight = clamp(elapsed / flightDuration);
        const eased = tFlight * tFlight * (3 - 2 * tFlight);

        bombs.forEach(({ el, mesh, index }) => {
          const end = this.center(el.getBoundingClientRect(), 12);
          const control = start.clone().lerp(end, 0.5);
          control.y += 72 + (index % 3) * 18;
          control.z = 145;
          const curve = new QuadraticBezierCurve3(start, control, end);

          if (elapsed < flightDuration) {
            mesh.visible = true;
            mesh.position.copy(curve.getPoint(eased));
            mesh.rotation.set(elapsed * 6 + index, elapsed * 5, index);
          } else {
            mesh.visible = false;
          }

          const perBomb = Math.floor(sparkCount / Math.max(1, bombs.length));
          for (let k = 0; k < perBomb; k++) {
            const idx = index * perBomb + k;
            if (idx >= sparkCount) break;
            if (elapsed < flightDuration) {
              const trailT = clamp(tFlight - (k / perBomb) * 0.28);
              const pt = curve.getPoint(trailT * trailT * (3 - 2 * trailT));
              dummy.position.set(
                pt.x + Math.cos(elapsed * 10 + k) * 5,
                pt.y + Math.sin(elapsed * 10 + k) * 5,
                pt.z,
              );
              dummy.scale.setScalar(trailT > 0 ? (1 - k / perBomb) * 3.8 : 0);
            } else {
              const post = clamp((elapsed - flightDuration) / 0.34);
              const angle = (k / perBomb) * Math.PI * 2 + index;
              const dist = post * 34;
              dummy.position.set(
                end.x + Math.cos(angle) * dist,
                end.y + Math.sin(angle) * dist,
                end.z + (1 - post) * 18,
              );
              dummy.scale.setScalar((1 - post) * 4.4);
            }
            dummy.updateMatrix();
            sparks.setMatrixAt(idx, dummy.matrix);
          }
        });
        sparks.instanceMatrix.needsUpdate = true;

        return elapsed >= totalDuration;
      },
    });
  }

  /**
   * 3D Combat Attack Strike from an attacking troop to its target with 3D geometry and impact shards.
   */
  attackStrike(from: Rect, to: Rect, trail: string, colorHex: string): void {
    if (this.lost || this.reduced) return;
    const group = new Group();
    const accent = new Color(colorHex || '#fbe185');
    const coreMat = new MeshBasicMaterial({ color: '#fff7dc', transparent: true, opacity: 0.96 });
    const glowMat = new MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });

    const headGroup = new Group();
    const radius = Math.max(8, Math.min(14, from.width * 0.14));
    const coreMesh = new Mesh(
      trail === 'slash'
        ? new ConeGeometry(radius * 0.65, radius * 2.8, 6)
        : trail === 'impact'
          ? new IcosahedronGeometry(radius * 1.1, 0)
          : new OctahedronGeometry(radius * 0.95, 1),
      coreMat,
    );
    const glowMesh = new Mesh(new SphereGeometry(radius * 1.35, 14, 12), glowMat);
    headGroup.add(coreMesh, glowMesh);
    group.add(headGroup);

    const shardCount = 18;
    const shards = new InstancedMesh(
      new OctahedronGeometry(1, 0),
      new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.88, blending: AdditiveBlending, depthWrite: false }),
      shardCount,
    );
    shards.instanceMatrix.setUsage(DynamicDrawUsage);
    shards.frustumCulled = false;
    group.add(shards);
    const dummy = new Object3D();

    const start = this.center(from, 28);
    const end = this.center(to, 18);
    const control = start.clone().lerp(end, 0.5);
    control.z = 85;
    const curve = new QuadraticBezierCurve3(start, control, end);

    const began = performance.now() / 1000;
    const flightDuration = 0.34;
    const totalDuration = 0.56;

    this.add(`strike-${++this.serial}`, {
      group,
      update: (now) => {
        const elapsed = now - began;
        if (elapsed < flightDuration) {
          const t = smooth(elapsed / flightDuration);
          const pos = curve.getPoint(t);
          const tangent = curve.getTangent(t);
          headGroup.position.copy(pos);
          headGroup.rotation.z = Math.atan2(tangent.y, tangent.x) - Math.PI / 2;
          coreMesh.rotation.y = elapsed * 10;

          for (let i = 0; i < shardCount; i++) {
            const frac = i / shardCount;
            const trailT = clamp(t - frac * 0.25);
            const pt = curve.getPoint(trailT);
            dummy.position.set(pt.x, pt.y, pt.z);
            dummy.scale.setScalar(trailT > 0 ? (1 - frac) * 3.4 : 0);
            dummy.rotation.set(elapsed * 5, i, 0);
            dummy.updateMatrix();
            shards.setMatrixAt(i, dummy.matrix);
          }
        } else {
          headGroup.visible = false;
          const post = clamp((elapsed - flightDuration) / (totalDuration - flightDuration));
          for (let i = 0; i < shardCount; i++) {
            const angle = (i / shardCount) * Math.PI * 2;
            const speed = 18 + (i % 3) * 14;
            dummy.position.set(
              end.x + Math.cos(angle) * speed * post,
              end.y + Math.sin(angle) * speed * post,
              end.z + (1 - post) * 16,
            );
            dummy.scale.setScalar((1 - post) * 4.2);
            dummy.rotation.set(post * 6, angle, i);
            dummy.updateMatrix();
            shards.setMatrixAt(i, dummy.matrix);
          }
        }
        shards.instanceMatrix.needsUpdate = true;
        return elapsed >= totalDuration;
      },
    });
  }

  /**
   * 3D Thorns counter-attack: shoots 3D spiked bramble lances from the sigil slot to the attacker.
   */
  thorns(slotTarget: () => HTMLElement | null, attackerTarget: () => HTMLElement | null): void {
    const fromEl = slotTarget();
    const toEl = attackerTarget();
    if (!fromEl || !toEl) return;
    this.attackStrike(fromEl.getBoundingClientRect(), toEl.getBoundingClientRect(), 'slash', '#63f2a1');
  }

  /**
   * 3D Root tentacles that emerge from the ground on the bottom sides of the target card,
   * wrap around and embrace the card in 3D during the root duration, then retract back into the ground.
   */
  roots(id: string, target: () => HTMLElement | null, remainingMs: () => number): void {
    if (this.lost) return;
    const first = target();
    if (!first) return;

    const group = new Group();
    const rect = first.getBoundingClientRect();
    const w = Math.max(40, rect.width);
    const h = Math.max(56, rect.height);

    // Depth-only occlusion box matching the card so tentacles pass behind and over the front of the card
    const cardMask = new Mesh(
      new BoxGeometry(w * 0.94, h * 0.94, 4),
      new MeshBasicMaterial({ colorWrite: false }),
    );
    cardMask.renderOrder = -20;
    group.add(cardMask);

    const material = new MeshStandardMaterial({
      color: '#4e6b2c',
      emissive: '#19280d',
      emissiveIntensity: 0.35,
      roughness: 0.76,
      metalness: 0.04,
    });

    // Four 3D tentacle paths emerging from bottom-left and bottom-right sides and embracing the card
    const paths = [
      [
        new Vector3(-w * 0.56, -h * 0.56, -8),
        new Vector3(-w * 0.54, -h * 0.32, 5),
        new Vector3(-w * 0.22, -h * 0.14, 13),
        new Vector3(w * 0.28, 0, 12),
        new Vector3(w * 0.52, h * 0.14, 4),
        new Vector3(w * 0.48, h * 0.24, -4),
      ],
      [
        new Vector3(w * 0.56, -h * 0.56, -8),
        new Vector3(w * 0.54, -h * 0.26, 5),
        new Vector3(w * 0.20, -h * 0.06, 14),
        new Vector3(-w * 0.28, h * 0.10, 12),
        new Vector3(-w * 0.52, h * 0.22, 4),
        new Vector3(-w * 0.47, h * 0.30, -4),
      ],
      [
        new Vector3(-w * 0.50, -h * 0.55, -10),
        new Vector3(-w * 0.56, -h * 0.18, -3),
        new Vector3(-w * 0.53, h * 0.12, 6),
        new Vector3(-w * 0.26, h * 0.28, 12),
        new Vector3(w * 0.12, h * 0.32, 10),
      ],
      [
        new Vector3(w * 0.50, -h * 0.55, -10),
        new Vector3(w * 0.56, -h * 0.14, -3),
        new Vector3(w * 0.53, h * 0.16, 6),
        new Vector3(w * 0.24, h * 0.30, 12),
        new Vector3(-w * 0.12, h * 0.34, 10),
      ],
    ];

    const segments = 56;
    const radialSides = 10;
    const stride = radialSides + 1;

    const tubes = paths.map((pts, index) => {
      const curve = new CatmullRomCurve3(pts);
      const geometry = new BufferGeometry();
      const vertices = new Float32Array((segments + 1) * stride * 3);
      const indices: number[] = [];
      for (let s = 0; s < segments; s++) {
        for (let r = 0; r < radialSides; r++) {
          const a = s * stride + r;
          indices.push(a, a + stride, a + 1, a + stride, a + stride + 1, a + 1);
        }
      }
      geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3).setUsage(DynamicDrawUsage));
      geometry.setIndex(indices);
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      return { curve, geometry, index };
    });

    const began = performance.now() / 1000;
    let retractStarted: number | null = null;
    const tangent = new Vector3();
    const normal = new Vector3();
    const binormal = new Vector3();
    const refAxis = new Vector3(0, 0, 1);
    const fallbackAxis = new Vector3(1, 0, 0);

    this.add(`roots-${id}`, {
      group,
      update: (now) => {
        const current = target();
        if (!current || !current.isConnected) return true;
        const currentRect = current.getBoundingClientRect();
        group.position.copy(this.center(currentRect));
        group.scale.set(currentRect.width / w, currentRect.height / h, 1);

        if (remainingMs() <= 0 && retractStarted === null) {
          retractStarted = now;
        }
        const growDuration = this.reduced ? 0.08 : 0.55;
        const retractDuration = this.reduced ? 0.08 : 0.48;
        const grown = smooth((now - began) / growDuration);
        const progress =
          retractStarted === null
            ? grown
            : grown * (1 - smooth((now - retractStarted) / retractDuration));

        const baseRadius = Math.max(2.8, w * 0.05);

        for (const tube of tubes) {
          const position = tube.geometry.getAttribute('position');
          const squeeze =
            retractStarted === null && progress > 0.9
              ? Math.sin((now - began) * 3.4 + tube.index * 1.4) * 1.2
              : 0;

          for (let s = 0; s <= segments; s++) {
            const fraction = s / segments;
            const t = fraction * Math.max(0.001, progress);
            const pt = tube.curve.getPoint(t);
            tangent.copy(tube.curve.getTangent(t));
            const axis = Math.abs(tangent.z) > 0.9 ? fallbackAxis : refAxis;
            normal.crossVectors(tangent, axis).normalize();
            binormal.crossVectors(tangent, normal).normalize();

            const holdOffset = Math.sin(fraction * Math.PI) * squeeze;
            const centerX = pt.x - Math.sign(pt.x || 1) * holdOffset;
            const centerY = pt.y + (progress < 1 ? (1 - progress) * -6 * (1 - fraction) : 0);
            const centerZ = pt.z;

            const taper = (1 - fraction * 0.84) * Math.min(1, progress * 3.2);
            const radius = baseRadius * taper;

            for (let r = 0; r <= radialSides; r++) {
              const angle = (r / radialSides) * Math.PI * 2;
              const ridge = 1 + 0.12 * Math.sin(angle * 3 + fraction * 14);
              const rad = radius * ridge;
              const ox = (normal.x * Math.cos(angle) + binormal.x * Math.sin(angle)) * rad;
              const oy = (normal.y * Math.cos(angle) + binormal.y * Math.sin(angle)) * rad;
              const oz = (normal.z * Math.cos(angle) + binormal.z * Math.sin(angle)) * rad;
              position.setXYZ(s * stride + r, centerX + ox, centerY + oy, centerZ + oz);
            }
          }
          position.needsUpdate = true;
          tube.geometry.computeVertexNormals();
        }

        return retractStarted !== null && progress <= 0.002;
      },
    });
  }
}

function newDodecahedronBombGeometry(radius: number): BufferGeometry {
  return new IcosahedronGeometry(radius, 1);
}
class DodecahedronBombGeometry extends IcosahedronGeometry {
  constructor(radius: number) {
    super(radius, 1);
    void newDodecahedronBombGeometry;
  }
}
