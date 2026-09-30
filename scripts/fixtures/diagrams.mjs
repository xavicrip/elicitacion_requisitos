#!/usr/bin/env node
// Genera los diagramas de prueba de la feature 003 en e2e/fixtures/diagrams/ (T003).
// Uso: node scripts/fixtures/diagrams.mjs   (reproducible: siempre produce los mismos archivos)
//
// Los archivos grandes para probar límites (p. ej., > 10 MB) no se guardan en git: las pruebas
// los generan en memoria.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sharp = createRequire(join(root, 'apps/api/package.json'))('sharp');
const out = join(root, 'e2e/fixtures/diagrams');
mkdirSync(out, { recursive: true });

const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/**
 * SVG de un diagrama de actividades: cajas con su nombre y flechas entre cajas consecutivas.
 * Devuelve el SVG y las actividades con su `bbox` normalizada (0–1), como el modelo de la 003.
 */
function diagram(width, height, boxes) {
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<defs><marker id="a" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L9,3 L0,6 z" fill="#333"/></marker></defs>`,
  ];
  boxes.forEach((box, i) => {
    const radius = box.type === 'start' || box.type === 'end' ? box.h / 2 : 12;
    parts.push(
      `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${radius}" fill="#eef4ff" stroke="#2f5aa8" stroke-width="3"/>`,
      `<text x="${box.x + box.w / 2}" y="${box.y + box.h / 2 + 7}" font-family="sans-serif" font-size="${Math.max(12, Math.min(22, box.h / 3))}" text-anchor="middle" fill="#1d2b4f">${esc(box.label)}</text>`,
    );
    const next = boxes[i + 1];
    if (next && box.arrow !== false) {
      parts.push(
        `<line x1="${box.x + box.w / 2}" y1="${box.y + box.h}" x2="${next.x + next.w / 2}" y2="${next.y}" stroke="#333" stroke-width="2" marker-end="url(#a)"/>`,
      );
    }
  });
  parts.push('</svg>');
  const activities = boxes.map(({ label, type = 'action', x, y, w, h }) => ({
    label,
    type,
    bbox: {
      x: +(x / width).toFixed(4),
      y: +(y / height).toFixed(4),
      w: +(w / width).toFixed(4),
      h: +(h / height).toFixed(4),
    },
  }));
  return { svg: parts.join(''), activities };
}

async function png(name, width, height, boxes) {
  const { svg, activities } = diagram(width, height, boxes);
  const file = join(out, `${name}.png`);
  // compressionLevel y sin metadatos: salida determinista.
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
  writeFileSync(
    join(out, `${name}.json`),
    `${JSON.stringify({ width, height, activities }, null, 2)}\n`,
  );
  return file;
}

// 1. Proceso de compra: 6 actividades en columna (quickstart §1–§3).
const compra = [
  'Inicio',
  'Seleccionar producto',
  'Validar pago',
  'Emitir factura',
  'Enviar pedido',
  'Fin',
];
await png(
  'compra-simple',
  900,
  1200,
  compra.map((label, i) => ({
    label,
    type:
      i === 0
        ? 'start'
        : i === compra.length - 1
          ? 'end'
          : label === 'Validar pago'
            ? 'decision'
            : 'action',
    x: 300,
    y: 60 + i * 190,
    w: 300,
    h: 90,
  })),
);

// 2. Diagrama grande de 4000×3000 (navegación, quickstart §4).
await png(
  'grande-4000x3000',
  4000,
  3000,
  Array.from({ length: 24 }, (_, i) => ({
    label: `Actividad ${i + 1}`,
    x: 200 + (i % 6) * 620,
    y: 250 + Math.floor(i / 6) * 700,
    w: 420,
    h: 160,
    arrow: i % 6 !== 5,
  })),
);

// 3. Cien actividades en una rejilla de 10×10 (rendimiento, SC-002).
await png(
  'cien-actividades',
  3000,
  2000,
  Array.from({ length: 100 }, (_, i) => ({
    label: `A${i + 1}`,
    x: 60 + (i % 10) * 290,
    y: 40 + Math.floor(i / 10) * 195,
    w: 200,
    h: 110,
    arrow: false,
  })),
);

// 4. Imagen muy ancha (12 000 px): se acepta y se reduce a ≤ 8192 px (edge case).
await png(
  'enorme-12000',
  12000,
  1500,
  Array.from({ length: 12 }, (_, i) => ({
    label: `Paso ${i + 1}`,
    x: 300 + i * 980,
    y: 600,
    w: 600,
    h: 200,
    arrow: false,
  })),
);

// 5. SVG con un script y una referencia externa: se rasteriza y nunca se sirve tal cual.
const { svg: safe } = diagram(600, 400, [
  { label: 'Actividad SVG', x: 150, y: 150, w: 300, h: 100 },
]);
writeFileSync(
  join(out, 'con-script.svg'),
  safe.replace(
    '</svg>',
    `<script>alert('xss')</script><image href="https://example.com/rastreo.png" x="0" y="0" width="1" height="1"/></svg>`,
  ),
);

console.log(`Diagramas generados en ${out}`);
