/**
 * Minimum window sizes (#342). The connection screen is a single narrow card,
 * so it keeps a small floor. Once a server is open the layout is rail +
 * channels + stage + members side by side, which needs a 16:9 box to stay
 * readable — 1024x576 is the smallest exact 16:9 that fits a 1280x720 display.
 */
export const HOME_MIN_WIDTH = 600;
export const HOME_MIN_HEIGHT = 500;

export const IN_SERVER_MIN_WIDTH = 1024;
export const IN_SERVER_MIN_HEIGHT = 576;
