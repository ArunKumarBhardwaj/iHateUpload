// Renders every page of a PDF into one contact sheet PNG with PDFKit. Usage: swift render-pages.swift in.pdf out.png
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { exit(1) }
let width: CGFloat = 640
var images: [NSImage] = []
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let box = page.bounds(for: .mediaBox)
    images.append(page.thumbnail(of: NSSize(width: width, height: width * box.height / box.width), for: .mediaBox))
}
let gap: CGFloat = 12
let height = images.reduce(0) { $0 + $1.size.height + gap }
let sheet = NSImage(size: NSSize(width: width, height: height))
sheet.lockFocus()
NSColor.gray.setFill()
NSRect(x: 0, y: 0, width: width, height: height).fill()
var y = height
for image in images {
    y -= image.size.height
    image.draw(in: NSRect(x: 0, y: y, width: width, height: image.size.height))
    y -= gap
}
sheet.unlockFocus()
let rep = NSBitmapImageRep(data: sheet.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
