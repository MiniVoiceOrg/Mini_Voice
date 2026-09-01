import type { SupportedLanguage, TranslationKey } from '../i18n';

/** A single slide in an in-app tutorial. */
export interface TutorialStep {
  /** i18n key for the step title. */
  title: TranslationKey;
  /** i18n key for the step body (may contain lightweight HTML). */
  content: TranslationKey;
  /** Optional tip/callout shown below the main content. */
  tip?: TranslationKey;
  /**
   * Optional illustration, as the URL that Vite gives back for an imported
   * asset (`import shot from '../assets/tutorials/x.png'`).
   *
   * A plain string is used in every language — right for a screenshot of a
   * third-party product, whose UI does not follow the app's language. Pass a
   * map instead when the picture itself contains Monky's own text, which is
   * translated; the viewer falls back to Portuguese when a language is
   * missing, the same way `t()` does.
   *
   * Steps without one keep the "illustration coming soon" box, so a tutorial
   * can be shipped before its screenshots exist and gain them later without
   * any change to this file's consumers (#496).
   */
  image?: string | Partial<Record<SupportedLanguage, string>>;
  /**
   * i18n key describing the illustration for screen readers. Falls back to the
   * step title, which is already a description of what the image shows.
   */
  imageAlt?: TranslationKey;
}

/** Full definition of a step-by-step tutorial rendered by `TutorialViewer`. */
export interface TutorialDefinition {
  /** Unique slug, e.g. 'radmin-vpn', 'port-forward'. */
  id: string;
  /** i18n key for the tutorial name shown in the header. */
  name: TranslationKey;
  /** Material Symbols icon name or emoji. */
  icon: string;
  /** Ordered list of steps. */
  steps: TutorialStep[];
}
