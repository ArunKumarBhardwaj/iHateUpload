// Env: MODE = Dark mode|Full invert|Sepia|Grayscale, ENGINE = vector|raster, DPI (raster only).
export default async function invert(page) {
  await page.getByRole("button", { name: process.env.MODE ?? "Dark mode", exact: true }).click();
  if (process.env.ENGINE === "raster") {
    await page.getByRole("button", { name: "Flatten to pictures" }).click();
    if (process.env.DPI) await page.getByRole("button", { name: `${process.env.DPI} DPI` }).click();
  }
  await page.waitForTimeout(1500);
}
