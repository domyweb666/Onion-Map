import ActivityKit
import SwiftUI
import WidgetKit

/// 記錄中的即時動態：鎖定畫面一塊，動態島三種大小。時間由系統自己走，app 不用一直更新。
struct OnionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: OnionActivityAttributes.self) { context in
            OnionLockScreenView(
                startedAt: context.attributes.startedAt,
                state: context.state,
                isStale: context.isStale
            )
            .activityBackgroundTint(OnionColor.canvas)
            .activitySystemActionForegroundColor(OnionColor.strong)
            .widgetURL(URL(string: OnionShared.openLink))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    OnionIslandNumber(
                        label: "這一趟",
                        number: OnionShared.kmNumber(context.state.km),
                        unit: OnionShared.kmUnit(context.state.km)
                    )
                }
                DynamicIslandExpandedRegion(.trailing) {
                    OnionIslandNumber(
                        label: "新探索",
                        number: OnionShared.areaNumber(context.state.area),
                        unit: "平方公里"
                    )
                }
                DynamicIslandExpandedRegion(.bottom) {
                    OnionIslandFooter(
                        startedAt: context.attributes.startedAt,
                        mode: context.state.mode,
                        isStale: context.isStale
                    )
                }
            } compactLeading: {
                OnionModeIcon(mode: context.state.mode)
            } compactTrailing: {
                OnionIslandDistance(km: context.state.km)
            } minimal: {
                OnionModeIcon(mode: context.state.mode)
            }
            .widgetURL(URL(string: OnionShared.openLink))
            .keylineTint(OnionColor.bright)
        }
    }
}

/// 動態島用的圖示：走路、坐車、飛
struct OnionModeIcon: View {
    let mode: String

    static func symbol(_ mode: String) -> String {
        switch mode {
        case "vehicle":
            return "car.fill"
        case "flight":
            return "airplane"
        default:
            return "figure.walk"
        }
    }

    var body: some View {
        Image(systemName: OnionModeIcon.symbol(mode))
            .foregroundColor(OnionColor.bright)
            .accessibilityLabel(Text("洋蔥記錄中"))
    }
}

/// 從開始記錄起算的時間，系統每秒自己走
struct OnionClock: View {
    let startedAt: Date

    private var range: ClosedRange<Date> {
        return startedAt...startedAt.addingTimeInterval(24 * 3600)
    }

    var body: some View {
        Text(timerInterval: range, countsDown: false)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .lineLimit(1)
    }
}

/// 動態島收起來時右邊那個數字，位置很小，單位用英文縮寫
struct OnionIslandDistance: View {
    let km: Double

    private var text: String {
        return OnionShared.kmNumber(km) + (km >= 1 ? "km" : "m")
    }

    var body: some View {
        Text(text)
            .font(.caption.weight(.medium))
            .foregroundColor(OnionColor.bright)
            .lineLimit(1)
    }
}

struct OnionIslandFooter: View {
    let startedAt: Date
    let mode: String
    let isStale: Bool

    var body: some View {
        HStack(spacing: 8) {
            OnionModeIcon(mode: mode)
            Text(isStale ? "好一陣子沒有新位置" : "洋蔥記錄中")
                .font(.subheadline)
                .foregroundColor(Color.white)
                .lineLimit(1)
            Spacer(minLength: 8)
            OnionClock(startedAt: startedAt)
                .font(.subheadline)
                .foregroundColor(Color.white)
                .frame(maxWidth: 80)
        }
        .padding(.top, 4)
        .padding(.horizontal, 8) // 下緣圓角大，貼邊的時間會被切到一角
    }
}

struct OnionIslandNumber: View {
    let label: String
    let number: String
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(label)
                .font(.caption)
                .foregroundColor(Color.white.opacity(0.7))
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(number)
                    .font(.title3.weight(.semibold))
                    .foregroundColor(Color.white)
                Text(unit)
                    .font(.caption)
                    .foregroundColor(Color.white.opacity(0.7))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 8)
        .accessibilityElement(children: .combine)
    }
}

/// 鎖定畫面那一塊
struct OnionLockScreenView: View {
    let startedAt: Date
    let state: OnionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: OnionModeIcon.symbol(state.mode))
                    .font(.subheadline)
                    .foregroundColor(OnionColor.strong)
                    .accessibilityHidden(true)
                Text(isStale ? "好一陣子沒有新位置，點開看看" : "洋蔥記錄中")
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(OnionColor.strong)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 8)
                OnionClock(startedAt: startedAt)
                    .font(.subheadline)
                    .foregroundColor(OnionColor.textSecondary)
                    .frame(maxWidth: 90)
            }
            HStack(alignment: .firstTextBaseline, spacing: 20) {
                OnionLockNumber(
                    label: "這一趟",
                    number: OnionShared.kmNumber(state.km),
                    unit: OnionShared.kmUnit(state.km)
                )
                OnionLockNumber(
                    label: "新探索",
                    number: OnionShared.areaNumber(state.area),
                    unit: "平方公里"
                )
                Spacer(minLength: 0)
            }
        }
        .padding(16)
    }
}

struct OnionLockNumber: View {
    let label: String
    let number: String
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(number)
                    .font(.title2.weight(.bold))
                    .foregroundColor(OnionColor.textPrimary)
                Text(unit)
                    .font(.footnote)
                    .foregroundColor(OnionColor.textSecondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            Text(label)
                .font(.caption)
                .foregroundColor(OnionColor.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}
