import UIKit
import WebKit

final class GameViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!
    private var contentProcessCrashCount = 0
    /// Monotonic clock, so a device-clock change cannot confuse the loop check.
    private var lastCrashTime: CFTimeInterval = 0
    private var crashNotice: UILabel?
    private var thermalObserver: NSObjectProtocol?
    private var lowPowerObserver: NSObjectProtocol?

    /// A jetsam kill during the 750MB first-launch seed is deterministic, so an
    /// uncapped reload is an infinite zero-progress loop. Retry a few times
    /// with backoff, then stop and say so.
    private static let maxAutoRecoveries = 3
    /// A crash this long after the previous one is a fresh incident, not a loop.
    private static let crashLoopWindow: CFTimeInterval = 300

    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var prefersStatusBarHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.isElementFullscreenEnabled = true

        // Marker the web app uses to detect it is running inside the native shell.
        // thermalState is the only ground truth the page has for "is this device
        // getting hot" — JavaScript cannot see the SoC's power state, and timing
        // heuristics cannot tell throttling apart from a heavy frame.
        let bootstrap = WKUserScript(
            source: """
            window.__RA2_SHELL__ = { platform: 'ios', version: '0.1.0', \
            menuVideoRoot: '/native-media/ios/menu-video', \
            thermalState: '\(Self.thermalStateName(ProcessInfo.processInfo.thermalState))' };
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bootstrap)

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        // Opaque: the page always paints a black background, and transparency
        // costs alpha compositing on the full-screen GPU-process surface.
        webView.isOpaque = true
        webView.backgroundColor = .black
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        view.addSubview(webView)
        webView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])

        observeThermalState()
        loadApp()
    }

    private static func thermalStateName(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal: return "nominal"
        case .fair: return "fair"
        case .serious: return "serious"
        case .critical: return "critical"
        @unknown default: return "unknown"
        }
    }

    /// Fires only on thermal / power-mode transitions — a handful of times per
    /// hour at worst — so it adds no polling and no wakeup source of its own.
    private func observeThermalState() {
        let center = NotificationCenter.default
        thermalObserver = center.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pushThermalState()
        }
        lowPowerObserver = center.addObserver(
            forName: .NSProcessInfoPowerStateDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pushThermalState()
        }
    }

    /// The document-start script carries the state as of viewDidLoad, so a later
    /// reload (crash recovery, or the post-seed reload) would otherwise see a
    /// stale — and optimistically low — value: no transition fires at reload time.
    private func pushThermalState() {
        let info = ProcessInfo.processInfo
        let name = Self.thermalStateName(info.thermalState)
        let lowPower = info.isLowPowerModeEnabled
        NSLog("[RA2] thermalState=%@ lowPower=%@", name, lowPower ? "yes" : "no")
        webView.evaluateJavaScript(
            """
            window.__RA2_SHELL__ && (window.__RA2_SHELL__.thermalState = '\(name)');
            window.__RA2_POWER__ && window.__RA2_POWER__({thermal:'\(name)',lowPower:\(lowPower)});
            """,
            completionHandler: nil
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pushThermalState()
    }

    deinit {
        let center = NotificationCenter.default
        if let thermalObserver { center.removeObserver(thermalObserver) }
        if let lowPowerObserver { center.removeObserver(lowPowerObserver) }
    }

    private func loadApp(crashed: Bool = false) {
        var urlString = "\(BundleSchemeHandler.scheme)://app/index.html"
        if crashed {
            // Let the web app know this boot follows a content-process kill so it
            // can surface it (memory pressure) instead of looking like a silent reset.
            urlString += "?crashRecovery=\(contentProcessCrashCount)"
        }
        webView.load(URLRequest(url: URL(string: urlString)!))
    }

    // The web content process was killed (almost always jetsam memory pressure
    // during game load). Without this handler the view goes blank/limbo; with a
    // plain reload the user silently loses their session. Reload and mark the
    // boot as crash recovery — but only a bounded number of times, because the
    // fault that kills us is usually deterministic and would otherwise loop.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        let now = CACurrentMediaTime()
        if now - lastCrashTime > Self.crashLoopWindow { contentProcessCrashCount = 0 }
        lastCrashTime = now
        contentProcessCrashCount += 1
        NSLog("[RA2] Web content process terminated (count=%d)", contentProcessCrashCount)

        guard contentProcessCrashCount <= Self.maxAutoRecoveries else {
            NSLog("[RA2] Giving up after %d consecutive terminations", contentProcessCrashCount)
            showUnrecoverableNotice()
            return
        }
        // Back off: an immediate reload of a deterministic OOM pins the CPU
        // and the disk and drains the battery with nothing on screen.
        let delay = pow(2.0, Double(contentProcessCrashCount - 1))
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.loadApp(crashed: true)
        }
    }

    private func showUnrecoverableNotice() {
        guard crashNotice == nil else { return }
        let label = UILabel()
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = .white
        label.font = .monospacedSystemFont(ofSize: 15, weight: .regular)
        label.text = """
        Red Alert 2 ran out of memory and could not recover.

        Close other apps, restart the device, and launch again.
        """
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, multiplier: 0.8),
        ])
        crashNotice = label
    }
}
