import {
  AdditiveBlending, AmbientLight, BackSide, BoxGeometry, BufferGeometry, CatmullRomCurve3,
  Color, DirectionalLight, DynamicDrawUsage, Float32BufferAttribute, Group,
  IcosahedronGeometry, InstancedMesh, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PerspectiveCamera, QuadraticBezierCurve3, Scene, ShaderMaterial, SphereGeometry,
  Vector3, WebGLRenderer,
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

/** Shared WebGL 3D overlay for spell projectiles and 3D board bindings. */
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
    this.scene.add(new AmbientLight('#b8d4c8', 1.45));
    const key = new DirectionalLight('#ffe2b5', 2.5);
    key.position.set(-260, 440, 620);
    this.scene.add(key);
    const rim = new DirectionalLight('#8ee69b', 1.15);
    rim.position.set(360, -180, 280);
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
   * 3D Fireball sphere that emerges from inside the source card, arcs across the arena
   * shedding 3D flame particles, and bursts on impact.
   */
  fireball(source: Rect, target: () => HTMLElement | null): Promise<void> {
    if (this.lost) return Promise.resolve();
    const initialTarget = target();
    if (!initialTarget) return Promise.resolve();

    const group = new Group();
    const flameGroup = new Group();
    group.add(flameGroup);

    const radius = Math.max(12, Math.min(20, source.width * 0.18));

    // Inner molten 3D sphere with animated turbulent fire veins and Fresnel rim
    const coreMaterial = new ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPos;
        void main() {
          vec3 p = position;
          float wave = sin(p.y * 6.0 - time * 9.0) * 0.04 + cos(p.x * 5.0 + time * 7.0) * 0.03;
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
          vec3 q = normalize(vPos) * 3.2 + vec3(0.0, -time * 3.8, time * 1.6);
          float f = noise(q) * 0.65 + noise(q * 2.3 - time * 2.4) * 0.35;
          float rim = pow(1.0 - max(dot(n, vec3(0.0, 0.0, 1.0)), 0.0), 1.8);
          vec3 darkRed = vec3(0.58, 0.05, 0.01);
          vec3 brightOrange = vec3(1.0, 0.36, 0.02);
          vec3 hotGold = vec3(1.0, 0.78, 0.22);
          vec3 whiteHot = vec3(1.0, 0.97, 0.82);
          vec3 col = mix(darkRed, brightOrange, smoothstep(0.2, 0.62, f));
          col = mix(col, hotGold, smoothstep(0.48, 0.82, f));
          col = mix(col, whiteHot, smoothstep(0.72, 0.96, f) * (1.0 - rim * 0.5));
          col += vec3(1.0, 0.42, 0.05) * rim * 0.85;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const coreMesh = new Mesh(new SphereGeometry(radius * 0.72, 28, 20), coreMaterial);
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
          float b = dot(o, d), h = b * b - dot(o, o) + 1.85;
          if (h < 0.0) discard;
          float entry = max(0.0, -b - sqrt(h)), end = -b + sqrt(h);
          float stepSize = (end - entry) / 20.0;
          vec4 sum = vec4(0.0);
          for (int i = 0; i < 20; i++) {
            vec3 q = o + d * (entry + (float(i) + 0.5) * stepSize);
            float n = noise(q * 3.8 + vec3(0.0, -time * 4.2, 0.0)) * 0.65 + noise(q * 8.0 - time * 2.5) * 0.35;
            float density = max(0.0, 1.06 - length(q * vec3(1.0, 0.82, 1.0)) + (n - 0.5) * 0.72);
            float alpha = 1.0 - exp(-density * stepSize * 3.4);
            vec3 hot = mix(vec3(0.92, 0.12, 0.01), vec3(1.0, 0.52, 0.04), smoothstep(0.1, 0.55, density));
            hot = mix(hot, vec3(1.0, 0.94, 0.58), smoothstep(0.6, 0.92, density));
            sum.rgb += (1.0 - sum.a) * hot * alpha;
            sum.a += (1.0 - sum.a) * alpha;
          }
          if (sum.a < 0.02) discard;
          gl_FragColor = vec4(sum.rgb, sum.a * 0.88);
        }
      `,
    });
    const coronaMesh = new Mesh(new SphereGeometry(radius * 1.36, 24, 18), coronaMaterial);
    flameGroup.add(coronaMesh);

    // 3D Flame particles and embers along the flight arc and on impact
    const particleCount = 56;
    const sparkGeometry = new IcosahedronGeometry(1, 0);
    const sparkMaterial = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95 });
    const sparks = new InstancedMesh(sparkGeometry, sparkMaterial, particleCount);
    sparks.instanceMatrix.setUsage(DynamicDrawUsage);
    sparks.frustumCulled = false;
    group.add(sparks);

    const dummy = new Object3D();
    const colorHot = new Color('#fff3a6');
    const colorMid = new Color('#ff7b14');
    const colorCool = new Color('#c81d09');
    const tempColor = new Color();

    const particles = Array.from({ length: particleCount }, (_, i) => ({
      position: new Vector3(),
      velocity: new Vector3(),
      life: 0,
      maxLife: 0.34,
      size: 1,
      seed: i * 2.39996,
    }));
    for (let i = 0; i < particleCount; i++) {
      sparks.setColorAt(i, colorHot);
    }
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
    let emitIndex = 0;
    let emitClock = 0;
    const startCenter = this.center(source, -radius * 0.85);
    const position = startCenter.clone();
    const previousPosition = startCenter.clone();
    const duration = this.reduced ? 0.16 : 0.78;
    const emergeDuration = duration * 0.24;

    return new Promise((resolve) => {
      let resolved = false;
      const timer = window.setTimeout(() => safeResolve(), Math.ceil((duration + 0.12) * 1000));
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
          const end = this.center(targetRect, 10);

          if (elapsed < emergeDuration) {
            // Phase 1: Sphere rises from inside the card face and expands
            const tEmerge = smooth(elapsed / emergeDuration);
            position.copy(this.center(source, -radius * 0.85 + tEmerge * (radius * 0.85 + 38)));
            flameGroup.scale.setScalar(0.18 + 0.82 * tEmerge);
          } else {
            // Phase 2: Parabolic 3D arc from the card to the target unit
            const tTravel = clamp((elapsed - emergeDuration) / (duration - emergeDuration));
            const eased = tTravel * tTravel * (3 - 2 * tTravel);
            const launch = this.center(source, 38);
            const dx = end.x - launch.x;
            const dy = end.y - launch.y;
            const dist = Math.hypot(dx, dy);
            const sideArc = (dx >= 0 ? -1 : 1) * Math.min(42, dist * 0.11);
            const control = launch.clone().lerp(end, 0.48);
            control.x += sideArc;
            control.y += Math.min(82, Math.max(38, dist * 0.22));
            control.z = 135;

            const curve = new QuadraticBezierCurve3(launch, control, end);
            position.copy(curve.getPoint(eased));

            // Stretch corona slightly along flight tangent like a real fireball
            const tangent = curve.getTangent(eased);
            const stretch = 1 + 0.22 * Math.sin(tTravel * Math.PI);
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

          // Emit continuous flame particles along the emergence and arc
          emitClock += delta;
          while (!impacted && emitClock >= 0.014) {
            emitClock -= 0.014;
            const p = particles[emitIndex++ % particles.length];
            const angle = p.seed + elapsed * 7.5;
            const spread = radius * (elapsed < emergeDuration ? 0.42 : 0.58);
            p.position.copy(position).add(
              new Vector3(
                Math.cos(angle) * spread,
                Math.sin(angle) * spread,
                Math.sin(angle * 1.7) * spread * 0.6,
              ),
            );
            p.velocity
              .copy(velocity)
              .multiplyScalar(-0.14)
              .add(
                new Vector3(
                  Math.cos(angle) * 26,
                  22 + Math.sin(angle) * 18,
                  Math.sin(angle * 1.3) * 24,
                ),
              );
            p.maxLife = 0.28 + (emitIndex % 5) * 0.03;
            p.life = p.maxLife;
            p.size = Math.max(2.6, radius * 0.24);
          }

          // Impact burst when reaching the target card
          if (elapsed >= duration && !impacted) {
            impacted = true;
            flameGroup.visible = false;
            sourceMask.visible = false;
            for (let i = 0; i < 24; i++) {
              const p = particles[emitIndex++ % particles.length];
              const theta = (i / 24) * Math.PI * 2;
              const speed = 55 + (i % 3) * 28;
              p.position.copy(end).add(new Vector3(Math.cos(theta) * 6, Math.sin(theta) * 6, 4));
              p.velocity.set(
                Math.cos(theta) * speed - Math.sin(theta) * 34,
                Math.sin(theta) * speed + Math.cos(theta) * 34,
                25 + (i % 4) * 14,
              );
              p.maxLife = 0.32;
              p.life = p.maxLife;
              p.size = Math.max(3.2, radius * 0.26);
            }
            safeResolve();
          }

          // Update all live flame particles
          particles.forEach((p, i) => {
            if (p.life <= 0) {
              dummy.scale.setScalar(0);
              dummy.updateMatrix();
              sparks.setMatrixAt(i, dummy.matrix);
              return;
            }
            p.life = Math.max(0, p.life - delta);
            p.position.addScaledVector(p.velocity, delta);
            p.velocity.multiplyScalar(Math.max(0, 1 - delta * 3.2));
            const ratio = p.life / p.maxLife;
            dummy.position.copy(p.position);
            dummy.scale.setScalar(p.size * Math.sin(ratio * Math.PI * 0.85));
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

          return elapsed > duration + 0.34;
        },
        dispose: safeResolve,
      });
    });
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
      // Bottom-left emerging, wrapping across lower-mid front to right side
      [
        new Vector3(-w * 0.56, -h * 0.56, -8),
        new Vector3(-w * 0.54, -h * 0.32, 5),
        new Vector3(-w * 0.22, -h * 0.14, 13),
        new Vector3(w * 0.28, 0, 12),
        new Vector3(w * 0.52, h * 0.14, 4),
        new Vector3(w * 0.48, h * 0.24, -4),
      ],
      // Bottom-right emerging, wrapping across mid front to left side
      [
        new Vector3(w * 0.56, -h * 0.56, -8),
        new Vector3(w * 0.54, -h * 0.26, 5),
        new Vector3(w * 0.20, -h * 0.06, 14),
        new Vector3(-w * 0.28, h * 0.10, 12),
        new Vector3(-w * 0.52, h * 0.22, 4),
        new Vector3(-w * 0.47, h * 0.30, -4),
      ],
      // Bottom-left outer tentacle climbing left edge and hooking over upper-left front
      [
        new Vector3(-w * 0.50, -h * 0.55, -10),
        new Vector3(-w * 0.56, -h * 0.18, -3),
        new Vector3(-w * 0.53, h * 0.12, 6),
        new Vector3(-w * 0.26, h * 0.28, 12),
        new Vector3(w * 0.12, h * 0.32, 10),
      ],
      // Bottom-right outer tentacle climbing right edge and hooking over upper-right front
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

        const baseRadius = Math.max(2.6, w * 0.048);

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

            // Slight organic breathing/tightening while holding the card
            const holdOffset = Math.sin(fraction * Math.PI) * squeeze;
            const centerX = pt.x - Math.sign(pt.x || 1) * holdOffset;
            const centerY = pt.y + (progress < 1 ? (1 - progress) * -6 * (1 - fraction) : 0);
            const centerZ = pt.z;

            // Taper from thick root base at the ground to a fine curled tip
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
