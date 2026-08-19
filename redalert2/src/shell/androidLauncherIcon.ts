/** Keep Android's launcher icon aligned with the selected runtime profile. */
export function syncAndroidLauncherIcon(runtimeProfile: string): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('platform') !== 'android') return;

    // ContentRegistry treats every non-RA2 runtime profile as YR-based.
    const profile = runtimeProfile === 'ra2' ? 'ra2' : 'yr';
    const link = document.createElement('a');
    link.href = `ra2launcher://${profile}`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
}
