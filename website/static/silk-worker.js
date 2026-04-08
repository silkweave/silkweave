/* WebGL silk background — runs in a Web Worker via OffscreenCanvas */

let gl, canvas, uRes, uTime, animId = 0
const startTime = performance.now()

const VS = `
  attribute vec2 a_position;
  void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FS = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;

  mat2 rot(float x) {
    return mat2(cos(x), -sin(x), sin(x), cos(x));
  }

  float height(vec2 p, float t) {
    return sin(p.x) + sin(p.x + p.y) + cos(p.y) / 1.5 + sin(t + p.x) + 5.0;
  }

  float map(vec3 p, float t) {
    return p.y - height(p.xz, t);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

    float t = u_time * 0.4;

    vec3 ray = normalize(vec3(uv, 1.0));
    ray.yz *= rot(sin(t) / 3.0 + 1.5);
    ray.xz *= rot((sin(t) / 2.0 + 1.0) / 5.0);

    float d = 0.0;
    for (int i = 0; i < 29; i++) {
      d += map(vec3(t, 0.0, t / 2.0) + ray * d, t) * 0.5;
    }

    float fog = 1.0 / (1.0 + d * d * 0.005);

    vec3 c1 = vec3(0.247, 0.180, 0.718);
    vec3 c2 = vec3(0.475, 0.196, 0.718);
    vec3 c3 = vec3(0.075, 0.310, 0.706);
    vec3 c4 = vec3(0.216, 0.788, 0.851);

    float blend = fog * 0.6 + uv.x * 0.2 + 0.2;
    vec3 warm = mix(c1, c2, smoothstep(0.0, 0.5, blend));
    vec3 cool = mix(c3, c4, smoothstep(0.5, 1.0, blend));
    vec3 tint = mix(warm, cool, smoothstep(0.45, 0.85, blend));

    vec3 col = tint * fog * fog * 0.45;

    gl_FragColor = vec4(col, 1.0);
  }
`

function compile(type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}

function setup() {
  const prog = gl.createProgram()
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS))
  gl.linkProgram(prog)
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)

  const aPos = gl.getAttribLocation(prog, 'a_position')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  uRes = gl.getUniformLocation(prog, 'u_resolution')
  uTime = gl.getUniformLocation(prog, 'u_time')
}

function frame() {
  gl.uniform2f(uRes, canvas.width, canvas.height)
  gl.uniform1f(uTime, (performance.now() - startTime) / 1000)
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  animId = requestAnimationFrame(frame)
}

self.onmessage = function(e) {
  switch (e.data.type) {
    case 'init':
      canvas = e.data.canvas
      gl = canvas.getContext('webgl')
      if (!gl) return

      canvas.width = e.data.width
      canvas.height = e.data.height
      gl.viewport(0, 0, canvas.width, canvas.height)

      setup()
      frame()
      self.postMessage({ type: 'ready' })
      break

    case 'resize':
      if (!canvas || !gl) return
      canvas.width = e.data.width
      canvas.height = e.data.height
      gl.viewport(0, 0, canvas.width, canvas.height)
      break

    case 'pause':
      if (animId) { cancelAnimationFrame(animId); animId = 0 }
      break

    case 'resume':
      if (!animId && gl) frame()
      break
  }
}
