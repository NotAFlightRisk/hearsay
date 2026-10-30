const PI = '3.14159265';

export const globeVertex = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPos = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vView = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const globeFragment = /* glsl */ `
  uniform vec3 uOcean;
  uniform vec3 uGrid;
  uniform vec3 uNight;
  uniform vec3 uRim;
  uniform vec3 uSun;
  uniform float uDaylight;
  uniform float uGlow;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 p = normalize(vPos);
    // a line every 15 degrees, like the chart it's pretending to be
    vec2 grid = vec2(asin(p.y), atan(p.x, p.z)) * (12.0 / ${PI});
    vec2 dist = abs(fract(grid - 0.5) - 0.5) / fwidth(grid);
    float line = 1.0 - min(min(dist.x, dist.y), 1.0);
    vec3 colour = mix(uOcean, uGrid, line * 0.55);
    float day = smoothstep(-0.15, 0.15, dot(p, uSun));
    colour = mix(colour, mix(colour, uNight, 0.4), (1.0 - day) * uDaylight);
    float edge = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.5);
    gl_FragColor = vec4(mix(colour, uRim, edge * uGlow), 1.0);
  }
`;

export const dotsVertex = /* glsl */ `
  attribute float aCountry;
  uniform sampler2D uHeat;
  uniform float uCountries;
  uniform float uSize;
  uniform float uRef;
  varying vec2 vHeat;
  varying float vFacing;
  void main() {
    vHeat = texture2D(uHeat, vec2((aCountry + 0.5) / uCountries, 0.5)).rg;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = uSize * (0.85 + 0.45 * vHeat.r + 0.5 * vHeat.g) * clamp(uRef / -view.z, 0.7, 2.6);
    vFacing = dot(normalize(position), normalize(cameraPosition - position));
  }
`;

export const dotsFragment = /* glsl */ `
  uniform vec3 uLand;
  uniform vec3 uPressure;
  uniform vec3 uAlarm;
  varying vec2 vHeat;
  varying float vFacing;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = (1.0 - smoothstep(0.36, 0.5, d)) * smoothstep(0.0, 0.3, vFacing);
    if (alpha < 0.02) discard;
    vec3 colour = mix(mix(uLand, uPressure, vHeat.r * 0.75), uAlarm, vHeat.g);
    gl_FragColor = vec4(colour, alpha);
  }
`;

const kindColour = /* glsl */ `
  uniform vec3 uKinds[5];
  vec3 kindColour(float kind) {
    if (kind < 0.5) return uKinds[0];
    if (kind < 1.5) return uKinds[1];
    if (kind < 2.5) return uKinds[2];
    if (kind < 3.5) return uKinds[3];
    return uKinds[4];
  }
`;

export const arcsVertex = /* glsl */ `
  attribute float aU;
  attribute float aSide;
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute vec2 aTime;
  attribute float aKind;
  uniform float uTime;
  uniform float uPixel;
  uniform float uWidth;
  varying float vU;
  varying float vSide;
  varying float vHead;
  varying float vKind;
  varying float vDuration;
  varying float vLength;

  vec3 arcPoint(float u, float omega, float lift) {
    float s = sin(omega);
    vec3 p = s < 0.0001 ? aStart : (sin((1.0 - u) * omega) * aStart + sin(u * omega) * aEnd) / s;
    return normalize(p) * (1.0 + lift * sin(${PI} * u));
  }

  void main() {
    float omega = acos(clamp(dot(aStart, aEnd), -1.0, 1.0));
    float lift = 0.012 + 0.14 * omega / ${PI};
    vec3 here = arcPoint(aU, omega, lift);
    vec3 along = arcPoint(min(aU + 0.01, 1.0), omega, lift) - arcPoint(max(aU - 0.01, 0.0), omega, lift);
    // a ribbon turned to face the camera, widened by however big a pixel is at that depth
    vec3 across = normalize(cross(along, cameraPosition - here) + 1e-6);
    float depth = -(modelViewMatrix * vec4(here, 1.0)).z;
    float width = uWidth * (aKind > 2.5 && aKind < 3.5 ? 3.0 : 1.0);
    here += across * aSide * 0.5 * width * uPixel * depth;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(here, 1.0);
    vU = aU;
    vSide = aSide;
    vHead = (uTime - aTime.x) / aTime.y;
    vKind = aKind;
    vDuration = aTime.y;
    vLength = omega;
  }
`;

