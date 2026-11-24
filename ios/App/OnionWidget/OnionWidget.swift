import SwiftUI
import UIKit
import WidgetKit

// 主畫面小、中，鎖定畫面長條、圓形。只讀 app 寫進 App Group 的那一份，不自己算。

/// 色碼住在小工具自己的 Assets.xcassets，值抄 vendor/domy-design/tokens.json 的金棕主題，深淺色由系統切
enum OnionColor {
    static let canvas = Color("OnionCanvas")
    static let soft = Color("OnionSoft")
    static let strong = Color("OnionStrong")
    static let bright = Color("OnionBright")
    static let textPrimary = Color("OnionTextPrimary")
    static let textSecondary = Color("OnionTextSecondary")
}

struct OnionEntry: TimelineEntry {
    let date: Date
    /// 還沒打開過洋蔥、或讀不到時是 nil
    let snapshot: OnionSnapshot?
    let map: UIImage?

    var todayKm: Double {
        return snapshot?.km(on: date) ?? 0
    }

    var recording: Bool {
        return snapshot?.isRecording(at: date) ?? false
    }

    var area: Double {
        return snapshot?.area ?? 0
    }

    var kmText: String {
        return OnionShared.kmNumber(todayKm) + " " + OnionShared.kmUnit(todayKm)
    }

    var areaText: String {
        return "已探索 " + OnionShared.areaNumber(area) + " 平方公里"
    }

    static func sample() -> OnionEntry {
        let now = Date()
        let snapshot = OnionSnapshot(
            dayKey: OnionShared.dayKey(now),
            todayKm: 3.2,
            area: 4.86,
            title: "散步家",
            recording: true,
            updatedAt: now
        )
        return OnionEntry(date: now, snapshot: snapshot, map: nil)
    }
}

struct OnionProvider: TimelineProvider {
    func placeholder(in context: Context) -> OnionEntry {
        return OnionEntry.sample()
    }

    func getSnapshot(in context: Context, completion: @escaping (OnionEntry) -> Void) {
        let now = OnionProvider.entry(at: Date())
        if context.isPreview && now.snapshot == nil {
            completion(OnionEntry.sample())
        } else {
            completion(now)
        }
    }

    /// 現在一格、今晚零點一格（今天的里程在那時歸零）
    func getTimeline(in context: Context, completion: @escaping (Timeline<OnionEntry>) -> Void) {
        let now = OnionProvider.entry(at: Date())
        let midnight = OnionShared.nextMidnight(after: now.date)
        let next = OnionEntry(date: midnight, snapshot: now.snapshot, map: now.map)
        completion(Timeline(entries: [now, next], policy: .after(midnight.addingTimeInterval(60))))
    }

    private static func entry(at date: Date) -> OnionEntry {
        var image: UIImage?
        if let data = OnionShared.mapData() {
            image = UIImage(data: data)
        }
        return OnionEntry(date: date, snapshot: OnionShared.read(), map: image)
    }
}

struct OnionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "OnionWidget", provider: OnionProvider()) { entry in
            OnionWidgetView(entry: entry)
        }
        .configurationDisplayName("今天走了多遠")
        .description("今天的里程、已經探索的面積，中尺寸多一張你的地圖。")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular])
    }
}

struct OnionWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: OnionEntry

    private var isLockScreen: Bool {
        return family == .accessoryRectangular || family == .accessoryCircular
    }

    var body: some View {
        sized
            .modifier(OnionWidgetBackground(isLockScreen: isLockScreen))
            .widgetURL(URL(string: OnionShared.openLink))
    }

    @ViewBuilder
    private var sized: some View {
        switch family {
        case .accessoryCircular:
            OnionCircularView(entry: entry)
        case .accessoryRectangular:
            OnionRectangularView(entry: entry)
        case .systemMedium:
            HStack(spacing: 16) {
                OnionMapView(image: entry.map)
                OnionNumbersView(entry: entry, showsTitle: true)
            }
        default:
            OnionNumbersView(entry: entry, showsTitle: false)
        }
    }
}

