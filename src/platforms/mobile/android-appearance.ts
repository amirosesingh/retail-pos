import { registerPlugin } from "@capacitor/core";

const appearance = registerPlugin<{ setAppearance(options: { dark: boolean }): Promise<void> }>(
  "PosAppearance",
);

export function syncAndroidAppearance() {
  let previous: boolean | undefined;
  const update = () => {
    const root = document.documentElement;
    const dark = root.classList.contains("dark") || root.style.colorScheme === "dark";
    if (dark === previous) return;
    previous = dark;
    // An older APK can still render the app if the optional bridge is absent.
    void appearance.setAppearance({ dark }).catch(() => {});
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}
