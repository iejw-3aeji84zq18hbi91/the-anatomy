// Small WebGL2 helpers: programs with cached uniforms, textures, render targets.

export class Program {
  // The two shaders are compiled and the program linked without asking for the result: asking makes the driver finish the
  // work on the spot, on the main thread. check() asks (and throws with the log); done() says, without blocking, whether
  // the driver has finished (KHR_parallel_shader_compile), so a caller can wait across frames. Review finding V25.
  constructor(gl, src, name, { defer = false } = {}) {
    this.gl = gl; this.name = name; this.loc = new Map(); this.src = src;
    const mk = (type, text) => { const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; };
    const p = (this.p = gl.createProgram());
    this.vs = mk(gl.VERTEX_SHADER, src.vs); this.fs = mk(gl.FRAGMENT_SHADER, src.fs);
    gl.attachShader(p, this.vs); gl.attachShader(p, this.fs);
    gl.linkProgram(p);
    if (!defer) this.check();
  }
  done(ext) { return !ext || !!this.gl.getProgramParameter(this.p, ext.COMPLETION_STATUS_KHR); }
  check() {
    const gl = this.gl;
    if (this.checked || gl.isContextLost()) return this;
    if (!gl.getProgramParameter(this.p, gl.LINK_STATUS)) {
      for (const [s, text, kind] of [[this.vs, this.src.vs, 'vs'], [this.fs, this.src.fs, 'fs']]) {
        if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) continue;
        const log = gl.getShaderInfoLog(s) || '';
        const line = +(log.match(/ERROR: \d+:(\d+)/) || [])[1] || 0;
        const ctx = text.split('\n').slice(Math.max(0, line - 3), line + 1).join('\n');
        throw new Error(`shader ${this.name} (${kind}): ${log}\n${ctx}`);
      }
      throw new Error(`link ${this.name}: ${gl.getProgramInfoLog(this.p)}`);
    }
    gl.deleteShader(this.vs); gl.deleteShader(this.fs);
    this.checked = true; this.src = null;
    return this;
  }
  use() { this.gl.useProgram(this.p); return this; }
  u(n) { let l = this.loc.get(n); if (l === undefined) { l = this.gl.getUniformLocation(this.p, n); this.loc.set(n, l); } return l; }
  f(n, a, b, c, d) {
    const gl = this.gl, l = this.u(n); if (l === null) return this;
    if (d !== undefined) gl.uniform4f(l, a, b, c, d); else if (c !== undefined) gl.uniform3f(l, a, b, c); else if (b !== undefined) gl.uniform2f(l, a, b); else gl.uniform1f(l, a);
    return this;
  }
  v3(n, v) { const l = this.u(n); if (l !== null) this.gl.uniform3f(l, v[0], v[1], v[2]); return this; }
  v4(n, v) { const l = this.u(n); if (l !== null) this.gl.uniform4f(l, v[0], v[1], v[2], v[3]); return this; }
  v4a(n, arr) { const l = this.u(n); if (l !== null) this.gl.uniform4fv(l, arr); return this; }
  i(n, a, b) { const l = this.u(n); if (l !== null) { if (b !== undefined) this.gl.uniform2i(l, a, b); else this.gl.uniform1i(l, a); } return this; }
  m4(n, m) { const l = this.u(n); if (l !== null) this.gl.uniformMatrix4fv(l, false, m); return this; }
  m3(n, m) { const l = this.u(n); if (l !== null) this.gl.uniformMatrix3fv(l, false, m); return this; }
  tex(n, unit, t) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); return this.i(n, unit); }
}

export function texture(gl, w, h, { internal, format, type, filter = gl.LINEAR, data = null, mips = false }) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// A colour target (half-float HDR by default), optionally with a sampleable depth texture.
export function target(gl, w, h, { depth = false, mips = false, rgba8 = false } = {}) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const color = rgba8
    ? texture(gl, w, h, { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.NEAREST })
    : texture(gl, w, h, { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, mips });
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  let depthTex = null;
  if (depth) {
    depthTex = texture(gl, w, h, { internal: gl.DEPTH_COMPONENT24, format: gl.DEPTH_COMPONENT, type: gl.UNSIGNED_INT, filter: gl.NEAREST });
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  }
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) throw new Error('render target incomplete');
  return {
    fb, color, depth: depthTex, w, h,
    dispose() { gl.deleteFramebuffer(fb); gl.deleteTexture(color); if (depthTex) gl.deleteTexture(depthTex); },
  };
}
