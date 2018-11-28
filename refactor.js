/**
 * Final Project for 6.837 Fall 2018
 * 2D Coffee Art Fluid Simulation
 *
 * Rupayan Neogy and Jessica Tang
 **/

"use strict";

function fluidSimulator() {
  /**
   * Initializing constants & options
   **/
  let options = {};

  // Default options
  options.initVFn = options.initVFn || [
    "sin(2.0 * 3.1415 * y)",
    "sin(2.0 * 3.1415 * x)"
  ];
  options.initCFn = options.initCFn || [
    "step(1.0, mod(floor((x + 1.0) / 0.2) + floor((y + 1.0) / 0.2), 2.0))",
    "step(1.0, mod(floor((x + 1.0) / 0.2) + floor((y + 1.0) / 0.2), 2.0))",
    "step(1.0, mod(floor((x + 1.0) / 0.2) + floor((y + 1.0) / 0.2), 2.0))"
  ];
  if (options.threshold === undefined) {
    options.threshold = false;
  }
  if (options.advectV === undefined) {
    options.advectV = true;
  }
  if (options.applyPressure === undefined) {
    options.applyPressure = true;
  }
  if (options.showArrows === undefined) {
    options.showArrows = true;
  }
  if (options.dyeSpots === undefined) {
    options.dyeSpots = true;
  }

  // We'll just deal with a square for now
  const WIDTH = 400.0;
  const HEIGHT = WIDTH;
  const EPSILON = 1.0 / WIDTH;

  // We'll use 120th of a second as each timestep
  const DELTA_T = 1.0 / 120.0;

  // Arbitrary fluid density
  const DENSITY = 1.0;

  const canvas = document.querySelector("#glcanvas");
  canvas.style.margin = "0 auto";
  canvas.style.display = "block";
  const gl = getWebGL(); // Initialize the GL context

  function getWebGL() {
    // FIXME: changed for lightjs
    // let glContext = canvas.getContext("webgl");
    // // Only continue if WebGL is available and working
    // if (!glContext) {
    //   alert(
    //     "Unable to initialize WebGL. Your browser or machine may not support it. :("
    //   );
    //   return;
    // }
    //
    // // Set clear color to black, fully opaque
    // glContext.clearColor(0.0, 0.0, 0.0, 1.0);
    // // Clear the color buffer with specified clear color
    // glContext.clear(glContext.COLOR_BUFFER_BIT);

    let glContext = GL.create(canvas);
    glContext.canvas.width = WIDTH;
    glContext.canvas.height = HEIGHT;
    glContext.viewport(0, 0, glContext.canvas.width, glContext.canvas.height);

    return glContext;
  }

  class GLProgram {
    constructor(vertexShader, fragmentShader) {
      this.uniforms = {};
      this.program = gl.createProgram();

      gl.attachShader(this.program, vertexShader);
      gl.attachShader(this.program, fragmentShader);
      gl.linkProgram(this.program);

      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw gl.getProgramInfoLog(this.program);

      const uniformCount = gl.getProgramParameter(
        this.program,
        gl.ACTIVE_UNIFORMS
      );
      for (let i = 0; i < uniformCount; i++) {
        const uniformName = gl.getActiveUniform(this.program, i).name;
        this.uniforms[uniformName] = gl.getUniformLocation(
          this.program,
          uniformName
        );
      }
    }

    bind() {
      gl.useProgram(this.program);
    }
  }
  const compileShader = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw gl.getShaderInfoLog(shader);

    return shader;
  };

  // Setup standard 2-triangle mesh covering viewport
  const baseMesh = gl.Mesh.load({
    vertices: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
    coords: [[0, 1], [1, 1], [0, 0], [1, 0]]
  });; // standardMesh >> baseMesh;
  const baseVertexShaderSrc = `
    varying vec2 textureCoord;
    void main() {
      textureCoord = gl_TexCoord.xy;
      gl_Position = gl_Vertex;
    }`;

  const drawVectorFieldArrows = (() => {})();
  const makeFunctionPainter = () => {};

  let drawBlack = makeFunctionPainter("0.0", "0.0", "0.0", "1.0");

  const drawTexture = (() => {})();
  const drawTextureThreshold = (() => {})();

  const advect = (() => {})();
  const addSplat = (() => {})();
  const clampColors = (() => {})();
  const calcDivergence = (() => {})();

  const jacobiIterationForPressure = (() => {})();
  const subtractPressureGradient = (() => {})();

  const makeTexture = (names) => {};
  let textures = makeTextures([]);

  const initVFnPainter = makeFunctionPainter();
  const initCFnPainter = makeFunctionPainter();

  const reset = () => {
    textures.velocity0.drawTo(initVFnPainter);
    textures.color0.drawTo(initCFnPainter);
    textures.pressure0.drawTo(drawBlack);
  };

  drawVectorFieldArrows;
  makeFunctionPainter;
  let drawBlack = makeFunctionPainter;
  drawTexture;
  drawTextureThreshold;
  advect;
  addSplat;
  clampColors;
  calcDivergence;
  jacobiIterationForPressure;
  subtractPressureGradient;
  let textures = makeTextures;
  const initVFnPainter;
  const initCFnPainter;
  reset();

  // Returns true if the canvas is on the screen
  // If "middleIn" is true, then will only return true if the middle of the
  // canvas is within the scroll window.
  const onScreen = function(middleIn) {
    var container = canvas.offsetParent;

    var canvasBottom = canvas.offsetTop + canvas.height;
    var canvasTop = canvas.offsetTop;

    var containerTop = window.scrollY;
    var containerBottom = window.scrollY + window.innerHeight;

    if (middleIn) {
      return (
        containerTop < (canvasTop + canvasBottom) / 2 &&
        (canvasTop + canvasBottom) / 2 < containerBottom
      );
    } else {
      return containerTop < canvasBottom && containerBottom > canvasTop;
    }
  };

  // NOTE: These are the bulk of the draw and update work; above is setup
  gl.ondraw = function() {
    // If the canvas isn't visible, don't draw it
    if (!onScreen()) return;

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (options.threshold) {
      drawTextureThreshold(textures.color0);
    } else {
      drawTexture(textures.color0);
    }

    if (options.showArrows) {
      drawVectorFieldArrows(textures.velocity0);
    }
  };

  gl.onupdate = function() {
    // If the canvas isn't fully on-screen, don't run the simulation
    if (!onScreen(true)) return;

    if (options.advectV) {
      //   // Advect the velocity texture through itself, leaving the result in
      //   // textures.velocity0
      textures.velocity1.drawTo(function() {
        advect(textures.velocity0, textures.velocity0);
      });
      textures.swap("velocity0", "velocity1");
    }

    if (options.applyPressure) {
      // Calculate the divergence, leaving the result in textures.divergence
      textures.divergence.drawTo(function() {
        calcDivergence(textures.velocity0);
      });

      // Calculate the pressure, leaving the result in textures.pressure0
      var JACOBI_ITERATIONS = 10;

      for (var i = 0; i < JACOBI_ITERATIONS; i++) {
        textures.pressure1.drawTo(function() {
          jacobiIterationForPressure(textures.divergence, textures.pressure0);
        });
        textures.swap("pressure0", "pressure1");
      }

      // Subtract the pressure gradient from the advected velocity texture,
      // leaving the result in textures.velocity0
      textures.velocity1.drawTo(function() {
        subtractPressureGradient(textures.velocity0, textures.pressure0);
      });
      textures.swap("velocity0", "velocity1");
    }

    // Advect the color field, leaving the result in textures.color0
    textures.color1.drawTo(function() {
      advect(textures.color0, textures.velocity0);
    });
    textures.swap("color0", "color1");

    if (options.dyeSpots) {
      // Add a few spots slowly emitting dye to prevent the color from
      // eventually converging to the grey-ish average color of the whole fluid
      var addDyeSource = function(color, location) {
        textures.color1.drawTo(function() {
          addSplat(textures.color0, color.concat([0.0]), location, 0.01);
        });
        textures.swap("color0", "color1");
      };

      // Add red to bottom left
      addDyeSource([0.004, -0.002, -0.002], [0.2, 0.2]);

      // Add blue to the top middle
      addDyeSource([-0.002, -0.002, 0.004], [0.5, 0.9]);

      // Add green to the bottom right
      addDyeSource([-0.002, 0.004, -0.002], [0.8, 0.2]);
    }
  };

  gl.animate();

  // THE FOLLOWING IS A SUGGESTED OUTLINED METHOD
  // TODO: Declare and Compile Shaders

  // TODO: Initialize Frame Buffers
  // TODO: make new GLProgram() s for each shader

  // TODO: Create cup

  // TODO: "splat" function
  // TODO: update function

  // TODO: Event listeners to handle interaction
  // Reset the simulation on double click
  canvas.addEventListener("dblclick", reset);
}

window.onload = fluidSimulator;
