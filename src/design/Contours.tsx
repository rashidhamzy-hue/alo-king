import { CONTOUR_D } from "./contours.generated";

/** Defines the Chouf contour lines once per page (an inline SVG is not a Largest Contentful Paint candidate; a CSS background image is). */
export function ContoursDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
      <defs>
        <symbol id="ak-contours" viewBox="0 0 1590 990" preserveAspectRatio="xMidYMid slice">
          <path
            d={CONTOUR_D}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </symbol>
      </defs>
    </svg>
  );
}

/** The quiet texture behind a section (DECISIONS §37.2). Put it first inside an element with the `ak-contours` class. */
export function Contours() {
  return (
    <svg
      className="ak-tex"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
    >
      <use href="#ak-contours" />
    </svg>
  );
}
