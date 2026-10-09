import { createContext } from "react";

/** Actual workspace mode, including legacy saved canvases and previews. */
export const RegisterZoomFitContext = createContext<(standard: boolean) => void>(() => {});
