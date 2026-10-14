// Renders every page of a PDF to a PNG, scaled so the page is `width` px wide, on a white background.
// Usage: pdf2png <in.pdf> <outDir> <width>   -> outDir/p1.png, p2.png ... ; prints "pages=<n>".
import AppKit
import PDFKit

let a = CommandLine.arguments
guard a.count == 4, let doc = PDFDocument(url: URL(fileURLWithPath: a[1])), let width = Double(a[3]) else {
  FileHandle.standardError.write("usage: pdf2png in.pdf outDir width\n".data(using: .utf8)!)
  exit(2)
}
try FileManager.default.createDirectory(atPath: a[2], withIntermediateDirectories: true)
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { continue }
  let box = page.bounds(for: .mediaBox)
  let scale = width / Double(box.width)
  let w = Int(width.rounded()), h = Int((Double(box.height) * scale).rounded())
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
  ctx.translateBy(x: -box.minX, y: -box.minY)
  page.draw(with: .mediaBox, to: ctx)
  guard let img = ctx.makeImage() else { continue }
  let rep = NSBitmapImageRep(cgImage: img)
  try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "\(a[2])/p\(i + 1).png"))
}
print("pages=\(doc.pageCount)")
