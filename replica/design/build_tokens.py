#!/usr/bin/env python3
"""Génère tokens.css et tailwind.tokens.ts à partir de tokens.json (bibliothèque standard seulement).

    python3 replica/design/build_tokens.py

tokens.json est la source de vérité. Ne modifier ni tokens.css ni tailwind.tokens.ts à la main :
replica-brand change les valeurs dans tokens.json, puis on relance ce script.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# Noms Tailwind : text -> ink, text-muted -> muted (évite "text-text-muted").
TW_COLOR = {"text": "ink", "text-muted": "muted"}


def main():
    with open(os.path.join(HERE, "tokens.json"), encoding="utf-8") as f:
        t = json.load(f)

    css = ["/* GÉNÉRÉ par build_tokens.py depuis tokens.json. Ne pas modifier à la main. */", ":root {"]
    for k, v in t["color"].items():
        css.append("  --color-%s: %s;" % (k, v))
    css.append("  --font-sans: %s;" % t["font"]["sans"])
    css.append("  --font-mono: %s;" % t["font"]["mono"])
    for k, v in t["type"].items():
        css.append("  --text-%s-size: %dpx;" % (k, v["size"]))
        css.append("  --text-%s-line: %dpx;" % (k, v["line"]))
        css.append("  --text-%s-weight: %d;" % (k, v["weight"]))
    for px in t["space"]:
        css.append("  --space-%d: %dpx;" % (px, px))
    for k, v in t["radius"].items():
        css.append("  --radius-%s: %dpx;" % (k, v))
    for k, v in t["shadow"].items():
        css.append("  --shadow-%s: %s;" % (k, v))
    for k, v in t["motion"].items():
        css.append("  --motion-%s: %s;" % (k, v))
    for k, v in t["size"].items():
        css.append("  --size-%s: %dpx;" % (k, v))
    lay = t["layout"]
    css.append("  --layout-page-padding: %dpx;" % lay["page-padding"])
    css.append("  --layout-grid-gap: %dpx;" % lay["grid-gap"])
    css.append("  --layout-card-ratio: %s;" % lay["card-ratio"])
    css.append("  --layout-content-max: %dpx;" % lay["content-max"])
    css.append("  --layout-narrow-max: %dpx;" % lay["narrow-max"])
    for k, v in t["z"].items():
        css.append("  --z-%s: %d;" % (k, v))
    css.append("}")
    css.append("")
    css.append("@media (prefers-reduced-motion: reduce) {")
    css.append("  :root { --motion-fast: 0.01ms; --motion-base: 0.01ms; }")
    css.append("}")
    css.append("")
    css.append("html { font-family: var(--font-sans); color: var(--color-text); background: var(--color-bg); }")
    css.append(":focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }")
    with open(os.path.join(HERE, "tokens.css"), "w", encoding="utf-8") as f:
        f.write("\n".join(css) + "\n")

    bp = lay["breakpoint"]
    ts = []
    ts.append("// GÉNÉRÉ par build_tokens.py depuis tokens.json. Ne pas modifier à la main.")
    ts.append("// Usage : theme: { extend: tokens } dans tailwind.config.ts. Classes : bg-surface, text-muted, text-ink, border-border.")
    ts.append("export const tokens = {")
    ts.append("  colors: {")
    for k in t["color"]:
        ts.append("    '%s': 'var(--color-%s)'," % (TW_COLOR.get(k, k), k))
    ts.append("  },")
    ts.append("  spacing: {")
    for px in t["space"]:
        ts.append("    '%s': 'var(--space-%d)'," % (str(px / 4).rstrip("0").rstrip("."), px))
    ts.append("  },")
    ts.append("  borderRadius: {")
    for k in t["radius"]:
        ts.append("    '%s': 'var(--radius-%s)'," % (k, k))
    ts.append("  },")
    ts.append("  boxShadow: {")
    for k in t["shadow"]:
        ts.append("    '%s': 'var(--shadow-%s)'," % (k, k))
    ts.append("  },")
    ts.append("  fontSize: {")
    for k in t["type"]:
        ts.append("    '%s': ['var(--text-%s-size)', { lineHeight: 'var(--text-%s-line)', fontWeight: 'var(--text-%s-weight)' }],"
                  % (k, k, k, k))
    ts.append("  },")
    ts.append("  fontFamily: { sans: ['var(--font-sans)'], mono: ['var(--font-mono)'] },")
    ts.append("  screens: { sm: '%dpx', md: '%dpx', lg: '%dpx' }," % (bp["sm"], bp["md"], bp["lg"]))
    ts.append("  transitionDuration: { fast: 'var(--motion-fast)', base: 'var(--motion-base)' },")
    ts.append("  zIndex: { appbar: 'var(--z-appbar)', tabbar: 'var(--z-tabbar)', sheet: 'var(--z-sheet)', toast: 'var(--z-toast)' },")
    ts.append("} as const;")
    with open(os.path.join(HERE, "tailwind.tokens.ts"), "w", encoding="utf-8") as f:
        f.write("\n".join(ts) + "\n")
    print("ok: tokens.css, tailwind.tokens.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
