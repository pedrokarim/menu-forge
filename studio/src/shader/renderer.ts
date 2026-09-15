/**
 * Rendu WebGL2 d’un shader « core » du jeu sur une scène d’essai. Reproduit ce qui compte pour un
 * shader d’interface : projection orthographique en pixels d’interface (y vers le bas, `ProjMat[2][3]`
 * nul comme dans les menus), attributs de sommet du jeu, textures sans lissage, mélange alpha.
 */
import { mapErrors, prepareShader } from './glsl';
import type { ShaderError, ShaderFile } from './glsl';
import type { SceneGeometry } from './scenes';

export interface RenderResult {
  errors: ShaderError[];
  missing: string[];
  milliseconds: number;
}

const FLOAT_ATTRIBUTES: ReadonlyArray<[string, number]> = [['Position', 3], ['Color', 4], ['UV0', 2], ['Normal', 3]];
const INT_ATTRIBUTES: ReadonlyArray<[string, number]> = [['UV1', 2], ['UV2', 2]];

export class ShaderRenderer {
  private readonly gl: WebGL2RenderingContext;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 indisponible dans ce navigateur');
    this.gl = gl;
  }

  /** Compile `program` (`core/item` → `core/item.vsh` et `.fsh`) et dessine la scène à l’échelle `scale`. */
  render(program: string, files: ShaderFile[], geometry: SceneGeometry, scale: number, time: number, defines: string[] = []): RenderResult {
    const started = performance.now();
    const gl = this.gl;
    const vertex = files.find((file) => file.path === `${program}.vsh`);
    const fragment = files.find((file) => file.path === `${program}.fsh`);
    if (!vertex || !fragment) {
      return { errors: [{ file: program, line: 0, message: 'Paire .vsh / .fsh introuvable dans les fichiers chargés' }], missing: [], milliseconds: 0 };
    }
    const vs = prepareShader(vertex, files, defines);
    const fs = prepareShader(fragment, files, defines);
    const errors: ShaderError[] = [];
    const compile = (type: number, prepared: typeof vs) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, prepared.source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        // Un include commun aux deux étapes donne la même erreur deux fois : une seule suffit
        for (const error of mapErrors(gl.getShaderInfoLog(shader) ?? '', prepared.origins)) {
          if (!errors.some((known) => known.file === error.file && known.line === error.line && known.message === error.message)) errors.push(error);
        }
      }
      return shader;
    };
    const vShader = compile(gl.VERTEX_SHADER, vs);
    const fShader = compile(gl.FRAGMENT_SHADER, fs);
    const missing = [...new Set([...vs.missing, ...fs.missing])];
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.width = Math.round(geometry.width * scale);
    canvas.height = Math.round(geometry.height * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (errors.length > 0) {
      gl.deleteShader(vShader);
      gl.deleteShader(fShader);
      return { errors, missing, milliseconds: performance.now() - started };
    }
    const shaderProgram = gl.createProgram()!;
    gl.attachShader(shaderProgram, vShader);
    gl.attachShader(shaderProgram, fShader);
    gl.linkProgram(shaderProgram);
    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
      errors.push({ file: program, line: 0, message: gl.getProgramInfoLog(shaderProgram) ?? 'Liaison impossible' });
    } else {
      this.draw(shaderProgram, geometry, canvas.width, canvas.height, time);
    }
    gl.deleteProgram(shaderProgram);
    gl.deleteShader(vShader);
    gl.deleteShader(fShader);
    return { errors, missing, milliseconds: performance.now() - started };
  }

  private draw(program: WebGLProgram, geometry: SceneGeometry, pixelWidth: number, pixelHeight: number, time: number) {
    const gl = this.gl;
    gl.useProgram(program);

    // Sommets : deux triangles par quad
    const floats: number[] = [];
    const ints: number[] = [];
    for (const quad of geometry.quads) {
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const vertex = quad[index];
        floats.push(...vertex.position, ...vertex.color, ...vertex.uv, ...vertex.normal);
        ints.push(0, 10, 240, 240);
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const floatBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, floatBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floats), gl.STATIC_DRAW);
    let offset = 0;
    for (const [name, size] of FLOAT_ATTRIBUTES) {
      const location = gl.getAttribLocation(program, name);
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 12 * 4, offset * 4);
      }
      offset += size;
    }
    const intBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, intBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Int32Array(ints), gl.STATIC_DRAW);
    offset = 0;
    for (const [name, size] of INT_ATTRIBUTES) {
      const location = gl.getAttribLocation(program, name);
      if (location >= 0) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribIPointer(location, size, gl.INT, 4 * 4, offset * 4);
      }
      offset += size;
    }

    // Textures : Sampler0 = la scène, Sampler1 et Sampler2 (voile, carte de lumière) blancs
    const texture = this.texture(geometry.texture.width, geometry.texture.height, geometry.texture.data);
    const white = this.texture(1, 1, new Uint8ClampedArray([255, 255, 255, 255]));
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const location = gl.getUniformLocation(program, name);
      if (location) gl.uniform1i(location, unit);
    };
    bind(0, texture, 'Sampler0');
    bind(1, white, 'Sampler1');
    bind(2, white, 'Sampler2');

    // Uniformes du jeu (ceux que le shader déclare)
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const w = geometry.width;
    const h = geometry.height;
    const uniformMatrix = (name: string, value: number[]) => {
      const location = gl.getUniformLocation(program, name);
      if (location) gl.uniformMatrix4fv(location, false, value);
    };
    const uniform = (name: string, ...values: number[]) => {
      const location = gl.getUniformLocation(program, name);
      if (!location) return;
      if (values.length === 1) gl.uniform1f(location, values[0]);
      else if (values.length === 2) gl.uniform2f(location, values[0], values[1]);
      else if (values.length === 3) gl.uniform3f(location, values[0], values[1], values[2]);
      else gl.uniform4f(location, values[0], values[1], values[2], values[3]);
    };
    uniformMatrix('ProjMat', [2 / w, 0, 0, 0, 0, -2 / h, 0, 0, 0, 0, -1 / 1000, 0, -1, 1, 0, 1]);
    uniformMatrix('ModelViewMat', identity);
    uniformMatrix('TextureMat', identity);
    uniform('ColorModulator', 1, 1, 1, 1);
    uniform('ModelOffset', 0, 0, 0);
    uniform('FogColor', 0, 0, 0, 0);
    uniform('FogEnvironmentalStart', 1e6);
    uniform('FogEnvironmentalEnd', 1e6);
    uniform('FogRenderDistanceStart', 1e6);
    uniform('FogRenderDistanceEnd', 1e6);
    uniform('Light0_Direction', 0.2, 1, -0.7);
    uniform('Light1_Direction', -0.2, 1, 0.7);
    uniform('ScreenSize', pixelWidth, pixelHeight);
    uniform('GameTime', time);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, geometry.quads.length * 6);

    gl.bindVertexArray(null);
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(floatBuffer);
    gl.deleteBuffer(intBuffer);
    gl.deleteTexture(texture);
    gl.deleteTexture(white);
  }

  private texture(width: number, height: number, data: Uint8ClampedArray): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }
}
