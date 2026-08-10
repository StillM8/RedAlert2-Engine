import React, { useEffect, useRef, useState, MutableRefObject } from 'react';
export interface SplashScreenProps {
    width: number;
    height: number;
    parentElement: HTMLElement | null;
    backgroundImage?: string;
    loadingText?: string;
    copyrightText?: string;
    disclaimerText?: string;
    onRender?: () => void;
}
const SplashScreen: React.FC<SplashScreenProps> = ({ width, height, parentElement, backgroundImage, loadingText, copyrightText, disclaimerText, onRender, }) => {
    const [rendered, setRendered] = useState(false);
    const elRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>;
    const backgroundElRef = useRef<HTMLImageElement | null>(null) as MutableRefObject<HTMLImageElement | null>;
    const loadingElRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>;
    const copyrightElRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>;
    const disclaimerElRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>;
    useEffect(() => {
        if (parentElement && !rendered) {
            const div = document.createElement('div');
            elRef.current = div;
            div.style.backgroundColor = 'black';
            div.style.color = 'white';
            div.style.padding = '10px';
            div.style.boxSizing = 'border-box';
            div.style.backgroundRepeat = 'no-repeat';
            div.style.backgroundPosition = '50% 50%';
            div.style.backgroundSize = 'cover';
            div.style.textShadow = '1px 1px black';
            div.style.position = 'relative';
            const backgroundImg = document.createElement('img');
            backgroundElRef.current = backgroundImg;
            backgroundImg.alt = '';
            backgroundImg.draggable = false;
            backgroundImg.style.position = 'absolute';
            backgroundImg.style.inset = '0';
            backgroundImg.style.width = '100%';
            backgroundImg.style.height = '100%';
            backgroundImg.style.objectFit = 'cover';
            backgroundImg.style.pointerEvents = 'none';
            backgroundImg.style.zIndex = '0';
            div.appendChild(backgroundImg);
            const loadingDiv = document.createElement('div');
            loadingElRef.current = loadingDiv;
            loadingDiv.style.position = 'relative';
            loadingDiv.style.zIndex = '1';
            div.appendChild(loadingDiv);
            const copyrightDiv = document.createElement('div');
            copyrightDiv.style.position = 'absolute';
            copyrightDiv.style.bottom = '10px';
            copyrightDiv.style.right = '10px';
            copyrightDiv.style.textAlign = 'right';
            copyrightElRef.current = copyrightDiv;
            div.appendChild(copyrightDiv);
            const disclaimerDiv = document.createElement('div');
            disclaimerDiv.style.position = 'absolute';
            disclaimerDiv.style.bottom = '10px';
            disclaimerDiv.style.left = '10px';
            disclaimerElRef.current = disclaimerDiv;
            div.appendChild(disclaimerDiv);
            parentElement.appendChild(div);
            setRendered(true);
            if (onRender) {
                onRender();
            }
        }
    }, [parentElement, rendered, onRender]);
    useEffect(() => {
        if (elRef.current) {
            elRef.current.style.width = `${width}px`;
            elRef.current.style.height = `${height}px`;
        }
    }, [width, height]);
    useEffect(() => {
        if (elRef.current) {
            if (backgroundImage === "") {
                elRef.current.style.backgroundImage = 'none';
                backgroundElRef.current?.removeAttribute('src');
            }
            else if (backgroundImage) {
                elRef.current.style.backgroundImage = `url(${backgroundImage})`;
                if (backgroundElRef.current) {
                    backgroundElRef.current.src = new URL(backgroundImage, window.location.href).href;
                }
            }
        }
    }, [backgroundImage]);
    useEffect(() => {
        if (loadingElRef.current && loadingText !== undefined) {
            console.log('[SplashScreen] Setting loadingText to:', loadingText);
            loadingElRef.current.innerHTML = loadingText;
        }
    }, [loadingText]);
    useEffect(() => {
        if (copyrightElRef.current && copyrightText !== undefined) {
            copyrightElRef.current.innerHTML = copyrightText.replace(/\n/g, '<br />');
        }
    }, [copyrightText]);
    useEffect(() => {
        if (disclaimerElRef.current && disclaimerText !== undefined) {
            disclaimerElRef.current.innerHTML = disclaimerText.replace(/\n/g, '<br />');
        }
    }, [disclaimerText]);
    useEffect(() => {
        return () => {
            if (elRef.current && elRef.current.parentElement) {
                elRef.current.parentElement.removeChild(elRef.current);
            }
            setRendered(false);
        };
    }, []);
    return null;
};
export default SplashScreen;
