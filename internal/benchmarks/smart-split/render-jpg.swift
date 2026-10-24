// Renders every page of a PDF with PDFKit to JPEG at 150 dpi, like a scanner would, so gen.mjs can
// build image-only "scanned" bundles. Usage: swift render-jpg.swift in.pdf outdir
import Foundation
import PDFKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let path = CommandLine.arguments[1]
let outDir = CommandLine.arguments[2]
guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { fatalError("cannot open \(path)") }
let scale: CGFloat = 150.0 / 72.0
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let box = page.bounds(for: .cropBox)
    let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    // Scanner paper is never quite white.
    ctx.setFillColor(CGColor(red: 0.97, green: 0.96, blue: 0.94, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .cropBox, to: ctx)
    let image = ctx.makeImage()!
    let url = URL(fileURLWithPath: "\(outDir)/p\(String(format: "%03d", i + 1)).jpg") as CFURL
    let dest = CGImageDestinationCreateWithURL(url, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.6] as CFDictionary)
    CGImageDestinationFinalize(dest)
}
