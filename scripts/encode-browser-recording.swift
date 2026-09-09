#!/usr/bin/env swift
// Encode real browser capture frames. No synthetic transitions or frame interpolation.
// Usage: swift scripts/encode-browser-recording.swift manifest.json output.mp4
// Manifest: {width?, height?, fps?, durationMs, frames:[{path,timestampMs}]}
// Paths are relative to the manifest. Timestamp 0 is the first captured frame;
// durationMs is elapsed time when capture ended. Timing is quantized to 1/fps.
import Foundation
import AVFoundation
import CoreGraphics
import ImageIO
import CoreVideo

struct CaptureFrame: Decodable { let path: String; let timestampMs: Double }
struct CaptureManifest: Decodable {
    let width: Int?
    let height: Int?
    let fps: Int?
    let durationMs: Double
    let frames: [CaptureFrame]
}
struct CaptureError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw CaptureError(message: message) }
}
func loadImage(_ url: URL) throws -> CGImage {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw CaptureError(message: "Cannot read capture frame: \(url.path)")
    }
    return image
}
func pixelBuffer(image: CGImage, width: Int, height: Int) throws -> CVPixelBuffer {
    var candidate: CVPixelBuffer?
    let attributes: [String: Any] = [
        kCVPixelBufferCGImageCompatibilityKey as String: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
    ]
    let result = CVPixelBufferCreate(kCFAllocatorDefault, width, height,
        kCVPixelFormatType_32ARGB, attributes as CFDictionary, &candidate)
    guard result == kCVReturnSuccess, let buffer = candidate else {
        throw CaptureError(message: "Cannot allocate video frame (\(result)).")
    }
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer),
        width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else {
        throw CaptureError(message: "Cannot create video drawing context.")
    }
    context.setFillColor(CGColor(gray: 0, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // Preserve the whole screenshot. A differently shaped viewport receives black bars.
    let scale = min(Double(width) / Double(image.width), Double(height) / Double(image.height))
    let drawWidth = Double(image.width) * scale
    let drawHeight = Double(image.height) * scale
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: (Double(width) - drawWidth) / 2,
        y: (Double(height) - drawHeight) / 2, width: drawWidth, height: drawHeight))
    return buffer
}

func encode(manifestURL: URL, outputURL: URL) async throws {
    let manifest = try JSONDecoder().decode(CaptureManifest.self, from: Data(contentsOf: manifestURL))
    let width = manifest.width ?? 1440
    let height = manifest.height ?? 900
    let fps = manifest.fps ?? 10
    try require(width >= 2 && width <= 7680 && width % 2 == 0 && height >= 2 && height <= 4320 && height % 2 == 0,
        "Video width and height must be positive even dimensions, at most 7680×4320.")
    try require((1...60).contains(fps), "fps must be between 1 and 60.")
    try require(!manifest.frames.isEmpty, "At least one real capture frame is required.")
    try require(manifest.durationMs.isFinite && manifest.durationMs > 0 && manifest.durationMs <= 36_000_000,
        "durationMs must be positive and no more than 10 hours.")
    try require(manifest.frames[0].timestampMs == 0, "The first captured frame must have timestampMs 0.")
    var previous = -1.0
    var urls: [URL] = []
    for frame in manifest.frames {
        try require(frame.timestampMs.isFinite && frame.timestampMs > previous && frame.timestampMs < manifest.durationMs,
            "Frame timestamps must be strictly increasing and precede durationMs.")
        previous = frame.timestampMs
        let url = URL(fileURLWithPath: frame.path, relativeTo: manifestURL.deletingLastPathComponent()).standardizedFileURL
        try require(FileManager.default.fileExists(atPath: url.path), "Capture frame missing: \(url.path)")
        urls.append(url)
    }
    try require(!FileManager.default.fileExists(atPath: outputURL.path), "Output already exists; choose a new filename.")
    try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: max(2_000_000, width * height * 4),
            AVVideoExpectedSourceFrameRateKey: fps,
            AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ])
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
    ])
    try require(writer.canAdd(input), "H.264 encoder does not support these output settings.")
    writer.add(input)
    try require(writer.startWriting(), writer.error?.localizedDescription ?? "Cannot start MP4 writer.")
    writer.startSession(atSourceTime: .zero)
    do {
        let count = Int(ceil(manifest.durationMs * Double(fps) / 1000))
        var sourceIndex = 0
        var loadedIndex = -1
        var buffer: CVPixelBuffer?
        for index in 0..<count {
            let elapsedMs = Double(index) * 1000 / Double(fps)
            while sourceIndex + 1 < manifest.frames.count && manifest.frames[sourceIndex + 1].timestampMs <= elapsedMs {
                sourceIndex += 1
            }
            if loadedIndex != sourceIndex {
                buffer = try pixelBuffer(image: loadImage(urls[sourceIndex]), width: width, height: height)
                loadedIndex = sourceIndex
            }
            let waitStart = Date()
            while !input.isReadyForMoreMediaData {
                try require(writer.status == .writing, writer.error?.localizedDescription ?? "Video writer stopped.")
                try require(Date().timeIntervalSince(waitStart) < 30, "Timed out waiting for video encoder.")
                try await Task.sleep(nanoseconds: 5_000_000)
            }
            guard let buffer, adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(index), timescale: Int32(fps))) else {
                throw CaptureError(message: writer.error?.localizedDescription ?? "Cannot append video frame \(index).")
            }
        }
        input.markAsFinished()
        writer.endSession(atSourceTime: CMTime(seconds: manifest.durationMs / 1000, preferredTimescale: 60000))
        await writer.finishWriting()
        try require(writer.status == .completed, writer.error?.localizedDescription ?? "MP4 finalization failed.")
        let asset = AVURLAsset(url: outputURL)
        let duration = try await asset.load(.duration)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let track = tracks.first else { throw CaptureError(message: "Output has no video track.") }
        let size = try await track.load(.naturalSize)
        let nominalFPS = try await track.load(.nominalFrameRate)
        let formats = try await track.load(.formatDescriptions)
        let subtype = formats.first.map { CMFormatDescriptionGetMediaSubType($0) } ?? 0
        let codec = String(bytes: [24, 16, 8, 0].map { UInt8((subtype >> $0) & 0xff) }, encoding: .ascii) ?? "unknown"
        let audioTracks = try await asset.loadTracks(withMediaType: .audio)
        let metadata: [String: Any] = ["output": outputURL.path, "codec": codec,
            "width": Int(size.width), "height": Int(size.height), "fps": nominalFPS,
            "durationSeconds": CMTimeGetSeconds(duration), "sourceFrames": manifest.frames.count,
            "encodedFrames": count, "audioTracks": audioTracks.count,
            "bytes": (try FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber)?.intValue ?? 0]
        print(String(data: try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]), encoding: .utf8)!)
    } catch {
        writer.cancelWriting()
        try? FileManager.default.removeItem(at: outputURL)
        throw error
    }
}

if CommandLine.arguments.count != 3 {
    fputs("Usage: swift scripts/encode-browser-recording.swift manifest.json output.mp4\n", stderr)
    exit(2)
}
do {
    try await encode(manifestURL: URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL,
        outputURL: URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL)
} catch {
    fputs("Recording encoder: \(error.localizedDescription)\n", stderr)
    exit(1)
}