/// iOS 17 起系統要用 containerBackground，並且自己留邊；16 要自己鋪底色和留邊
struct OnionWidgetBackground: ViewModifier {
    let isLockScreen: Bool

    func body(content: Content) -> some View {
        if #available(iOS 17.0, *) {
            content.containerBackground(for: .widget) {
                if isLockScreen {
                    Color.clear
                } else {
                    OnionColor.canvas
                }
            }
        } else if isLockScreen {
            content
        } else {
            content
                .padding(16)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(OnionColor.canvas)
        }
    }
}

/// 今天走了多遠、已經探索多少。小尺寸的全部，中尺寸的右半邊
struct OnionNumbersView: View {
    let entry: OnionEntry
    let showsTitle: Bool

    private var header: String {
        if entry.recording { return "記錄中" }
        if showsTitle, let title = entry.snapshot?.title, !title.isEmpty { return title }
        return "洋蔥"
    }

    var body: some View {
        if entry.snapshot == nil {
            OnionEmptyView()
        } else {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    if entry.recording {
                        Circle()
                            .fill(OnionColor.strong)
                            .frame(width: 8, height: 8)
                    }
                    Text(header)
                        .font(.caption.weight(.medium))
                        .foregroundColor(OnionColor.strong)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Text("今天走了")
                    .font(.caption)
                    .foregroundColor(OnionColor.textSecondary)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(OnionShared.kmNumber(entry.todayKm))
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(OnionColor.textPrimary)
                    Text(OnionShared.kmUnit(entry.todayKm))
                        .font(.subheadline)
                        .foregroundColor(OnionColor.textSecondary)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                Spacer(minLength: 0)
                Text(entry.areaText)
                    .font(.caption)
                    .foregroundColor(OnionColor.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .accessibilityElement(children: .combine)
        }
    }
}

struct OnionEmptyView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "map")
                .font(.title3)
                .foregroundColor(OnionColor.strong)
                .frame(width: 44, height: 44)
                .background(Circle().fill(OnionColor.soft))
            Spacer(minLength: 0)
            Text("還沒有紀錄")
                .font(.headline)
                .foregroundColor(OnionColor.textPrimary)
            Text("點一下，開始畫你的地圖")
                .font(.caption)
                .foregroundColor(OnionColor.textSecondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

/// app 寫進來的迷霧地圖縮圖；還沒有就放一塊淡金色
struct OnionMapView: View {
    let image: UIImage?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay(picture)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var picture: some View {
        if let image = image {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
        } else {
            ZStack {
                OnionColor.soft
                Image(systemName: "map")
                    .font(.largeTitle)
                    .foregroundColor(OnionColor.strong)
            }
        }
    }
}

struct OnionRectangularView: View {
    let entry: OnionEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if entry.snapshot == nil {
                Text("洋蔥")
                    .font(.headline)
                Text("點一下，開始畫你的地圖")
                    .font(.caption)
                    .lineLimit(2)
            } else {
                Text(entry.recording ? "洋蔥記錄中" : "今天走了")
                    .font(.caption.weight(.medium))
                Text(entry.kmText)
                    .font(.headline)
                    .widgetAccentable()
                Text(entry.areaText)
                    .font(.caption)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

struct OnionCircularView: View {
    let entry: OnionEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                if entry.snapshot == nil {
                    Image(systemName: "map")
                        .font(.title3)
                } else {
                    Image(systemName: entry.recording ? "figure.walk" : "map")
                        .font(.caption)
                    Text(OnionShared.kmNumber(entry.todayKm))
                        .font(.headline)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .widgetAccentable()
                    Text(OnionShared.kmUnit(entry.todayKm))
                        .font(.caption2)
                }
            }
            .padding(4)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("今天走了 " + entry.kmText))
    }
}
