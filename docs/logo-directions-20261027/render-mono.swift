import AppKit
import Foundation
let dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let assets = dir.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("assets")
let svg = try String(contentsOf: assets.appendingPathComponent("icon.svg"), encoding: .utf8)
let icon = NSImage(data: svg.data(using: .utf8)!)!
let lightIcon = NSImage(data: svg.replacingOccurrences(of: "#252525", with: "#eeeeee").data(using: .utf8)!)!
let w = 800, h = 450
let rep = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:w*2,pixelsHigh:h*2,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
rep.size = NSSize(width:w,height:h)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:rep)
func color(_ gray:CGFloat)->NSColor { NSColor(white:gray,alpha:1) }
func rect(_ x:CGFloat,_ y:CGFloat,_ width:CGFloat,_ height:CGFloat,_ gray:CGFloat,_ radius:CGFloat=0) {
 color(gray).setFill(); NSBezierPath(roundedRect:NSRect(x:x,y:CGFloat(h)-y-height,width:width,height:height),xRadius:radius,yRadius:radius).fill()
}
func text(_ s:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ gray:CGFloat=0.15,_ weight:NSFont.Weight = .regular){
 let str = NSAttributedString(string:s,attributes:[.font:NSFont.systemFont(ofSize:size,weight:weight),.foregroundColor:color(gray)])
 str.draw(at:NSPoint(x:x,y:CGFloat(h)-y-str.size().height))
}
func draw(_ image:NSImage,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat){image.draw(in:NSRect(x:x,y:CGFloat(h)-y-size,width:size,height:size))}
rect(0,0,CGFloat(w),CGFloat(h),0.97)
text("Prism / 单色工具栏图标",40,29,22,0.15,.semibold)
text("透明底 · 一个 P · 一道折光切口",40,67,13,0.48)
rect(40,112,210,250,1,18)
draw(icon,93,147,104)
text("折光 P",107,290,18,0.15,.medium)
text("放大预览",115,323,11,0.52)
rect(276,112,484,112,1,18)
text("浅色工具栏",300,128,11,0.48)
draw(icon,304,173,16); draw(icon,367,171,20); draw(icon,433,169,24); draw(icon,503,165,32)
text("16",303,200,9,0.5); text("20",368,200,9,0.5); text("24",436,200,9,0.5); text("32 px",503,200,9,0.5)
rect(276,242,484,120,0.14,18)
text("深色工具栏 / 反白",300,258,11,0.65)
draw(lightIcon,304,307,16); draw(lightIcon,367,305,20); draw(lightIcon,433,303,24); draw(lightIcon,503,299,32)
text("已用于 Prism 1.1.4 · 透明底 · 扩展内深色界面反白",40,398,12,0.5)
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using:.png,properties:[:])!.write(to:dir.appendingPathComponent("monochrome-preview.png"))
