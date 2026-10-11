// Column rules for the read-only label/value grids on Faculty Details (every tab). One definition so all tabs break
// into columns at the same widths.
//
// The breakpoints are CONTAINER queries (`@sm:` etc. - the width of the nearest `@container` ancestor), NOT window
// queries (`sm:`). Window breakpoints ignore the sidebar, the card padding and the tab/split-view the page is shown in,
// so a block only ~600px wide in a 1000px window was still cut into four ~140px columns and long values ran together.
// Here the column count follows the space the grid really has: about 160-220px per column.
//
// Each grid is wrapped in its own `@container` element (see ContainerGrid use sites) so it works wherever the view is
// rendered. The strings are written out in full on purpose: Tailwind only generates classes it can find as plain text.

/** 1 column below ~320px, then 2 from 320px, 3 from ~672px, 4 from ~896px. */
export const FACT_GRID_COLS_4 = "grid-cols-1 @xs:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4";
/** As above, plus a 5th column from ~1152px. */
export const FACT_GRID_COLS_5 = "grid-cols-1 @xs:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5";
/** At most 3 columns: 1 below ~320px, 2 from 320px, 3 from ~672px. */
export const FACT_GRID_COLS_3 = "grid-cols-1 @xs:grid-cols-2 @2xl:grid-cols-3";
/** At most 2 columns: 1 column until ~512px. */
export const FACT_GRID_COLS_2 = "grid-cols-1 @lg:grid-cols-2";
