import Foundation
import Capacitor

/// 局域网 NAS 发现（mDNS / Bonjour）。
/// 扫描常见服务类型，解析出主机名与端口，供 app 自动填充 WebDAV 地址。
@objc(NasDiscovery)
public class NasDiscovery: CAPPlugin, CAPBridgedPlugin {
    /// Capacitor 8 插件注册（Swift-only 方式）：必须 conform CAPBridgedPlugin
    /// 并声明 identifier / jsName / pluginMethods，否则 JS 调用会抛 not implemented。
    public let identifier = "NasDiscovery"
    public let jsName = "NasDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscovery", returnType: CAPPluginReturnPromise),
    ]

    private var browsers: [NetServiceBrowser] = []
    private var services: [NetService] = []

    @objc public func startDiscovery(_ call: CAPPluginCall) {
        let types = call.getArray("types", String.self) ?? ["_http._tcp", "_https._tcp", "_webdav._tcp"]
        DispatchQueue.main.async { [weak self] in
            self?.stopInternal()
            for type in types {
                let browser = NetServiceBrowser()
                browser.delegate = self
                browser.includesPeerToPeer = false
                browser.searchForServices(ofType: type, inDomain: "local.")
                self?.browsers.append(browser)
            }
        }
        call.resolve()
    }

    @objc public func stopDiscovery(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.stopInternal()
        }
        call.resolve()
    }

    private func stopInternal() {
        for browser in browsers {
            browser.stop()
            browser.delegate = nil
        }
        browsers.removeAll()
        for service in services {
            service.delegate = nil
            service.stop()
        }
        services.removeAll()
    }

    /// 解析完成：派发 serviceFound 事件（含建议 scheme）
    private func emit(_ service: NetService) {
        var host = service.hostName ?? ""
        if host.hasSuffix(".") {
            host = String(host.dropLast())
        }
        let type = service.type ?? ""
        let scheme: String = (type.contains("https") || type.contains("webdav")) ? "https" : "http"
        notifyListeners("serviceFound", data: [
            "name": service.name,
            "host": host,
            "port": service.port,
            "type": type,
            "scheme": scheme
        ])
    }
}

extension NasDiscovery: NetServiceBrowserDelegate {
    public func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        services.append(service)
        service.resolve(withTimeout: 5)
    }

    public func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        services.removeAll { $0 === service }
    }
}

extension NasDiscovery: NetServiceDelegate {
    public func netServiceDidResolveAddress(_ sender: NetService) {
        emit(sender)
    }

    public func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
        // 解析失败忽略，等待其它服务或手动填写
    }
}
