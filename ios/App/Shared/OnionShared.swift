import Foundation

/// app 寫、小工具讀的那一份。放在 App Group 裡，兩個 target 都要編到這個檔。
struct OnionSnapshot: Codable {
    /// todayKm 是哪一天的，yyyy-MM-dd。跨日之後對不上，今天就算 0
    var dayKey: String
    var todayKm: Double
    var area: Double
    var title: String
    var recording: Bool
    var updatedAt: Date

    func km(on date: Date) -> Double {
        return dayKey == OnionShared.dayKey(date) ? todayKm : 0
    }

    /// 太久沒更新就不說「記錄中」，免得 app 早就被關掉了還掛著
    func isRecording(at date: Date) -> Bool {
        return recording && date.timeIntervalSince(updatedAt) < 12 * 3600
    }
}

enum OnionShared {
    static let appGroup = "group.org.domyweb.onion"
    static let openLink = "onion://open"
    private static let snapshotKey = "onion.widget.v1"
    private static let mapName = "widget-map.jpg"

    private static var folder: URL? {
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    }

    private static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone.current
        return c
    }

    static func dayKey(_ date: Date) -> String {
        let p = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", p.year ?? 0, p.month ?? 0, p.day ?? 0)
    }

    static func nextMidnight(after date: Date) -> Date {
        let start = calendar.startOfDay(for: date)
        return calendar.date(byAdding: .day, value: 1, to: start) ?? date.addingTimeInterval(24 * 3600)
    }

    // MARK: 讀寫

    static func read() -> OnionSnapshot? {
        guard folder != nil, let defaults = UserDefaults(suiteName: appGroup) else { return nil }
        guard let data = defaults.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(OnionSnapshot.self, from: data)
    }

    /// 沒有 App Group 權限（沒簽的版本）就什麼都不寫，回 false
    @discardableResult
    static func write(_ snapshot: OnionSnapshot) -> Bool {
        guard folder != nil, let defaults = UserDefaults(suiteName: appGroup) else { return false }
        guard let data = try? JSONEncoder().encode(snapshot) else { return false }
        defaults.set(data, forKey: snapshotKey)
        return true
    }

    static func mapData() -> Data? {
        guard let url = folder?.appendingPathComponent(mapName) else { return nil }
        return try? Data(contentsOf: url)
    }

    /// 空資料代表把縮圖拿掉
    static func writeMap(_ data: Data?) {
        guard let url = folder?.appendingPathComponent(mapName) else { return }
        if let data = data, !data.isEmpty {
            try? data.write(to: url, options: .atomic)
        } else {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: 數字怎麼寫

    /// 不到一公里用公尺，免得走了半天還寫 0 公里（跟 app 裡同一個規矩）
    static func kmNumber(_ km: Double) -> String {
        if km >= 10 { return String(format: "%.0f", km) }
        if km >= 1 { return String(format: "%.1f", km) }
        return String(format: "%.0f", max(0, km) * 1000)
    }

    static func kmUnit(_ km: Double) -> String {
        return km >= 1 ? "公里" : "公尺"
    }

    static func areaNumber(_ area: Double) -> String {
        if area >= 100 { return String(format: "%.0f", area) }
        if area >= 10 { return String(format: "%.1f", area) }
        return String(format: "%.2f", max(0, area))
    }
}
