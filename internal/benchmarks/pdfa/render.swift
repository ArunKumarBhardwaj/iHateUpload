// Renders every page of each PDF with PDFKit (macOS Preview's engine) at 72 dpi to raw RGBA,
// and prints the page text, so score.ts can compare outputs with their source.
// Usage: swift internal/benchmarks/pdfa/render.swift outdir file.pdf ...
//   writes outdir/<file>.p<N>.rgba (width,height as 2 x UInt32 LE header) and outdir/<file>.txt
import Foundation
import PDFKit
import CoreGraphics

let outDir = CommandLine.arguments[1]
for path in CommandLine.arguments.dropFirst(2) {
    let name = (path as NSString).lastPathComponent
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { print("\(name)\tcannot open"); continue }
    var text = ""
    for i in 0..<doc.pageCount {
        guard let page = doc.page(at: i) else { continue }
        text += (page.string ?? "") + "\n"
        let box = page.bounds(for: .cropBox)
        let w = Int(box.width.rounded()), h = Int(box.height.rounded())
        var data = [UInt8](repeating: 255, count: w * h * 4)
        let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        page.draw(with: .cropBox, to: ctx)
        var header = [UInt32(w).littleEndian, UInt32(h).littleEndian]
        var out = Data(bytes: &header, count: 8)
        out.append(contentsOf: data)
        try! out.write(to: URL(fileURLWithPath: "\(outDir)/\(name).p\(i + 1).rgba"))
    }
    try! text.write(toFile: "\(outDir)/\(name).txt", atomically: true, encoding: .utf8)
    print("\(name)\t\(doc.pageCount)")
}
