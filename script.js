/**
 * Final Project for 6.837 Fall 2018
 * 2D Coffee Art Fluid Simulation
 *
 * Rupayan Neogy and Jessica Tang
 **/

/**
 * Credits Reference
 * used as base code in project
 * [1]: https://github.com/jlfwong/blog/blob/master/static/javascripts/fluid-sim.js
 * [2]: https://github.com/PavelDoGreat/WebGL-Fluid-Simulation/blob/master/script.js
 **/

"use strict";

//
// TODO: Initializing constants & options
//
let options = {
  dyeSpots: false
  // applyPressure: false
};

// Default options
options.initVFn = options.initVFn || [
  // "y",
  // "1"
  "sin(2.0 * 3.1415 * y)",
  "sin(2.0 * 3.1415 * x)"
]; // Initial vector field
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
const WIDTH = 600.0;
const HEIGHT = WIDTH;
const EPSILON = 1.0 / WIDTH;

//
// TODO: Binding walls
//
const LOWER_BOUND = `0.25`;
const UPPER_BOUND = `0.75`;
const RADIUS = `0.25`;

// wall bounds for circle in mesh coords
// Equation Credit: [3]
const GET_WALL_COORD_SRC = `
float sqr(float x) {return x*x;}
vec2 closestWall(vec2 a) {
  vec2 wall;
  vec2 c = vec2(0.5, 0.5);  // center of circle
  float r = 0.25;           // radius of circle
  wall = c + r * (a - c) / sqrt(abs(sqr((a - c).x) + sqr((a - c).y)));
  return wall;
}
`;

// bounding initial vec field in mesh vertices
const PAINTER_OUTSIDE_SRC = `
bool outside(float x, float y) {
  // return (x > ${LOWER_BOUND * 2 - 1.0} && y > ${LOWER_BOUND * 2 -
  1.0} && x < ${UPPER_BOUND * 2 - 1.0} && y < ${UPPER_BOUND * 2 - 1.0});

  return (x*x + y*y < ${RADIUS}*${RADIUS} * 2.0);
}
`;
// bounding other forces in mesh coords
const OUTSIDE_SRC = `
bool outside(float x, float y) {
  // return !(x > ${LOWER_BOUND} && y > ${LOWER_BOUND} && x < ${UPPER_BOUND} && y < ${UPPER_BOUND});

  float nx = x - 0.5;
  float ny = y - 0.5;
  return (nx*nx + ny*ny > ${RADIUS}*${RADIUS});
}`;

// We'll use 120th of a second as each timestep
const DELTA_T = 1.0 / 120.0;

// Arbitrary fluid density
const DENSITY = 1.0;

const canvas = document.querySelector("#glcanvas");
canvas.style.margin = "0 auto";
canvas.style.display = "block";
const gl = getWebGL(); // Initialize the GL context

function getWebGL() {
  let glContext = GL.create(canvas);
  glContext.canvas.width = WIDTH;
  glContext.canvas.height = HEIGHT;
  glContext.viewport(0, 0, glContext.canvas.width, glContext.canvas.height);

  return glContext;
}

//
// TODO: General Helpers for Drawing Shaders
//

// Setup standard 2-triangle mesh covering viewport
let standardMesh = gl.Mesh.load({
  vertices: [[-1, 1], [1, 1], [-1, -1], [1, -1]],
  coords: [[0, 1], [1, 1], [0, 0], [1, 0]]
});

const standardVertexShaderSrc = `
  varying vec2 textureCoord;
  void main() {
    textureCoord = gl_TexCoord.xy;
    gl_Position = gl_Vertex;
  }`;

/**
 * Given a texture holding a 2d velocity field, draw arrows
 * showing the direction of the fluid flow. Credit: [1]
 **/
