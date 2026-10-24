/** Draws a small lit 3D sphere with animated heat bands for the Fireball spell. */
export function animateFireballModel(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
  if (!gl) return () => {};

  const vertexSource = `
    attribute vec3 aPosition;
    uniform float uTime;
    varying vec3 vPoint;
    varying vec3 vNormal;
    void main() {
      float yaw = uTime * 1.65;
      float pitch = 0.28 + sin(uTime * 0.8) * 0.12;
      mat3 rotateY = mat3(cos(yaw),0.0,-sin(yaw), 0.0,1.0,0.0, sin(yaw),0.0,cos(yaw));
      mat3 rotateX = mat3(1.0,0.0,0.0, 0.0,cos(pitch),sin(pitch), 0.0,-sin(pitch),cos(pitch));
      vec3 point = rotateY * rotateX * aPosition;
      vPoint = point;
      vNormal = normalize(point);
      gl_Position = vec4(point.xy * 0.91, point.z * 0.12, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    uniform float uTime;
    varying vec3 vPoint;
    varying vec3 vNormal;
    void main() {
      vec3 normal = normalize(vNormal);
      vec3 light = normalize(vec3(-0.42, 0.58, 1.0));
      float diffuse = max(dot(normal, light), 0.0);
      float rim = pow(1.0 - max(normal.z, 0.0), 2.2);
      float flow = sin(vPoint.y * 15.0 + sin(vPoint.x * 8.0 + uTime * 2.6) * 0.8 + uTime * 3.1);
      float veins = sin((vPoint.x + vPoint.z) * 19.0 - vPoint.y * 8.0 + uTime * 3.8);
      float hot = smoothstep(-0.38, 0.86, flow * 0.72 + veins * 0.28);
      vec3 deep = vec3(0.30, 0.018, 0.035);
      vec3 red = vec3(0.88, 0.075, 0.018);
      vec3 orange = vec3(1.0, 0.34, 0.025);
      vec3 gold = vec3(1.0, 0.78, 0.19);
      vec3 color = mix(deep, red, smoothstep(0.0, 0.9, hot));
      color = mix(color, orange, smoothstep(0.34, 0.92, hot));
      color = mix(color, gold, smoothstep(0.78, 1.0, hot) * (0.22 + diffuse * 0.65));
      color *= 0.42 + diffuse * 0.86;
      color += vec3(1.0, 0.25, 0.025) * rim * 0.62;
      float highlight = pow(max(dot(reflect(-light, normal), vec3(0.0,0.0,1.0)), 0.0), 18.0);
      color += vec3(1.0, 0.84, 0.42) * highlight * 0.78;
      gl_FragColor = vec4(color, 0.98);
    }
  `;

  const compile = (kind: number, source: string): WebGLShader | null => {
    const shader = gl.createShader(kind);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); return null; }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) { if (vertex) gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment); return () => {}; }
  const program = gl.createProgram();
  if (!program) { gl.deleteShader(vertex); gl.deleteShader(fragment); return () => {}; }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); return () => {}; }

  const slices = 28;
  const stacks = 20;
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let y = 0; y <= stacks; y += 1) {
    const latitude = y / stacks * Math.PI - Math.PI / 2;
    for (let x = 0; x <= slices; x += 1) {
      const longitude = x / slices * Math.PI * 2;
      vertices.push(Math.cos(latitude) * Math.cos(longitude), Math.sin(latitude), Math.cos(latitude) * Math.sin(longitude));
      if (y < stacks && x < slices) {
        const a = y * (slices + 1) + x;
        const b = a + slices + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
  }
  const vertexBuffer = gl.createBuffer();
  const indexBuffer = gl.createBuffer();
  if (!vertexBuffer || !indexBuffer) { gl.deleteBuffer(vertexBuffer); gl.deleteBuffer(indexBuffer); gl.deleteProgram(program); return () => {}; }
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  gl.useProgram(program);
  const position = gl.getAttribLocation(program, 'aPosition');
  const time = gl.getUniformLocation(program, 'uTime');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  canvas.width = 128;
  canvas.height = 128;

  let frame = 0;
  let start = 0;
  let stopped = false;
  const draw = (now: number) => {
    if (stopped) return;
    if (!start) start = now;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(time, (now - start) / 1000);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    gl.deleteBuffer(vertexBuffer);
    gl.deleteBuffer(indexBuffer);
    gl.deleteProgram(program);
  };
}
