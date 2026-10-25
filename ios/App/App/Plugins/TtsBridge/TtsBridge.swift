import Foundation
import Capacitor
import AVFoundation

/// 原生 TTS 桥（iOS）。
///
/// 背景：用户反馈「取消手机静音后才有声音」——根因是 WKWebView 的 `speechSynthesis`
/// 走的是系统语音通道，受 iPhone 铃声/静音开关控制；静音时系统语音被一并静音。
/// 修复：改用系统 `AVSpeechSynthesizer`，并把音频会话类别设为 `.playback`（媒体路径），
/// 该类别**忽略静音键**，从而即使在静音模式下单词朗读也能出声。
@objc(TtsBridge)
public class TtsBridge: CAPPlugin, CAPBridgedPlugin {
    /// Capacitor 8 插件注册（Swift-only 方式）：必须 conform CAPBridgedPlugin
    /// 并声明 identifier / jsName / pluginMethods，否则 JS 调用会抛 not implemented。
    public let identifier = "TtsBridge"
    public let jsName = "TtsBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
    ]

    private let synthesizer = AVSpeechSynthesizer()
    private var sessionConfigured = false

    /// 把音频会话切到媒体路径（忽略静音键）。幂等：只配置一次，失败可重试。
    private func configureAudioSession() {
        if sessionConfigured {
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            // .playback：走媒体播放路径，忽略静音开关；
            // .spokenAudio：针对朗读/语音优化；
            // .duckOthers：朗读时压低其它 App 的音频，读完后自动恢复。
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            sessionConfigured = true
        } catch {
            sessionConfigured = false
        }
    }

    @objc public func speak(_ call: CAPPluginCall) {
        guard let text = call.getString("text"), !text.isEmpty else {
            call.reject("missing text")
            return
        }
        let lang = call.getString("lang") ?? "en-US"
        let rate = call.getDouble("rate") ?? 1.0
        // Capacitor 插件方法默认在后台线程执行；AVSpeechSynthesizer / AVAudioSession
        // 需在主线程操作，否则可能无声。
        DispatchQueue.main.async {
            self.configureAudioSession()
            // AVSpeechUtterance rate 范围 0.0~1.0（默认 0.5）；我们的 UI rate 是 0.5~1.5（1.0=正常）。
            // 线性映射：1.0 -> 0.5（默认音速），并夹在 [0,1]。
            let avRate = min(1.0, max(0.0, rate * 0.5))
            let utterance = AVSpeechUtterance(string: text)
            if let voice = AVSpeechSynthesisVoice(language: lang) {
                utterance.voice = voice
            }
            utterance.rate = Float(avRate)
            self.synthesizer.stopSpeaking(at: .immediate)
            self.synthesizer.speak(utterance)
            call.resolve()
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.synthesizer.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    @objc public func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": true])
    }
}
