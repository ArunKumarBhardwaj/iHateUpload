import { expect, test } from "bun:test";

import { acceptsFile, toolsForFiles } from "./file-match";

const pdf = { name: "Lease.PDF", type: "application/pdf" };
const photo = { name: "IMG_2041.jpg", type: "image/jpeg" };
const heic = { name: "IMG_2042.HEIC", type: "" };

test("accept rules match extensions, types, and wildcards", () => {
  expect(acceptsFile("application/pdf,.pdf", pdf)).toBe(true);
  expect(acceptsFile(".pdf", { name: "scan.pdf", type: "" })).toBe(true);
  expect(acceptsFile("image/*", photo)).toBe(true);
  expect(acceptsFile("image/png,.png", photo)).toBe(false);
});

test("one PDF leads with compress and never offers image tools", () => {
  const tools = toolsForFiles([pdf]).map((tool) => tool.id);
  expect(tools[0]).toBe("compress-pdf");
  expect(tools).toContain("sign-pdf");
  expect(tools).not.toContain("compress-image");
});

test("several PDFs lead with merge and drop single-file tools", () => {
  const tools = toolsForFiles([pdf, { ...pdf, name: "b.pdf" }]);
  expect(tools[0].id).toBe("merge-pdf");
  expect(tools.every((tool) => tool.multiple)).toBe(true);
});

test("iPhone HEIC files without a MIME type still find HEIC tools", () => {
  expect(toolsForFiles([heic])[0].id).toBe("heic-to-jpg");
});

test("unknown files match nothing", () => {
  expect(toolsForFiles([{ name: "song.mp3", type: "audio/mpeg" }])).toEqual([]);
});
