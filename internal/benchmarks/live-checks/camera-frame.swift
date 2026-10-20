// Draws a synthetic "phone photo" of a tilted document and writes raw RGB24 (1280x720) to the given path.
// Usage: swift camera-frame.swift out.rgb
import AppKit

let W = 1280, H = 720
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: W * 4, bitsPerPixel: 32)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(calibratedRed: 0.28, green: 0.2, blue: 0.14, alpha: 1).setFill()   // desk
NSRect(x: 0, y: 0, width: W, height: H).fill()
let ctx = NSGraphicsContext.current!.cgContext
ctx.translateBy(x: 640, y: 360)
ctx.rotate(by: -6 * .pi / 180)                                               // tilted page
let page = NSRect(x: -230, y: -320, width: 460, height: 640)
NSColor.white.setFill()
page.fill()
let title = [NSAttributedString.Key.font: NSFont(name: "Helvetica-Bold", size: 30)!, .foregroundColor: NSColor.black]
let body = [NSAttributedString.Key.font: NSFont(name: "Helvetica", size: 22)!, .foregroundColor: NSColor.black]
("CAMERA TEST PAGE" as NSString).draw(at: NSPoint(x: -200, y: 250), withAttributes: title)
let lines = ["Invoice number 48213", "Delivered to Sample Street 9", "Total due 1250 dollars", "Thank you for testing"]
for (i, line) in lines.enumerated() { (line as NSString).draw(at: NSPoint(x: -200, y: 180 - CGFloat(i) * 44), withAttributes: body) }
NSGraphicsContext.restoreGraphicsState()
// Drop the alpha byte: the converter wants plain RGB.
var rgb = Data(capacity: W * H * 3)
let px = rep.bitmapData!
for i in 0..<(W * H) { rgb.append(px[i * 4]); rgb.append(px[i * 4 + 1]); rgb.append(px[i * 4 + 2]) }
try! rgb.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
