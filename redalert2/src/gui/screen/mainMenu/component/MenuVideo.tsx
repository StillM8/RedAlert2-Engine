import React from "react";
import { BinkCanvasPlayer, isBinkSource } from "../../../../engine/gameRes/BinkDecoder";

const mimeTypeMap = new Map([
    ["mp4", "video/mp4"],
    ["webm", "video/webm"],
]);

interface MenuVideoProps {
    src: string | File | undefined;
}

interface MenuVideoState {}

export class MenuVideo extends React.Component<MenuVideoProps, MenuVideoState> {
    private el: HTMLDivElement | null = null;
    private videoUrl?: string;
    private readonly binkPlayer = new BinkCanvasPlayer();

    render() {
        const src = this.props.src;
        if (!src) {
            // An empty <video> element renders a browser-specific gray media
            // surface/play button in Android WebView. Profiles without a menu
            // video (for example Mental Omega) leave the shell artwork clear.
            return React.createElement("div", {
                className: "video-wrapper",
                ref: (ref) => (this.el = ref as HTMLDivElement),
                style: { display: "none" },
            });
        }
        if (isBinkSource(src)) {
            return React.createElement(
                "div",
                {
                    className: "video-wrapper",
                    ref: (ref) => (this.el = ref as HTMLDivElement),
                },
                React.createElement("canvas", {
                    style: {
                        display: "block",
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        pointerEvents: "none",
                    },
                }),
            );
        }

        const url = typeof src === "string" ? src : this.videoUrl ?? "";
        const extension = typeof src === "string"
            ? src.split("?")[0].split(".").pop()?.toLowerCase()
            : src.name.split(".").pop()?.toLowerCase();
        const mimeType = typeof src === "string"
            ? mimeTypeMap.get(extension ?? "") ?? "video/webm"
            : src.type || mimeTypeMap.get(extension ?? "") || "video/webm";
        return React.createElement(
            "div",
            {
                className: "video-wrapper",
                ref: (ref) => (this.el = ref as HTMLDivElement),
            },
            React.createElement(
                "video",
                {
                    style: { outline: "none", width: "100%", height: "100%", objectFit: "cover" },
                    loop: true,
                    playsInline: true,
                    muted: true,
                    autoPlay: true,
                    preload: "auto",
                },
                React.createElement("source", { src: url, type: mimeType }),
            ),
        );
    }

    componentDidMount() {
        this.loadVideoSource();
    }

    componentDidUpdate(prevProps: MenuVideoProps) {
        if (prevProps.src !== this.props.src) {
            this.loadVideoSource();
        }
    }

    private revokeVideoUrl(): void {
        if (this.videoUrl) {
            URL.revokeObjectURL(this.videoUrl);
            this.videoUrl = undefined;
        }
    }

    private loadVideoSource(): void {
        const src = this.props.src;
        this.binkPlayer.stop();
        this.revokeVideoUrl();
        if (!src) {
            console.warn("[MenuVideo] No menu video source was provided");
            return;
        }
        if (isBinkSource(src)) {
            const canvas = this.el?.querySelector("canvas");
            if (!canvas) {
                console.warn("[MenuVideo] Bink canvas was not created");
                return;
            }
            void this.binkPlayer.start(src, canvas).catch((error) => {
                console.error("[MenuVideo] Bink playback failed", error);
            });
            return;
        }

        const video = this.el?.querySelector("video");
        const source = video?.querySelector("source");
        if (!video || !source) {
            console.warn("[MenuVideo] Video element was not created");
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
            console.error("[MenuVideo] Video error:", {
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
                    console.warn("[MenuVideo] Autoplay was rejected; retrying after the first interaction", error);
                    const retry = () => {
                        void video.play().catch((retryError) => console.warn("[MenuVideo] Menu video play failed", retryError));
                    };
                    document.addEventListener("pointerdown", retry, { once: true });
                }
            });
        };
        video.addEventListener("canplay", playWhenReady, { once: true });
        playWhenReady();
    }

    componentWillUnmount() {
        this.binkPlayer.stop();
        this.revokeVideoUrl();
    }
}
