/** Keep Android's launcher icon aligned with the selected base game. */
export function syncAndroidLauncherIcon(baseProfile: string): void {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('platform') !== 'android') return;

    const profile = baseProfile === 'yr' ? 'yr' : 'ra2';
    const link = document.createElement('a');
    link.href = `ra2launcher://${profile}`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
}
