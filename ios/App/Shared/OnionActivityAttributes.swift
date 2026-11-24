import ActivityKit
import Foundation

/// 記錄中的即時動態（鎖定畫面與動態島）。app 開、小工具 extension 畫，兩個 target 都要編到這個檔。
@available(iOS 16.1, *)
struct OnionActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// 這一趟走了幾公里
        var km: Double
        /// 這一趟新探索了幾平方公里
        var area: Double
        /// walk、vehicle、flight
        var mode: String
    }

    /// 這一趟什麼時候開始的
    var startedAt: Date
}
