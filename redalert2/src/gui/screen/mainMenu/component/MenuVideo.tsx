import React from "react";
const mimeTypeMap = new Map([
    ["mp4", "video/mp4"],
    ["webm", "video/webm"],
]);
interface MenuVideoProps {
    src: string | File | undefined;
}
interface MenuVideoState {
}
export class MenuVideo extends React.Component<MenuVideoProps, MenuVideoState> {
    private el: HTMLDivElement | null = null;
    private videoUrl?: string;
    render() {
        const src = this.props.src;
        let url: string;
        let mimeType: string;
        if (typeof src === "string") {
            url = src;
            mimeType = mimeTypeMap.get(src.split("?")[0].split(".").pop() ?? "") ?? "video/webm";
        }
        else if (src) {
            // The object URL is created once in componentDidMount/update. A
            // URL created during render leaks on every React render and can
            // leave the WebView with a stale media source.
            url = this.videoUrl ?? "";
            mimeType = src.type || mimeTypeMap.get(src.name.split(".").pop()?.toLowerCase() ?? "") || "video/webm";
    }
    else {
            // An empty <video> element renders a browser-specific gray media
            // surface/play button in Android WebView.  Profiles without a
            // menu video (for example Mental Omega, which uses its static
            // shell artwork) must leave the background sprite unobstructed.
            return React.createElement("div", {
                className: "video-wrapper",
                ref: (ref) => (this.el = ref as HTMLDivElement),
                style: { display: "none" },
            });
        }
        return React.createElement("div", {
            className: "video-wrapper",
            ref: (ref) => (this.el = ref as HTMLDivElement),
            dangerouslySetInnerHTML: {
                __html: `
          <video style="outline: none; width: 100%; height: 100%; object-fit: cover;" loop playsinline muted autoplay preload="auto">
              <source src="${url}" type="${mimeType}" />
          </video>
        `,
            },
        });
    }
    componentDidMount() {
        this.loadVideoSource();
    }
    componentDidUpdate(prevProps: MenuVideoProps) {
        if (prevProps.src !== this.props.src) {
            this.loadVideoSource();
        }
    }
    private loadVideoSource(): void {
        const src = this.props.src;
        const video = this.el?.querySelector("video");
        const source = video?.querySelector("source");
        if (!video || !source) {
            console.warn('[MenuVideo] Video element was not created');
            return;
        }
        if (this.videoUrl) {
            URL.revokeObjectURL(this.videoUrl);
            this.videoUrl = undefined;
        }
        if (!src) {
            source.removeAttribute("src");
            video.removeAttribute("src");
            video.load();
            console.warn('[MenuVideo] No menu video source was provided');
            return;
        }
        const url = typeof src === "string" ? src : URL.createObjectURL(src);
        this.videoUrl = typeof src === "string" ? undefined : url;
        const extension = typeof src === "string"
            ? src.split("?")[0].split(".").pop()?.toLowerCase()
            : src.name.split(".").pop()?.toLowerCase();
        const mimeType = (typeof src === "string" ? undefined : src.type) || mimeTypeMap.get(extension ?? "") || "video/webm";
        source.src = url;
        source.type = mimeType;
        video.muted = true;
        video.defaultMuted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.load();
        video.addEventListener("loadeddata", () => {
            console.log(`[MenuVideo] Video loaded successfully (${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(2)}s)`);
        }, { once: true });
        video.addEventListener("error", () => {
            const mediaError = video.error;
            console.error('[MenuVideo] Video error:', {
                code: mediaError?.code,
                message: mediaError?.message,
                networkState: video.networkState,
                readyState: video.readyState,
                source: url,
                mimeType,
            });
        }, { once: true });
        let interactionRetryRegistered = false;
        const playWhenReady = () => {
            void video.play().catch((error) => {
                if (!interactionRetryRegistered) {
                    interactionRetryRegistered = true;
                    console.warn('[MenuVideo] Autoplay was rejected; retrying after the first interaction', error);
                    const retry = () => {
                        void video.play().catch((retryError) => console.warn('[MenuVideo] Menu video play failed', retryError));
                    };
                    document.addEventListener("pointerdown", retry, { once: true });
                }
            });
        };
        // Setting the source after the element was created can make an
        // immediate play() call race media preparation on Android WebView.
        // Retry once the first frame is available so muted autoplay has a
        // chance to start without requiring a menu tap.
        video.addEventListener("canplay", playWhenReady, { once: true });
        playWhenReady();
    }
    componentWillUnmount() {
        if (this.videoUrl) {
            URL.revokeObjectURL(this.videoUrl);
            this.videoUrl = undefined;
        }
    }
}