const drawVectorFieldArrows = (() => {
  let shader = new gl.Shader(
    `
      mat2 rot(float angle) {
        float c = cos(angle);
        float s = sin(angle);

        return mat2(
          vec2(c, -s),
          vec2(s, c)
        );
      }

      attribute vec2 position;
      uniform sampler2D velocity;
      void main() {
        vec2 v = texture2D(velocity, (position + 1.0) / 2.0).xy;
        float scale = 0.05 * length(v);
        float angle = atan(v.y, v.x);
        mat2 rotation = rot(-angle);
        gl_Position = vec4(
          (rotation * (scale * gl_Vertex.xy)) + position,
          0.0, 1.0);
      }
    `,
    `
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
      }`
  );

  // Triangle pointing towards positive x axis
  // with baseline on the y axis
  let triangleVertices = [[0, 0.2], [1, 0], [0, -0.2]];

  let arrowsMesh = new gl.Mesh({ triangles: false });
  arrowsMesh.addVertexBuffer("positions", "position");

  let INTERVAL = 30;

  for (let i = INTERVAL / 2; i < HEIGHT; i += INTERVAL) {
    for (let j = INTERVAL / 2; j < WIDTH; j += INTERVAL) {
      for (let k = 0; k < 3; k++) {
        arrowsMesh.vertices.push(triangleVertices[k]);
        arrowsMesh.positions.push([(2 * j) / WIDTH - 1, (2 * i) / HEIGHT - 1]);
      }
    }
  }
  arrowsMesh.compile();

  return function(velocityTexture) {
    velocityTexture.bind(0);
    shader.uniforms({
      velocity: 0
    });

    shader.draw(arrowsMesh, gl.TRIANGLES);
  };
})();

/**
 * Given glsl expressions for r, g, b, a mapping (x, y) -> a value, return
 * a function that will paint a color generated by that function evaluated at
 * every pixel of the output buffer. (x, y) will be in the range
 * ([-1, 1], [-1, 1]). Case Code Credit: [1]
 * Altered to not draw initial forces in certain area if outside of bound
 **/
