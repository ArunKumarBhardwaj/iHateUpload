// Opens PDFs with PDFKit (the engine behind macOS Preview) and counts pages and page markers.
// Usage: swift internal/benchmarks/repair/pdfkit-check.swift file.pdf ...
import Foundation
import PDFKit

for path in CommandLine.arguments.dropFirst() {
    let name = (path as NSString).lastPathComponent
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
        print("\(name)\tPDFKit cannot open")
        continue
    }
    var markers = 0
    for i in 0..<doc.pageCount {
        let text = doc.page(at: i)?.string ?? ""
        markers += text.components(separatedBy: "-MARKER").count - 1
    }
    print("\(name)\tpages \(doc.pageCount)\tmarkers \(markers)")
}
