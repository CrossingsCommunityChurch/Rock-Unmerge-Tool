// Build-time icon generator. Renders an SVG mark to a 1024x1024 PNG that
// electron-builder uses as the source for both .icns (macOS) and .ico
// (Windows). Re-run with `node build/generate-icon.mjs` if the design changes.
//
// Design: two stylized person silhouettes back-to-back, a dashed vertical
// separator between them, on a deep-teal rounded-square background. Reads as
// "two records being unmerged" at any size.

import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SIZE = 1024

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"  stop-color="#1B4965"/>
      <stop offset="100%" stop-color="#0D2A38"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="0.6"/>
    </filter>
  </defs>

  <!-- Rounded-square background -->
  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="200" ry="200" fill="url(#bg)"/>

  <!-- Subtle inner highlight along the top edge -->
  <rect x="40" y="40" width="${SIZE - 80}" height="${SIZE - 80}" rx="160" ry="160"
        fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-width="2"/>

  <!-- Person silhouettes. Each centered on its half of the canvas, slightly
       tilted outward to suggest the split. -->

  <!-- LEFT person, white -->
  <g transform="translate(330,560) rotate(-6)">
    <circle cx="0" cy="-200" r="105" fill="#ffffff" filter="url(#soft)"/>
    <path d="M -190 200
             C -190 30 -110 -20 0 -20
             C 110 -20 190 30 190 200
             L 190 260
             L -190 260 Z"
          fill="#ffffff" filter="url(#soft)"/>
  </g>

  <!-- RIGHT person, accent cyan -->
  <g transform="translate(694,560) rotate(6)">
    <circle cx="0" cy="-200" r="105" fill="#62B6CB" filter="url(#soft)"/>
    <path d="M -190 200
             C -190 30 -110 -20 0 -20
             C 110 -20 190 30 190 200
             L 190 260
             L -190 260 Z"
          fill="#62B6CB" filter="url(#soft)"/>
  </g>

  <!-- Dashed vertical separator -->
  <line x1="${SIZE / 2}" y1="240" x2="${SIZE / 2}" y2="820"
        stroke="#ffffff" stroke-opacity="0.55" stroke-width="14"
        stroke-dasharray="36 28" stroke-linecap="round"/>
</svg>`

async function main() {
  const pngPath = join(__dirname, 'icon.png')
  const svgPath = join(__dirname, 'icon.svg')
  await writeFile(svgPath, svg, 'utf8')
  await sharp(Buffer.from(svg)).resize(SIZE, SIZE).png({ compressionLevel: 9 }).toFile(pngPath)
  console.log(`Wrote ${svgPath}`)
  console.log(`Wrote ${pngPath} (${SIZE}x${SIZE})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
