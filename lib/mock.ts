export function mockImage(prompt: string) {
  const hue = [...prompt].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
  const safe = prompt.slice(0, 40).replace(/[<>&'"]/g, '')
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='768'>` +
    `<rect width='100%' height='100%' fill='hsl(${hue},40%,35%)'/>` +
    `<text x='24' y='60' font-size='40' fill='#fff' font-family='monospace'>${safe}</text></svg>`
  return { imageUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: 1024, height: 768 }
}
