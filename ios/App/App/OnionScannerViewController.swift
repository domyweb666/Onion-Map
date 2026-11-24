import AVFoundation
import UIKit

/// 全螢幕掃 QR。掃到第一個就關掉交出去，按取消交 nil。
final class OnionScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onFinish: ((String?) -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "org.domyweb.onion.scanner")
    private var camera: AVCaptureDevice?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var finished = false
    private var torchOn = false

    private let hintLabel = UILabel()
    private let frameView = UIView()
    private let cancelButton = UIButton(type: .system)
    private let torchButton = UIButton(type: .system)
    private let messageStack = UIStackView()
    private let messageTitle = UILabel()
    private let messageBody = UILabel()
    private let settingsButton = UIButton(type: .system)

    /// tokens.json 金棕主題的 bright 與 onBright
    private let gold = UIColor(red: 233 / 255, green: 196 / 255, blue: 106 / 255, alpha: 1)
    private let onGold = UIColor(red: 43 / 255, green: 32 / 255, blue: 6 / 255, alpha: 1)

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        buildUI()
        checkCamera()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
        turnPreview()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        stopSession()
    }

    // MARK: 畫面

    private func buildUI() {
        frameView.isUserInteractionEnabled = false
        frameView.layer.cornerRadius = 24
        frameView.layer.borderWidth = 3
        frameView.layer.borderColor = gold.cgColor
        frameView.isHidden = true

        hintLabel.text = "對準電腦上的 QR"
        hintLabel.textColor = .white
        hintLabel.font = UIFont.preferredFont(forTextStyle: .headline)
        hintLabel.adjustsFontForContentSizeCategory = true
        hintLabel.textAlignment = .center
        hintLabel.numberOfLines = 0
        hintLabel.layer.shadowColor = UIColor.black.cgColor
        hintLabel.layer.shadowOpacity = 0.8
        hintLabel.layer.shadowRadius = 4
        hintLabel.layer.shadowOffset = .zero
        hintLabel.isHidden = true

        cancelButton.setTitle("取消", for: .normal)
        cancelButton.setTitleColor(.white, for: .normal)
        cancelButton.titleLabel?.font = UIFont.preferredFont(forTextStyle: .headline)
        cancelButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        cancelButton.layer.cornerRadius = 22
        cancelButton.addTarget(self, action: #selector(tapCancel), for: .touchUpInside)

        torchButton.tintColor = .white
        torchButton.setImage(UIImage(systemName: "flashlight.off.fill"), for: .normal)
        torchButton.backgroundColor = UIColor.black.withAlphaComponent(0.45)
        torchButton.layer.cornerRadius = 28
        torchButton.accessibilityLabel = "手電筒"
        torchButton.addTarget(self, action: #selector(tapTorch), for: .touchUpInside)
        torchButton.isHidden = true

        messageTitle.textColor = .white
        messageTitle.font = UIFont.preferredFont(forTextStyle: .title3)
        messageTitle.adjustsFontForContentSizeCategory = true
        messageTitle.textAlignment = .center
        messageTitle.numberOfLines = 0

        messageBody.textColor = UIColor.white.withAlphaComponent(0.8)
        messageBody.font = UIFont.preferredFont(forTextStyle: .body)
        messageBody.adjustsFontForContentSizeCategory = true
        messageBody.textAlignment = .center
        messageBody.numberOfLines = 0

        settingsButton.setTitle("打開設定", for: .normal)
        settingsButton.setTitleColor(onGold, for: .normal)
        settingsButton.titleLabel?.font = UIFont.preferredFont(forTextStyle: .headline)
        settingsButton.backgroundColor = gold
        settingsButton.layer.cornerRadius = 16
        settingsButton.addTarget(self, action: #selector(tapSettings), for: .touchUpInside)

        messageStack.axis = .vertical
        messageStack.alignment = .fill
        messageStack.spacing = 12
        messageStack.isHidden = true
        messageStack.addArrangedSubview(messageTitle)
        messageStack.addArrangedSubview(messageBody)
        messageStack.addArrangedSubview(settingsButton)
        messageStack.setCustomSpacing(24, after: messageBody)

        let parts: [UIView] = [frameView, hintLabel, cancelButton, torchButton, messageStack]
        for part in parts {
            part.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(part)
        }
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            cancelButton.topAnchor.constraint(equalTo: safe.topAnchor, constant: 12),
            cancelButton.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20),
            cancelButton.widthAnchor.constraint(equalToConstant: 84),
            cancelButton.heightAnchor.constraint(equalToConstant: 44),

            frameView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frameView.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            frameView.widthAnchor.constraint(equalToConstant: 240),
            frameView.heightAnchor.constraint(equalToConstant: 240),

            hintLabel.bottomAnchor.constraint(equalTo: frameView.topAnchor, constant: -24),
            hintLabel.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 20),
            hintLabel.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -20),

            torchButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            torchButton.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -32),
            torchButton.widthAnchor.constraint(equalToConstant: 56),
            torchButton.heightAnchor.constraint(equalToConstant: 56),

            messageStack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            messageStack.leadingAnchor.constraint(equalTo: safe.leadingAnchor, constant: 32),
            messageStack.trailingAnchor.constraint(equalTo: safe.trailingAnchor, constant: -32)
        ])
        // 按鈕收起來時 stack 會把它壓成 0，高度不能是死的
        let settingsHeight = settingsButton.heightAnchor.constraint(equalToConstant: 52)
        settingsHeight.priority = UILayoutPriority(999)
        settingsHeight.isActive = true
    }

    private func showMessage(title: String, body: String, settings: Bool) {
        frameView.isHidden = true
        hintLabel.isHidden = true
        torchButton.isHidden = true
        messageTitle.text = title
        messageBody.text = body
        settingsButton.isHidden = !settings
        messageStack.isHidden = false
    }

    private func showDenied() {
        showMessage(
            title: "相機沒有打開",
            body: "到 iPhone 的設定裡找到洋蔥，把「相機」打開，再回來掃一次。",
            settings: true
        )
    }

    private func showNoCamera() {
        showMessage(title: "相機現在不能用", body: "按取消，等一下再試一次。", settings: false)
    }

    // MARK: 相機

    private func checkCamera() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] (ok: Bool) in
                DispatchQueue.main.async {
                    if ok {
                        self?.startCamera()
                    } else {
                        self?.showDenied()
                    }
                }
            }
        case .restricted:
            showNoCamera()
        case .denied:
            showDenied()
        @unknown default:
            showDenied()
        }
    }

    private func startCamera() {
        guard !finished, previewLayer == nil else { return }
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else {
            showNoCamera()
            return
        }
        let output = AVCaptureMetadataOutput()
        session.beginConfiguration()
        session.addInput(input)
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            showNoCamera()
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
        let canReadQR = output.availableMetadataObjectTypes.contains(.qr)
        if canReadQR {
            output.metadataObjectTypes = [.qr]
        }
        session.commitConfiguration()
        guard canReadQR else {
            showNoCamera()
            return
        }

        camera = device
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.insertSublayer(layer, at: 0)
        previewLayer = layer
        turnPreview()

        frameView.isHidden = false
        hintLabel.isHidden = false
        torchButton.isHidden = !device.hasTorch

        let running = session
        sessionQueue.async {
            running.startRunning()
        }
    }

    private func stopSession() {
        let running = session
        sessionQueue.async {
            if running.isRunning {
                running.stopRunning()
            }
        }
    }

    /// iPad 可以橫著拿，畫面跟著轉。iPhone 只有直的
    private func turnPreview() {
        guard let connection = previewLayer?.connection, connection.isVideoOrientationSupported else { return }
        switch view.window?.windowScene?.interfaceOrientation {
        case .some(.landscapeLeft):
            connection.videoOrientation = .landscapeLeft
        case .some(.landscapeRight):
            connection.videoOrientation = .landscapeRight
        case .some(.portraitUpsideDown):
            connection.videoOrientation = .portraitUpsideDown
        default:
            connection.videoOrientation = .portrait
        }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        for item in metadataObjects {
            guard let code = item as? AVMetadataMachineReadableCodeObject else { continue }
            guard let text = code.stringValue, !text.isEmpty else { continue }
            finish(text)
            return
        }
    }

    // MARK: 按鈕

    @objc private func tapCancel() {
        finish(nil)
    }

    @objc private func tapTorch() {
        guard let device = camera, device.hasTorch else { return }
        do {
            try device.lockForConfiguration()
            torchOn.toggle()
            device.torchMode = torchOn ? .on : .off
            device.unlockForConfiguration()
        } catch {
            return
        }
        torchButton.setImage(UIImage(systemName: torchOn ? "flashlight.on.fill" : "flashlight.off.fill"), for: .normal)
        torchButton.tintColor = torchOn ? gold : .white
    }

    @objc private func tapSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private func finish(_ text: String?) {
        if finished { return }
        finished = true
        stopSession()
        if text != nil {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
        let done = onFinish
        onFinish = nil
        dismiss(animated: true) {
            done?(text)
        }
    }
}