const makeFunctionPainter = (r, g, b, a, bound) => {
  r = r || "0.0";
  g = g || "0.0";
  b = b || "0.0";
  a = a || "0.0";
  bound = bound || false;

  let painterSrc;

  if (bound) {
    painterSrc = `
      varying vec2 textureCoord;

      ${PAINTER_OUTSIDE_SRC}

      void main() {
        float x = 2.0 * textureCoord.x - 1.0;
        float y = 2.0 * textureCoord.y - 1.0;
        if (outside(x, y)) {
          gl_FragColor = vec4(${[r, g, b, a].join(",")});
        } else {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      }
    `;
  } else {
    painterSrc =
      `
      varying vec2 textureCoord;
      void main() {
        float x = 2.0 * textureCoord.x - 1.0;
        float y = 2.0 * textureCoord.y - 1.0;
        gl_FragColor = vec4(` +
      [r, g, b, a].join(",") +
      `);
      }
    `;
  }

  let shader = new gl.Shader(standardVertexShaderSrc, painterSrc);

  return function() {
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
};

let drawBlack = makeFunctionPainter("0.0", "0.0", "0.0", "1.0");

/**
 * Draw a texture directly to the framebuffer.
 * Will stretch to fit, but in practice the texture and the framebuffer should be
 * the same size. Credit: [1]
 **/
const drawTexture = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      varying vec2 textureCoord;
      uniform sampler2D inputTexture;
      void main() {
        gl_FragColor = texture2D(inputTexture, textureCoord);
      }
    `
  );

  return function(inputTexture) {
    inputTexture.bind(0);
    shader.uniforms({
      input: 0
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

// Draw a texture to the framebuffer, thresholding at 0.5
const drawTextureThreshold = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      varying vec2 textureCoord;
      uniform sampler2D inputTexture;
      void main() {
        gl_FragColor = step(0.5, texture2D(inputTexture, textureCoord));
      }
    `
  );

  return function(inputTexture) {
    inputTexture.bind(0);
    shader.uniforms({
      input: 0
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

//
// TODO: Shaders for Liquid Attributes
//

/**
 * Given an velocity texture and a time delta, advect the quantities in the
 * input texture into the output texture. Base Code Credit: [1]
 **/
const advectShader = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      uniform float deltaT;
      uniform sampler2D inputTexture;
      uniform sampler2D velocity;
      varying vec2 textureCoord;

      ${OUTSIDE_SRC}

      void main() {
        vec2 u = texture2D(velocity, textureCoord).xy;

        vec2 pastCoord = textureCoord - (0.5 * deltaT * u);

        // Take the current color if outside
        // if (outside(pastCoord.x, pastCoord.y)) {
          // FIXME: SAMPLING WALL COLOR
          // gl_FragColor = texture2D(inputTexture, textureCoord);
        // } else {
          gl_FragColor = texture2D(inputTexture, pastCoord);
        // }
      }
    `
  );

  return function(inputTexture, velocityTexture) {
    inputTexture.bind(0);
    velocityTexture.bind(1);

    shader.uniforms({
      deltaT: DELTA_T,
      input: 0,
      velocity: 1
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

// Make sure all the color components are between 0 and 1. Credit: [1]
const clampColors = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      uniform sampler2D inputTex;
      varying vec2 textureCoord;

      void main() {
        gl_FragColor = clamp(texture2D(inputTex, textureCoord), 0.0, 1.0);
      }
      `
  );

  return function(inputTexture) {
    inputTexture.bind(0);
    shader.uniforms({
      inputTex: 0
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

/**
 * Calculate the divergence of the advected velocity field, and multiply by
 * (2 * epsilon * rho / deltaT). Base Code Credit: [1]
 * Modified shader code for wall collisions
 **/
const calcDivergence = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      uniform float deltaT;         // Time between steps
      uniform float rho;            // Density
      uniform float epsilon;        // Distance between grid units
      uniform sampler2D velocity;   // Advected velocity field, u_a

      varying vec2 textureCoord;

      ${OUTSIDE_SRC}

      vec2 u(vec2 coord) {
        // for outer wall collisions
        vec2 multiplier = vec2(1.0,1.0);
        if (coord.x < ${LOWER_BOUND}) { coord.x = ${LOWER_BOUND}; multiplier.x = -1.0; }
        if (coord.x > ${UPPER_BOUND}) { coord.x = ${UPPER_BOUND}; multiplier.x = -1.0; }
        if (coord.y < ${LOWER_BOUND}) { coord.y = ${LOWER_BOUND}; multiplier.y = -1.0; }
        if (coord.y > ${UPPER_BOUND}) { coord.y = ${UPPER_BOUND}; multiplier.y = -1.0; }
        return multiplier * texture2D(velocity, coord).xy;
      }

      void main() {
        if (outside(textureCoord.x, textureCoord.y)) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        } else {
          gl_FragColor = vec4((-2.0 * epsilon * rho / deltaT) * (
            (u(textureCoord + vec2(epsilon, 0)).x -
             u(textureCoord - vec2(epsilon, 0)).x)
            +
            (u(textureCoord + vec2(0, epsilon)).y -
             u(textureCoord - vec2(0, epsilon)).y)
          ), 0.0, 0.0, 1.0);
        }
      }
    `
  );

  return function(velocityTexture) {
    velocityTexture.bind(0);
    shader.uniforms({
      velocity: 0,
      epsilon: EPSILON,
      deltaT: DELTA_T,
      rho: DENSITY
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

// Perform a single iteration of the Jacobi method in order to solve for
// pressure. Credit: [1]
const jacobiIterationForPressure = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      uniform float epsilon;        // Distance between grid units
      uniform sampler2D divergence; // Divergence field of advected velocity, d
      uniform sampler2D pressure;   // Pressure field from previous iteration, p^(k-1)

      varying vec2 textureCoord;

      ${OUTSIDE_SRC}

      vec2 boundary (in vec2 coord) {
        coord = clamp(coord, ${LOWER_BOUND}, ${UPPER_BOUND});
        return coord;
      }

      float d(vec2 coord) {
        return texture2D(divergence, coord).x;
      }

      float p(vec2 coord) {
        return texture2D(pressure, coord).x;
      }

      void main() {
        vec2 L = boundary(textureCoord - vec2(2.0 * epsilon, 0.0)); // left
        vec2 R = boundary(textureCoord + vec2(2.0 * epsilon, 0.0)); // right
        vec2 T = boundary(textureCoord + vec2(0.0, 2.0 * epsilon)); // top
        vec2 B = boundary(textureCoord - vec2(0.0, 2.0 * epsilon)); // bottom
        float pressure = 0.25 * (d(textureCoord)+ p(L)+ p(R)+ p(T)+ p(B));

        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
      }
    `
  );

  return function(divergenceTexture, pressureTexture) {
    divergenceTexture.bind(0);
    pressureTexture.bind(1);
    shader.uniforms({
      divergence: 0,
      pressure: 1,
      epsilon: EPSILON
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

// Subtract the pressure gradient times a constant from the advected velocity
// field. Credit: [1]
const subtractPressureGradient = (() => {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      uniform float deltaT;         // Time between steps
      uniform float rho;            // Density
      uniform float epsilon;        // Distance between grid units
      uniform sampler2D velocity;   // Advected velocity field, u_a
      uniform sampler2D pressure;   // Solved pressure field

      varying vec2 textureCoord;

      ${OUTSIDE_SRC}

      vec2 boundary (in vec2 coord) {
        coord = clamp(coord, ${LOWER_BOUND}, ${UPPER_BOUND});
        return coord;
      }

      float p(vec2 coord) {
        return texture2D(pressure, coord).x;
      }

      void main() {
        vec2 L = boundary(textureCoord - vec2(epsilon, 0.0)); // left
        vec2 R = boundary(textureCoord + vec2(epsilon, 0.0)); // right
        vec2 T = boundary(textureCoord + vec2(0.0, epsilon)); // top
        vec2 B = boundary(textureCoord - vec2(0.0, epsilon)); // bottom

        vec2 u_a = texture2D(velocity, textureCoord).xy;

        float diff_p_x = (p(R) - p(L));
        float u_x = u_a.x - deltaT/(2.0 * rho * epsilon) * diff_p_x;

        float diff_p_y = (p(T) - p(B));
        float u_y = u_a.y - deltaT/(2.0 * rho * epsilon) * diff_p_y;

        if (outside(textureCoord.x, textureCoord.y)) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        } else {
          gl_FragColor = vec4(u_x, u_y, 0.0, 0.0);
        }
      }
    `
  );

  return function(velocityTexture, pressureTexture) {
    velocityTexture.bind(0);
    pressureTexture.bind(1);
    shader.uniforms({
      velocity: 0,
      pressure: 1,
      epsilon: EPSILON,
      deltaT: DELTA_T,
      rho: DENSITY
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

const makeTextures = names => {
  let ret = {};
  names.forEach(function(name) {
    ret[name] = new gl.Texture(WIDTH, HEIGHT, { type: gl.FLOAT });
  });

  ret.swap = function(a, b) {
    var temp = ret[a];
    ret[a] = ret[b];
    ret[b] = temp;
  };

  return ret;
};

const textures = makeTextures([
  "velocity0",
  "velocity1",
  "color0",
  "color1",
  "divergence",
  "pressure0",
  "pressure1"
]);

//
// TODO: Adding liquid or "splats"
//

// Apply a "splat" of change to a given place with a given
// blob radius. The effect of the splat has an exponential falloff.
const addSplat = (function() {
  let shader = new gl.Shader(
    standardVertexShaderSrc,
    `
      uniform vec4 change;
      uniform vec2 center;
      uniform float radius;
      uniform sampler2D inputTex;

      varying vec2 textureCoord;

      void main() {
        float dx = center.x - textureCoord.x;
        float dy = center.y - textureCoord.y;
        vec4 cur = texture2D(inputTex, textureCoord);
        gl_FragColor = cur + change * exp(-(dx * dx + dy * dy) / radius);
      }
    `
  );

  return function(inputTexture, change, center, radius) {
    inputTexture.bind(0);
    shader.uniforms({
      change: change,
      center: center,
      radius: radius,
      inputTex: 0
    });
    shader.draw(standardMesh, gl.TRIANGLE_STRIP);
  };
})();

// Binding the initial forces to not be outside of boundaries
var initVFnPainter = makeFunctionPainter(
  options.initVFn[0],
  options.initVFn[1],
  0.0,
  0.0,
  true
);
var initCFnPainter = makeFunctionPainter(
  options.initCFn[0],
  options.initCFn[1],
  options.initCFn[2],
  0.0
  // true
);

//
// TODO: Code for Running GL
//
const reset = () => {
  textures.velocity0.drawTo(initVFnPainter);
  textures.color0.drawTo(initCFnPainter);
  textures.pressure0.drawTo(drawBlack);
};
reset();

// Returns true if the canvas is on the screen
// If "middleIn" is true, then will only return true if the middle of the
// canvas is within the scroll window.
var onScreen = function(middleIn) {
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

//
// TODO: Draw cup
//

//
// TODO: Update and draw functionality
//
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
    // Advect the velocity texture through itself, leaving the result in
    // textures.velocity0
    textures.velocity1.drawTo(function() {
      advectShader(textures.velocity0, textures.velocity0);
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
    advectShader(textures.color0, textures.velocity0);
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

//
// TODO: Event listeners to handle interaction
//

// Reset the simulation on double click
canvas.addEventListener("dblclick", reset);

// Mouse interaction onclick. Credit: [1]
gl.onmousemove = function(ev) {
  if (ev.dragging && ev.x > 150 && ev.x < 450 && ev.y > 150 && ev.y < 450) {
    textures.velocity1.drawTo(function() {
      addSplat(
        textures.velocity0,
        [(10.0 * ev.deltaX) / WIDTH, (-10.0 * ev.deltaY) / HEIGHT, 0.0, 0.0],
        [ev.offsetX / WIDTH, 1.0 - ev.offsetY / HEIGHT],
        0.01
      );
    });
    textures.swap("velocity0", "velocity1");
  }
};

//
// TODO: Actually animate
//
gl.animate();
