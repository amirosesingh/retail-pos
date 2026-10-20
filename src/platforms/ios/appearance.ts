import { registerPlugin, SystemBars, SystemBarsStyle } from "@capacitor/core";

const appearance = registerPlugin<{ setAppearance(options: { dark: boolean }): Promise<void> }>(
  "RetailOtaTrust",
);

/** UIKit owns the safe-area frame; theme changes only update native chrome. */
export function syncIosAppearance() {
  let previous: boolean | undefined;
  const update = () => {
    const root = document.documentElement;
    const dark = root.classList.contains("dark") || root.style.colorScheme === "dark";
    if (dark === previous) return;
    previous = dark;
    // Older native beta builds lack setAppearance; an OTA must still boot there.
    void appearance.setAppearance({ dark }).catch(() => {});
    void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(
      () => {},
    );
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}
