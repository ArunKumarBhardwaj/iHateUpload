// Drags the bottom-right handle inward ~100px and the top-left ~50px; margins should grow.
export default async function cropDrag(page) {
  const before = await page.locator("#crop-bottom").inputValue();
  await page.locator('[aria-label="Bottom right corner"]').scrollIntoViewIfNeeded();
  const h = await page.locator('[aria-label="Bottom right corner"]').boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x - 80, h.y - 100, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator("#crop-bottom").inputValue();
  console.log("bottom margin mm", before, "->", after);
  if (!(Number(after) > Number(before))) throw new Error("drag did not change margin");
}
