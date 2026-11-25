import * as THREE from 'three';

export interface ProceduralTextureSet {
  stoneColor: THREE.CanvasTexture;
  stoneBump: THREE.CanvasTexture;
  cobbleColor: THREE.CanvasTexture;
  cobbleBump: THREE.CanvasTexture;
  woodColor: THREE.CanvasTexture;
  woodBump: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(size = 256): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function createStoneMasonryTextures(maxAniso: number): {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const size = 256;
  const [cCanvas, cCtx] = makeCanvas(size);
  const [bCanvas, bCtx] = makeCanvas(size);
  const rand = seededRand(1042);

  cCtx.fillStyle = '#535763';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#252525';
  bCtx.fillRect(0, 0, size, size);

  const rows = 8;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const cols = 4;
    const colW = size / cols;
    const offset = (r % 2) * (colW * 0.5);
    for (let c = -1; c <= cols; c++) {
      const x = c * colW + offset;
      const y = r * rowH;
      const shade = 112 + Math.floor(rand() * 36);
      const warm = Math.floor(rand() * 14);
      cCtx.fillStyle = `rgb(${shade + warm}, ${shade + Math.floor(warm * 0.6)}, ${shade - 4})`;
      cCtx.fillRect(x + 2, y + 2, colW - 4, rowH - 4);

      // Subtle bevel highlight
      cCtx.fillStyle = 'rgba(255,255,255,0.08)';
      cCtx.fillRect(x + 2, y + 2, colW - 4, 3);

      // Bump height
      const bVal = 175 + Math.floor(rand() * 55);
      bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
      bCtx.fillRect(x + 3, y + 3, colW - 6, rowH - 6);
    }
  }

  // Stone grain speckles
  for (let i = 0; i < 650; i++) {
    const px = rand() * size;
    const py = rand() * size;
    const a = rand() * 0.14;
    cCtx.fillStyle = rand() > 0.5 ? `rgba(255,245,230,${a})` : `rgba(20,22,30,${a})`;
    cCtx.fillRect(px, py, 2, 2);
  }

  const color = new THREE.CanvasTexture(cCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.anisotropy = maxAniso;

  const bump = new THREE.CanvasTexture(bCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = maxAniso;

  return { color, bump };
}

function createCobbleTextures(maxAniso: number): {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const size = 256;
  const [cCanvas, cCtx] = makeCanvas(size);
  const [bCanvas, bCtx] = makeCanvas(size);
  const rand = seededRand(8871);

  cCtx.fillStyle = '#47433c';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#1d1d1d';
  bCtx.fillRect(0, 0, size, size);

  const step = 32;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const jitterX = (rand() - 0.5) * 6;
      const jitterY = (rand() - 0.5) * 6;
      const w = step - 6 + (rand() - 0.5) * 4;
      const h = step - 6 + (rand() - 0.5) * 4;
      const base = 110 + Math.floor(rand() * 38);
      cCtx.fillStyle = `rgb(${base + 12}, ${base + 5}, ${base - 6})`;
      cCtx.beginPath();
      cCtx.roundRect(x + 3 + jitterX * 0.3, y + 3 + jitterY * 0.3, w, h, 6);
      cCtx.fill();

      const bVal = 185 + Math.floor(rand() * 55);
      bCtx.fillStyle = `rgb(${bVal},${bVal},${bVal})`;
      bCtx.beginPath();
      bCtx.roundRect(x + 4 + jitterX * 0.3, y + 4 + jitterY * 0.3, w - 2, h - 2, 5);
      bCtx.fill();
    }
  }

  const color = new THREE.CanvasTexture(cCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.anisotropy = maxAniso;

  const bump = new THREE.CanvasTexture(bCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = maxAniso;

  return { color, bump };
}

function createWoodTextures(maxAniso: number): {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
} {
  const size = 256;
  const [cCanvas, cCtx] = makeCanvas(size);
  const [bCanvas, bCtx] = makeCanvas(size);
  const rand = seededRand(5150);

  cCtx.fillStyle = '#5c3c24';
  cCtx.fillRect(0, 0, size, size);
  bCtx.fillStyle = '#808080';
  bCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 64; i++) {
    const x = i * 4;
    const tone = 72 + Math.floor(rand() * 36);
    cCtx.fillStyle = `rgb(${tone + 20}, ${Math.floor(tone * 0.72)}, ${Math.floor(tone * 0.44)})`;
    cCtx.fillRect(x, 0, 4, size);

    const bv = 110 + Math.floor(rand() * 80);
    bCtx.fillStyle = `rgb(${bv},${bv},${bv})`;
    bCtx.fillRect(x, 0, 3, size);
  }

  const color = new THREE.CanvasTexture(cCanvas);
  color.colorSpace = THREE.SRGBColorSpace;
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.anisotropy = maxAniso;

  const bump = new THREE.CanvasTexture(bCanvas);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = maxAniso;

  return { color, bump };
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const [canvas, ctx] = makeCanvas(size);
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(6, 8, 14, 0.72)');
  grad.addColorStop(0.55, 'rgba(6, 8, 14, 0.34)');
  grad.addColorStop(1, 'rgba(6, 8, 14, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createProceduralTextureSet(renderer: THREE.WebGLRenderer): ProceduralTextureSet {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const stone = createStoneMasonryTextures(maxAniso);
  const cobble = createCobbleTextures(maxAniso);
  const wood = createWoodTextures(maxAniso);
  const contactShadow = createContactShadowTexture();

  return {
    stoneColor: stone.color,
    stoneBump: stone.bump,
    cobbleColor: cobble.color,
    cobbleBump: cobble.bump,
    woodColor: wood.color,
    woodBump: wood.bump,
    contactShadow,
    dispose() {
      stone.color.dispose();
      stone.bump.dispose();
      cobble.color.dispose();
      cobble.bump.dispose();
      wood.color.dispose();
      wood.bump.dispose();
      contactShadow.dispose();
    },
  };
}
