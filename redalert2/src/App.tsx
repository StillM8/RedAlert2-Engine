import { useEffect, useRef, useState } from 'react';
import { Application, SplashScreenUpdateCallback } from './Application';
import SplashScreenComponent from './gui/component/SplashScreen';
import { installShellDebugLog, installShellRepl, seedGameResFromShell } from './shell/nativeShell';
import { installPowerStateReceiver } from './engine/PowerState';
import type { ComponentProps } from 'react';
function App() {
    const appRef = useRef<Application | null>(null);
    const appInitialized = useRef<boolean>(false);
    const [splashScreenProps, setSplashScreenProps] = useState<ComponentProps<typeof SplashScreenComponent> | null>(null);
    const [showTestMode, setShowTestMode] = useState(false);
    useEffect(() => {
        if (appInitialized.current) {
            return;
        }
        appInitialized.current = true;
        console.log('App.tsx: useEffect - Initializing Application');
        // Android can report a landscape cutout safe-area inset on the left
        // while still delivering touch coordinates in the full WebView
        // viewport. The game surface must use that same full coordinate space;
        // iOS keeps its own safe-area layout behavior.
        const isAndroidShell = new URLSearchParams(window.location.search).get('platform') === 'android';
        if (isAndroidShell) {
            document.body.classList.add('ra2-android-shell');
        }
        const handleSplashScreenUpdate: SplashScreenUpdateCallback = (props) => {
            console.log('App.tsx: SplashScreen update callback received', props);
            if (props === null) {
                setSplashScreenProps(null);
            }
            else {
                setSplashScreenProps(prevProps => ({
                    ...prevProps,
                    ...props
                }));
            }
        };
        const app = new Application(handleSplashScreenUpdate);
        appRef.current = app;
        const startApp = async () => {
            const rootElement = document.getElementById('ra2web-root');
            if (rootElement) {
                console.log('App.tsx: #ra2web-root found, calling app.main()');
                try {
                    // Game files may not contain the generated glsl.png yet
                    // (for example after a pre-existing Android import). Keep
                    // the first frame branded and useful while the real game
                    // resources are being seeded/loaded.
                    const params = new URLSearchParams(window.location.search);
                    const content = params.get('content');
                    const profile = content === 'builtin:yr'
                        ? 'yr'
                        : 'ra2';
                    handleSplashScreenUpdate({
                        width: window.innerWidth,
                        height: window.innerHeight,
                        parentElement: rootElement,
                        backgroundImage: profile === 'yr'
                            ? '/res/img/yr-loading.png'
                            : '/res/img/ra2-loading.png',
                        loadingText: 'Initializing...',
                    });
                    installShellDebugLog();
                    installShellRepl();
                    installPowerStateReceiver();
                    // Android may publish the initial thermal/battery state
                    // before the WebView bridge exists. A one-shot handshake
                    // makes the native state delivery reliable on cold boot
                    // and after renderer recovery.
                    window.Ra2Android?.platformReady?.();
                    await seedGameResFromShell();
                    await app.main();
                    console.log('App.tsx: app.main() completed.');
                }
                catch (error) {
                    console.error("Error running Application.main():", error);
                }
            }
            else {
                console.warn('App.tsx: #ra2web-root not found yet, retrying...');
                setTimeout(startApp, 100);
            }
        };
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('test') === 'glsl') {
            setShowTestMode(true);
            return;
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            startApp();
        }
        else {
            document.addEventListener('DOMContentLoaded', startApp);
        }
        return () => {
            console.log('App.tsx: useEffect cleanup');
            setSplashScreenProps(null);
        };
    }, []);
    if (showTestMode) {
        return (<div className="App">
        <div style={{
                position: 'fixed',
                top: '10px',
                right: '10px',
                zIndex: 1000
            }}>
          <button onClick={() => {
                window.location.href = window.location.pathname;
            }} style={{
                background: '#6c757d',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer'
            }}>
            Return to Normal Mode
          </button>
        </div>
      </div>);
    }
    return (<div className="App">
      {splashScreenProps && splashScreenProps.parentElement && (<SplashScreenComponent {...splashScreenProps}/>)}
    </div>);
}
export default App;
