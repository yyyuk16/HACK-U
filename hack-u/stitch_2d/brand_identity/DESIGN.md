---
name: Brand Identity
colors:
  surface: '#f8f9ff'
  surface-dim: '#cfdbef'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dde9fe'
  surface-container-highest: '#d8e3f8'
  on-surface: '#111c2b'
  on-surface-variant: '#40484d'
  inverse-surface: '#263141'
  inverse-on-surface: '#ebf1ff'
  outline: '#70787e'
  outline-variant: '#c0c7ce'
  surface-tint: '#1d6584'
  primary: '#1d6584'
  on-primary: '#ffffff'
  primary-container: '#8ecdf0'
  on-primary-container: '#015876'
  inverse-primary: '#90cff2'
  secondary: '#8a4d4e'
  on-secondary: '#ffffff'
  secondary-container: '#feafaf'
  on-secondary-container: '#7a3f41'
  tertiary: '#645d53'
  on-tertiary: '#ffffff'
  tertiary-container: '#cdc4b8'
  on-tertiary-container: '#575147'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c2e8ff'
  primary-fixed-dim: '#90cff2'
  on-primary-fixed: '#001e2c'
  on-primary-fixed-variant: '#004d68'
  secondary-fixed: '#ffdad9'
  secondary-fixed-dim: '#ffb3b3'
  on-secondary-fixed: '#380b0f'
  on-secondary-fixed-variant: '#6e3637'
  tertiary-fixed: '#ebe1d4'
  tertiary-fixed-dim: '#cec5b9'
  on-tertiary-fixed: '#1f1b13'
  on-tertiary-fixed-variant: '#4c463d'
  background: '#f8f9ff'
  on-background: '#111c2b'
  surface-variant: '#d8e3f8'
typography:
  display-lg:
    fontFamily: DotGothic16
    fontSize: 40px
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: 0.05em
  headline-md:
    fontFamily: DotGothic16
    fontSize: 24px
    fontWeight: '400'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Zen Maru Gothic
    fontSize: 18px
    fontWeight: '500'
    lineHeight: '1.6'
  body-md:
    fontFamily: Zen Maru Gothic
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  label-sm:
    fontFamily: DotGothic16
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.0'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin: 24px
---

## Brand & Style

This design system blends the nostalgic charm of **2D Pixel Art** with a **Soft Modern** aesthetic. It is designed to evoke a sense of digital warmth, community, and "digital craftsmanship." The interface should feel like a cozy, high-fidelity handheld game—approachable and tactile, yet clean enough for modern utility.

The core design style is a hybrid of **Retro-Brutalism** (thick borders, hard shadows) and **Pastel Minimalism**. It emphasizes clear boundaries through bold outlines while maintaining a friendly atmosphere through a soft, desaturated color palette. Every interaction should feel intentional and "clickable," mimicking the physical feedback of classic gaming hardware.

## Colors

The palette is built on a high-contrast relationship between soft pastel surfaces and a rigid dark navy structure. 

- **Main (Pastel Blue):** Used for primary actions, active states, and key highlights. It represents the "modern" side of the soft-modern aesthetic.
- **Accent (Salmon Pink):** Reserved for secondary interactions, notifications, and "delight" elements.
- **Base (Beige):** The foundational canvas. This off-white, warm tone reduces eye strain compared to pure white and reinforces the retro, paper-like feel.
- **Text/Border (Dark Navy):** The structural anchor. Used for all outlines, primary text, and hard shadows to provide maximum legibility and a comic-book-like clarity.

## Typography

This design system utilizes a dual-font strategy to balance character with readability.

1.  **DotGothic16 (Headlines & Labels):** Used for all major titles, button labels, and small "pixel-perfect" metadata. This reinforces the 2D dot-art concept and provides a distinct retro flavor.
2.  **Zen Maru Gothic (Body & Content):** A rounded sans-serif used for long-form text and UI descriptions. Its soft terminals harmonize with the 16px corner radius and ensure the interface remains accessible and modern.

Avoid using DotGothic16 for body text to maintain legibility. Use all-caps sparingly for labels to emphasize the "game UI" feel.

## Layout & Spacing

The layout philosophy follows a **fixed-step grid** based on 4px and 8px increments, echoing the "pixel" nature of the design. 

Elements should be arranged with generous internal padding to maintain the "soft" aspect of the brand. While the borders are heavy, the space *between* components should feel airy. Use a 12-column grid for desktop layouts, but maintain 24px side margins to keep content centered and focused. Components should prioritize vertical stacking to mimic classic game menus.

## Elevation & Depth

Depth is conveyed through **Hard Shadows (Hard-Edge Offsets)** rather than blurs. This system rejects the concept of "light and air" in favor of "ink and paper."

- **Shadow Style:** Use a solid `#2F3A4A` fill for shadows. 
- **Offset:** Default elevation uses a `4px` offset to the bottom-right.
- **Active State:** When a component is "pressed," the shadow offset reduces to `0px` or `1px`, and the element translates position to simulate physical movement.
- **Tonal Layering:** Use the Base (Beige) for the lowest layer, and Surface (White) for cards that sit "above" the background, always contained within a thick 2px navy border.

## Shapes

The shape language is characterized by **"Softened Geometry."**

- **Corner Radius:** A consistent `16px` (rounded-lg) is applied to all cards, buttons, and input fields. This softens the aggressive nature of the thick navy outlines.
- **Borders:** Every container must have a Dark Navy border. Use `2px` for smaller components (chips, inputs) and `4px` for primary containers and buttons.
- **Pixel Decorations:** UI sections can be punctuated with 1:1 pixel-ratio ornaments (e.g., a 2x2 pixel square "corner accent") in the corners of containers to reinforce the 2D dot theme.

## Components

### Buttons
Primary buttons use the Pastel Blue background with a 4px Dark Navy border and a 4px solid Navy shadow. On hover, the shadow may expand slightly; on click, the button shifts down and right by 3px to "cover" the shadow, creating a tactile push-button effect.

### Cards
Cards use a White surface with a 2px Dark Navy border and a 16px corner radius. Include a 4px hard shadow to lift them from the Beige background. Header areas within cards should be separated by a 2px horizontal Navy line.

### Input Fields
Inputs use a White background with a 2px Navy border. The focus state changes the border to 4px or adds a Pastel Blue subtle inner "glow" (a solid 2px offset line).

### Chips & Badges
Small capsules with a 2px Navy border. Use the Salmon Pink for "new" or "alert" badges and Pastel Blue for general categories. Labels within chips must use DotGothic16.

### Pixel Ornaments
Use small 8-bit style icons or "dithered" patterns (stippling) for divider lines to add texture without cluttering the interface.