export const arcsFragment = /* glsl */ `
  ${kindColour}
  uniform float uTail;
  uniform float uLinger;
  uniform float uDim;
  varying float vU;
  varying float vSide;
  varying float vHead;
  varying float vKind;
  varying float vDuration;
  varying float vLength;
  void main() {
    float behind = vHead - vU;
    if (behind < 0.0) discard;
    float pen = (1.0 - smoothstep(0.0, uTail, behind));
    float ink = exp(-behind * vDuration / uLinger);
    float alpha = max(pen, ink * 0.45);
    float side = abs(vSide);
    if (vKind > 2.5 && vKind < 3.5) {
      // a cold front: a line with triangles along one side
      float tooth = 1.0 - abs(fract(vU * max(vLength * 30.0, 3.0)) * 2.0 - 1.0);
      float shape = vSide < 0.0 ? step(side, 0.3) : step((vSide - 0.3) / 0.7, tooth);
      alpha *= shape;
    } else {
      alpha *= 1.0 - smoothstep(0.5, 1.0, side);
    }
    if (vKind < 3.5) alpha *= uDim;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(kindColour(vKind), alpha);
  }
`;

export const nodesVertex = /* glsl */ `
  attribute float aHit;
  attribute float aHeat;
  attribute float aKind;
  attribute float aFocus;
  uniform float uTime;
  uniform float uTau;
  uniform float uRef;
  uniform float uPixelRatio;
  varying float vHeat;
  varying float vFlash;
  varying float vKind;
  varying float vFocus;
  varying float vFacing;
  void main() {
    float since = max(uTime - aHit, 0.0);
    vHeat = aHeat * exp(-since / uTau);
    vFlash = exp(-since * 2.0);
    vKind = aKind;
    vFocus = aFocus;
    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    float size = 3.0 + 2.5 * log(1.0 + vHeat) + 7.0 * vFlash + 7.0 * aFocus;
    gl_PointSize = size * uPixelRatio * clamp(uRef / -view.z, 0.7, 2.2);
    vFacing = dot(normalize(position), normalize(cameraPosition - position));
  }
`;

export const nodesFragment = /* glsl */ `
  ${kindColour}
  uniform vec3 uInk;
  uniform float uDim;
  varying float vHeat;
  varying float vFlash;
  varying float vKind;
  varying float vFocus;
  varying float vFacing;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = (1.0 - smoothstep(0.3, 0.5, d));
    float ring = (1.0 - smoothstep(0.85, 1.0, d)) * smoothstep(0.62, 0.75, d) * max(vFlash, vFocus);
    float seen = clamp(0.2 + vHeat, 0.0, 1.0);
    float alpha = (core * seen + ring) * smoothstep(0.0, 0.2, vFacing);
    alpha *= mix(uDim, 1.0, vFocus);
    if (alpha < 0.02) discard;
    vec3 colour = mix(uInk, kindColour(vKind), clamp(vFlash * 1.5 + vFocus, 0.0, 1.0));
    gl_FragColor = vec4(colour, alpha);
  }
`;

export const ringsVertex = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec3 aCentre;
  attribute vec2 aTime;
  attribute float aKind;
  attribute float aSize;
  uniform float uTime;
  varying vec2 vCorner;
  varying float vAge;
  varying float vKind;
  void main() {
    vec3 n = normalize(aCentre);
    vec3 t = normalize(cross(abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n));
    vec3 b = cross(n, t);
    float age = clamp((uTime - aTime.x) / aTime.y, 0.0, 1.0);
    float radius = aSize * (0.1 + 0.9 * (1.0 - pow(1.0 - age, 3.0)));
    vec3 p = n * 1.004 + (t * aCorner.x + b * aCorner.y) * radius;
    vCorner = aCorner;
    vAge = uTime < aTime.x ? 1.0 : age;
    vKind = aKind;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const ringsFragment = /* glsl */ `
  ${kindColour}
  uniform float uDim;
  varying vec2 vCorner;
  varying float vAge;
  varying float vKind;
  void main() {
    float d = length(vCorner);
    float ring = smoothstep(0.8, 0.9, d) * (1.0 - smoothstep(0.92, 1.0, d));
    float alpha = ring * (1.0 - vAge) * (vKind > 2.5 ? 1.0 : uDim);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(kindColour(vKind), alpha);
  }
`;

export const stationsVertex = /* glsl */ `
  uniform float uPixelRatio;
  uniform float uSize;
  varying float vFacing;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize * uPixelRatio;
    vFacing = dot(normalize(position), normalize(cameraPosition - position));
  }
`;

export const stationsFragment = /* glsl */ `
  uniform vec3 uInk;
  uniform vec3 uPaper;
  varying float vFacing;
  void main() {
    // a weather station circle: ink ring, paper inside, a dot in the middle
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float ink = max(smoothstep(0.55, 0.7, d), (1.0 - smoothstep(0.18, 0.3, d)));
    float alpha = (1.0 - smoothstep(0.86, 1.0, d)) * smoothstep(0.0, 0.2, vFacing);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(mix(uPaper, uInk, ink), alpha);
  }
`;
