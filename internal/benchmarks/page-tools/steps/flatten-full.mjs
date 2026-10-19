// Env: DPI (default 150), STRIP = comma list of labels to tick (e.g. "Annotations,Form fields").
export default async function flattenFull(page) {
  await page.getByRole("button", { name: "Whole page as picture" }).click();
  await page.getByRole("button", { name: process.env.DPI ?? "150", exact: true }).click();
  for (const s of (process.env.STRIP ?? "").split(",").filter(Boolean)) {
    await page.getByLabel(new RegExp(`^${s}`)).check();
  }
}
