import { registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";

const appearance = registerPlugin<{ setAppearance(options: { dark: boolean; background?: number[] }): Promise<void> }>(
  "RetailOtaTrust",
);

/** UIKit owns the safe-area frame; theme changes only update native chrome. */
export function syncIosAppearance() {
  let previous: string | undefined;
  const update = () => {
    const root = document.documentElement;
    const dark = root.classList.contains("dark") || root.style.colorScheme === "dark";
    // Canvas resolves every supported CSS colour (including our OKLCH palettes)
    // into RGB for UIKit, avoiding visible systemBackground bands.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    let background: number[] | undefined;
    if (context) {
      context.fillStyle = getComputedStyle(root).getPropertyValue("--background").trim() || (dark ? "#09090b" : "#ffffff");
      context.fillRect(0, 0, 1, 1);
      background = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
    }
    const signature = JSON.stringify({ dark, background });
    if (signature === previous) return;
    previous = signature;
    // Older native beta builds lack setAppearance; an OTA must still boot there.
    void appearance.setAppearance({ dark, background }).catch(() => {});
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(
      () => {},
    );
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-pos-theme"],
  });
  return () => observer.disconnect();
}
