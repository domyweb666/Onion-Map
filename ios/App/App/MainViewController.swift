import Capacitor
import UIKit

/// Capacitor 的主畫面，多登記一個自己寫的原生外掛 OnionNative。
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OnionNativePlugin())
    }
}
