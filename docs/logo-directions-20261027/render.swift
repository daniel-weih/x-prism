import AppKit
import Foundation

let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let width = 1120, height = 740
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * 2, pixelsHigh: height * 2, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
rep.size = NSSize(width: width, height: height)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
func color(_ hex: UInt32) -> NSColor { NSColor(srgbRed: CGFloat((hex >> 16) & 255)/255, green: CGFloat((hex >> 8) & 255)/255, blue: CGFloat(hex & 255)/255, alpha: 1) }
func box(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ fill: UInt32, _ radius: CGFloat = 0) {
  color(fill).setFill()
  NSBezierPath(roundedRect: NSRect(x: x, y: CGFloat(height) - y - h, width: w, height: h), xRadius: radius, yRadius: radius).fill()
}
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ fill: UInt32 = 0x24212d, _ weight: NSFont.Weight = .regular) {
  let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color(fill)]
  let str = NSAttributedString(string: value, attributes: attrs)
  str.draw(at: NSPoint(x: x, y: CGFloat(height) - y - str.size().height))
}
func icon(_ image: NSImage, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat) {
  image.draw(in: NSRect(x: x, y: CGFloat(height) - y - size, width: size, height: size))
}
box(0, 0, CGFloat(width), CGFloat(height), 0xf4f3f6)
text("PRISM TRANSLATE / LOGO EXPLORATION", 40, 30, 11, 0x8c8698, .medium)
text("让 Prism 有自己的形状。", 40, 52, 32, 0x24212d, .semibold)
text("三个不同方向 · 大图、工具栏尺寸、深色背景一起看", 40, 100, 14, 0x827b8d)
let designs = [
  ("a-prism-p.svg", "A   折光 P", "白色笔画与紫色切面构成 P，", "斜切留白呼应折射。"),
  ("b-fold.svg", "B   双语折页", "珊瑚橙与折叠纸带，", "两段笔画形成相互转换的路径。"),
  ("c-quotes.svg", "C   对译", "两枚相向的引号，", "用蓝紫与杏色表现两种语言。")
]
for (index, design) in designs.enumerated() {
  let x = CGFloat(40 + index * 353)
  let image = NSImage(contentsOf: dir.appendingPathComponent(design.0))!
  box(x, 151, 333, 510, 0xffffff, 22)
  icon(image, x + 98, 189, 138)
  text(design.1, x + 26, 362, 21, 0x24212d, .semibold)
  text(design.2, x + 26, 402, 13, 0x827b8d)
  text(design.3, x + 26, 423, 13, 0x827b8d)
  for (i, size) in [16,24,32,48].enumerated() {
    let px = x + 29 + CGFloat(i) * 66
    icon(image, px, 469 + CGFloat(48-size)/2, CGFloat(size))
    text("\(size) px", px, 527, 10, 0x99929f)
  }
  box(x + 24, 556, 285, 53, 0x25232c, 12)
  icon(image, x + 40, 574, 16)
  icon(image, x + 83, 570, 24)
  icon(image, x + 135, 566, 32)
  icon(image, x + 24, 623, 26)
  text("Prism", x + 59, 622, 21, 0x24212d, .semibold)
}
text("矢量草案 · 2026-10-27 · 尚未替换正式图标", 40, 688, 12, 0x918999)
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: dir.appendingPathComponent("comparison.png"))
