/**
 * ESC/POS command constants for thermal printers.
 * Used with RawBT Android intent-based printing.
 *
 * Target printer: TVS RP3160 Gold (80mm, 576-dot print head).
 * Font A (12×24) fits 48 chars on a clean 80mm configuration, but in
 * practice many TVS units print ~32 chars per line because of DIP-switch
 * state, RawBT "characters per line" setting, or partial-width printable
 * area. We therefore format receipts for 32 chars — fits every thermal
 * printer we've seen (58mm and 80mm) without mid-row wrapping.
 */

export const ESC = '\x1B';
export const GS = '\x1D';
export const CUT = GS + '\x56\x41\x00';

// Printer initialization — resets ALL modes (font, alignment, size, line spacing).
// Sent at the very start of every receipt so we don't inherit state from a
// previous print job (which is how things like "narrow column mode" leak in
// and produce one-word-per-line output on the TVS RP3160).
export const INIT = ESC + '\x40';                  // ESC @  (initialize)
export const SELECT_FONT_A = ESC + '\x4D\x00';     // ESC M 0  (Font A 12x24)
export const SELECT_FONT_B = ESC + '\x4D\x01';     // ESC M 1  (Font B 9x17)
export const LINE_SPACING_DEFAULT = ESC + '\x32';  // ESC 2  (default line spacing)
export const CHARSET_USA = ESC + '\x52\x00';       // ESC R 0  (USA character set)
export const CODEPAGE_PC437 = ESC + '\x74\x00';    // ESC t 0  (PC437 / standard)
export const CANCEL_USER_CHARS = ESC + '\x25\x00'; // ESC % 0  (use built-in font)
export const CHAR_SPACING_0 = ESC + '\x20\x00';    // ESC SP 0  (no extra char spacing)
export const LEFT_MARGIN_0 = GS + '\x4C\x00\x00';  // GS L 0    (no left margin)
// GS W nL nH — set print area width in dots. 576 = 0x40 0x02 (80mm TVS RP3160).
export const PRINT_AREA_80MM = GS + '\x57\x40\x02';

// Compound: full reset to a known clean Font A state with 80mm print area.
export const PRINTER_RESET =
    INIT + SELECT_FONT_A + LINE_SPACING_DEFAULT + CHARSET_USA + CODEPAGE_PC437
    + CANCEL_USER_CHARS + CHAR_SPACING_0 + LEFT_MARGIN_0 + PRINT_AREA_80MM;

// Text alignment
export const ALIGN_CENTER = ESC + '\x61\x01';
export const ALIGN_LEFT = ESC + '\x61\x00';
export const ALIGN_RIGHT = ESC + '\x61\x02';

// Text weight
export const BOLD_ON = ESC + '\x45\x01';
export const BOLD_OFF = ESC + '\x45\x00';

// Text size — SIZE_LARGE and SIZE_MEDIUM use double-width characters,
// so only WIDE_WIDTH chars fit per line when active.
export const SIZE_NORMAL = ESC + '\x21\x00';
export const SIZE_LARGE = ESC + '\x21\x30';   // double width + double height
export const SIZE_MEDIUM = ESC + '\x21\x10';   // double width only

// Line feed
export const LF = '\n';

// Target 32 characters per line — the width that reliably renders on every
// thermal printer / RawBT config we've seen (58mm, 80mm in 58mm mode, and
// 80mm in full mode). 80mm Font A could fit 48, but that has historically
// produced wrapped rows on partly-configured TVS RP3160 units — value
// jumping to the next line. 32 keeps the two-column layout on one row.
export const PAPER_WIDTH = 32;

// Double-width modes halve the chars per line
export const WIDE_WIDTH = Math.floor(PAPER_WIDTH / 2);

// Divider lines
export const DIVIDER = '='.repeat(PAPER_WIDTH);
export const DIVIDER_THIN = '-'.repeat(PAPER_WIDTH);

/**
 * Center text within a given column width (defaults to PAPER_WIDTH).
 */
export const center = (text: string, width: number = PAPER_WIDTH): string => {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(pad) + text;
};

/**
 * Two-column layout: left-aligned + right-aligned.
 * Pass `width = WIDE_WIDTH` when inside SIZE_MEDIUM or SIZE_LARGE blocks.
 */
export const twoCol = (left: string, right: string, width: number = PAPER_WIDTH): string => {
    const l = String(left  || '').trim();
    const r = String(right || '').trim();
    if (l.length + r.length + 1 > width) {
        // Value too long — put it on next line, right-aligned
        const indent = Math.max(0, width - r.length);
        return l + '\n' + ' '.repeat(indent) + r;
    }
    const gap = width - l.length - r.length;
    return l + ' '.repeat(Math.max(1, gap)) + r;
};

/**
 * Truncate text to maxLen characters, adding "..." if truncated.
 */
export const truncate = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
};
