/** ANSI escape code helpers and box-drawing utilities. Zero dependencies. */

export const ansi = {
  reset:       "\x1b[0m",
  bold:        "\x1b[1m",
  dim:         "\x1b[2m",
  green:       "\x1b[32m",
  red:         "\x1b[31m",
  yellow:      "\x1b[33m",
  cyan:        "\x1b[36m",
  blue:        "\x1b[34m",
  gray:        "\x1b[90m",
  white:       "\x1b[97m",
  clearScreen: "\x1b[2J\x1b[H",
  hideCursor:  "\x1b[?25l",
  showCursor:  "\x1b[?25h",
};

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function visibleLen(s: string): number {
  return stripAnsi(s).length;
}

/** Pad to a visible character width, accounting for embedded ANSI codes. */
export function padEnd(s: string, width: number): string {
  const gap = width - visibleLen(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/** Truncate to a visible character width, adding "…" if cut. */
export function truncate(s: string, width: number, ellipsis = "…"): string {
  const plain = stripAnsi(s);
  if (plain.length <= width) return s;
  return plain.slice(0, width - ellipsis.length) + ellipsis;
}

export interface BoxOptions {
  width: number;
  title?: string;
}

const H = "═";
const V = "║";

function centerTitle(title: string, inner: number, styled: string): string {
  const raw = stripAnsi(styled);
  const pad = inner - raw.length;
  const left  = Math.floor(pad / 2);
  const right = pad - left;
  return H.repeat(left) + styled + H.repeat(right);
}

export function boxTop(opts: BoxOptions): string {
  const inner = opts.width - 2;
  if (opts.title) {
    const styled = ` ${ansi.bold}${ansi.cyan}${opts.title}${ansi.reset} `;
    return `╔${centerTitle(opts.title + "  ", inner, styled)}╗`;
  }
  return `╔${H.repeat(inner)}╗`;
}

export function boxDivider(width: number, title?: string): string {
  const inner = width - 2;
  if (title) {
    const styled = ` ${ansi.dim}${title}${ansi.reset} `;
    return `╠${centerTitle(title + "  ", inner, styled)}╣`;
  }
  return `╠${H.repeat(inner)}╣`;
}

/** One content row inside the box. Content is padded or truncated to fit. */
export function boxRow(content: string, width: number): string {
  const inner = width - 6; // 2 border + 2 spaces each side
  const fitted = padEnd(truncate(content, inner), inner);
  return `${V}  ${fitted}  ${V}`;
}

export function boxBottom(width: number, footer?: string): string {
  const inner = width - 2;
  if (footer) {
    const styled = ` ${ansi.dim}${footer}${ansi.reset} `;
    return `╚${centerTitle(footer + "  ", inner, styled)}╝`;
  }
  return `╚${H.repeat(inner)}╝`;
}
