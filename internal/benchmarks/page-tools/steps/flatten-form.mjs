// Form flatten; STRIP = comma list of extra boxes to tick.
export default async function flattenForm(page) {
  for (const s of (process.env.STRIP ?? "").split(",").filter(Boolean)) {
    await page.getByLabel(new RegExp(`^${s}`)).check();
  }
}
