import ActivityKit
import Capacitor
import Foundation
import UIKit
import WidgetKit

/// 洋蔥自己的原生外掛：掃 QR、更新小工具、即時動態、從 onion:// 打開。
/// 網頁那邊的名字是 OnionNative（見 src/js/70-native.js）。
@objc(OnionNativePlugin)
public class OnionNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OnionNativePlugin"
    public let jsName = "OnionNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanQR", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnPromise)
    ]

    /// 這麼久沒有新位置，鎖定畫面就改寫「沒有新位置」
    private static let staleAfter: TimeInterval = 30 * 60

    private var observers: [NSObjectProtocol] = []

    override public func load() {
        let center = NotificationCenter.default
        // 冷啟動時 Capacitor 會等畫面出來再補發這個通知，那時外掛已經登記好了
        observers.append(center.addObserver(forName: .capacitorOpenURL, object: nil, queue: .main) { [weak self] note in
            guard let info = note.object as? [String: Any], let url = info["url"] as? URL else { return }
            self?.opened(url)
        })
        // 使用者把 app 滑掉：定位跟著停了，鎖定畫面和小工具不能還寫著記錄中
        observers.append(center.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            self?.closeOut()
        })
    }

    deinit {
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }

    private func opened(_ url: URL) {
        guard (url.scheme ?? "").lowercased() == "onion" else { return }
        notifyListeners("urlOpen", data: ["url": url.absoluteString], retainUntilConsumed: true)
    }

    // MARK: 掃 QR

    @objc func scanQR(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.presentScanner(call)
        }
    }

    @MainActor
    private func presentScanner(_ call: CAPPluginCall) {
        guard let host = bridge?.viewController else {
            call.reject("畫面還沒準備好，等一下再試", "UNAVAILABLE")
            return
        }
        guard host.presentedViewController == nil else {
            call.reject("先關掉現在開著的畫面，再掃一次", "BUSY")
            return
        }
        let scanner = OnionScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        scanner.onFinish = { (text: String?) in
            if let text = text {
                call.resolve(["text": text])
            } else {
                call.reject("取消掃描", "CANCELLED")
            }
        }
        host.present(scanner, animated: true, completion: nil)
    }

    // MARK: 小工具

    @objc func setWidget(_ call: CAPPluginCall) {
        let now = Date()
        let today = OnionShared.dayKey(now)
        let old = OnionShared.read()
        let oldKm: Double = old?.km(on: now) ?? 0
        let snapshot = OnionSnapshot(
            dayKey: today,
            todayKm: call.getDouble("todayKm") ?? oldKm,
            area: call.getDouble("area") ?? (old?.area ?? 0),
            title: call.getString("title") ?? (old?.title ?? ""),
            recording: call.getBool("recording") ?? (old?.recording ?? false),
            updatedAt: now
        )
        let ok = OnionShared.write(snapshot)
        // 沒給 map 就沿用上一張；給空字串就拿掉
        if ok, let map = call.getString("map") {
            OnionShared.writeMap(OnionNativePlugin.decode(map))
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["supported": ok])
    }

    private static func decode(_ base64: String) -> Data? {
        var text = base64
        if text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") {
            text = String(text[text.index(after: comma)...])
        }
        if text.isEmpty { return nil }
        return Data(base64Encoded: text, options: .ignoreUnknownCharacters)
    }

    // MARK: 即時動態

    @objc func startActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false])
            return
        }
        DispatchQueue.main.async {
            self.beginActivity(call)
        }
    }

    @objc func updateActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false])
            return
        }
        DispatchQueue.main.async {
            self.refreshActivity(call)
        }
    }

    @objc func endActivity(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false])
            return
        }
        DispatchQueue.main.async {
            for activity in Activity<OnionActivityAttributes>.activities {
                OnionNativePlugin.finish(activity)
            }
            call.resolve(["supported": true])
        }
    }

    @available(iOS 16.2, *)
    private static func finish(_ activity: Activity<OnionActivityAttributes>) {
        Task {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    @available(iOS 16.2, *)
    private static func isAlive(_ activity: Activity<OnionActivityAttributes>) -> Bool {
        return activity.activityState == .active || activity.activityState == .stale
    }

    @available(iOS 16.2, *)
    private static func content(_ call: CAPPluginCall) -> ActivityContent<OnionActivityAttributes.ContentState> {
        let state = OnionActivityAttributes.ContentState(
            km: call.getDouble("km") ?? 0,
            area: call.getDouble("area") ?? 0,
            mode: call.getString("mode") ?? "walk"
        )
        return ActivityContent(state: state, staleDate: Date().addingTimeInterval(staleAfter))
    }

    /// 同一趟的還活著就接回來，別趟留下來的收掉，都沒有才開新的。重複叫沒關係。
    @available(iOS 16.2, *)
    private func beginActivity(_ call: CAPPluginCall) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.resolve(["supported": false])
            return
        }
        let ms: Double = call.getDouble("startedAt") ?? Date().timeIntervalSince1970 * 1000
        let startedAt = Date(timeIntervalSince1970: ms / 1000)
        let content = OnionNativePlugin.content(call)
        let hasNumbers = call.getDouble("km") != nil

        var mine: Activity<OnionActivityAttributes>?
        for activity in Activity<OnionActivityAttributes>.activities {
            let sameTrip = abs(activity.attributes.startedAt.timeIntervalSince(startedAt)) < 2
            if mine == nil && sameTrip && OnionNativePlugin.isAlive(activity) {
                mine = activity
            } else {
                OnionNativePlugin.finish(activity)
            }
        }
        if let kept = mine {
            if hasNumbers {
                OnionNativePlugin.push(content, to: kept)
            }
            call.resolve(["supported": true])
            return
        }
        do {
            _ = try Activity<OnionActivityAttributes>.request(
                attributes: OnionActivityAttributes(startedAt: startedAt),
                content: content,
                pushType: nil
            )
            call.resolve(["supported": true])
        } catch {
            // 在背景開、或同時開太多個，系統會拒絕。記錄本身不受影響
            call.resolve(["supported": false, "why": error.localizedDescription])
        }
    }

    @available(iOS 16.2, *)
    private func refreshActivity(_ call: CAPPluginCall) {
        let content = OnionNativePlugin.content(call)
        var found = false
        for activity in Activity<OnionActivityAttributes>.activities where OnionNativePlugin.isAlive(activity) {
            found = true
            OnionNativePlugin.push(content, to: activity)
        }
        call.resolve(["supported": true, "active": found])
    }

    @available(iOS 16.2, *)
    private static func push(
        _ content: ActivityContent<OnionActivityAttributes.ContentState>,
        to activity: Activity<OnionActivityAttributes>
    ) {
        Task {
            await activity.update(content)
        }
    }

    /// app 要被關掉了，只有一兩秒可以用
    private func closeOut() {
        if var snapshot = OnionShared.read(), snapshot.recording {
            snapshot.recording = false
            OnionShared.write(snapshot)
            WidgetCenter.shared.reloadAllTimelines()
        }
        guard #available(iOS 16.2, *) else { return }
        guard !Activity<OnionActivityAttributes>.activities.isEmpty else { return }
        let done = DispatchSemaphore(value: 0)
        Task.detached {
            for activity in Activity<OnionActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            done.signal()
        }
        _ = done.wait(timeout: .now() + 2)
    }
}
