---
name: Modern Security SaaS
colors:
  surface: '#f8f9ff'
  surface-dim: '#d0dbed'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dee9fc'
  surface-container-highest: '#d9e3f6'
  on-surface: '#121c2a'
  on-surface-variant: '#464554'
  inverse-surface: '#27313f'
  inverse-on-surface: '#eaf1ff'
  outline: '#767586'
  outline-variant: '#c7c4d7'
  surface-tint: '#494bd6'
  primary: '#4648d4'
  on-primary: '#ffffff'
  primary-container: '#6063ee'
  on-primary-container: '#fffbff'
  inverse-primary: '#c0c1ff'
  secondary: '#6b38d4'
  on-secondary: '#ffffff'
  secondary-container: '#8455ef'
  on-secondary-container: '#fffbff'
  tertiary: '#904900'
  on-tertiary: '#ffffff'
  tertiary-container: '#b55d00'
  on-tertiary-container: '#fffbff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e0ff'
  primary-fixed-dim: '#c0c1ff'
  on-primary-fixed: '#07006c'
  on-primary-fixed-variant: '#2f2ebe'
  secondary-fixed: '#e9ddff'
  secondary-fixed-dim: '#d0bcff'
  on-secondary-fixed: '#23005c'
  on-secondary-fixed-variant: '#5516be'
  tertiary-fixed: '#ffdcc5'
  tertiary-fixed-dim: '#ffb783'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#703700'
  background: '#f8f9ff'
  on-background: '#121c2a'
  surface-variant: '#d9e3f6'
  indigo-dark: '#4338ca'
  indigo-hover: '#4f46e5'
  gray-600: '#4b5563'
  gray-500: '#6b7280'
  gray-200: '#e5e7eb'
  gray-50: '#f9fafb'
  surface-white: '#ffffff'
  indigo-50: '#eef2ff'
  indigo-100: '#e0e7ff'
  success-text: '#047857'
  success-bg: '#ecfdf5'
  success-border: '#a7f3d0'
  warning-text: '#b45309'
  warning-bg: '#fffbeb'
  warning-border: '#fde68a'
  error-text: '#b91c1c'
  error-bg: '#fef2f2'
  error-border: '#fecaca'
typography:
  headline-1:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-2:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.015em
  headline-3:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  card-title:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  body-regular:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-secondary:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-compact:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  caption-badge:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.05em
  code-dense:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-xxs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 1.5rem
  space-2xl: 2rem
  space-3xl: 3rem
  gutter-mobile: 1rem
  gutter-desktop: 1.5rem
  container-max: 80rem
---

# Cryple Design System
The design system as cryple.io actually uses it, adapted for high-density productivity applications and web dashboards.

## Color Palette
- **Indigo (Brand/Primary)**: `#6366f1`
- **Indigo Dark (Accessible Text/Links)**: `#4338ca`
- **Indigo Hover**: `#4f46e5`
- **Violet (Gradient Stop)**: `#8b5cf6`
- **Gray 800 (Headings/Body)**: `#1f2937`
- **Gray 600 (Secondary Body)**: `#4b5563`
- **Gray 500 (Muted / Metadata)**: `#6b7280`
- **Gray 200 (Borders/Dividers)**: `#e5e7eb`
- **Gray 50 (Background / Card Fills)**: `#f9fafb`
- **White**: `#ffffff`
- **Indigo 50 (Tint / Selection)**: `#eef2ff`
- **Indigo 100 (Badge borders / Active pill)**: `#e0e7ff`

### Status Tokens (Accessible on light ground)
- **Success / Encrypted**: `#047857` (Badge bg: `#ecfdf5`, border: `#a7f3d0`)
- **Warning / Stored / Pending**: `#b45309` (Badge bg: `#fffbeb`, border: `#fde68a`)
- **Error**: `#b91c1c` (Badge bg: `#fef2f2`, border: `#fecaca`)

### Gradients
- **Action Gradient**: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)
- **Dark Security Gradient**: linear-gradient(135deg, #1f2937 0%, #374151 100%)

## Typography
- **Primary Font**: Inter, system-ui, -apple-system, sans-serif
- **Data/Monospace**: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
- **Scale**:
  - Headings: h1 28px/700, h2 22px/600, h3 18px/600, card h4 15px/600
  - Body: 14px-15px/400 regular, 13px/400 compact
  - Captions/Badges: 11px-12px/600 uppercase tracking-wider

## Shape and Depth
- **Buttons / Small Controls**: 8px (rounded-lg)
- **Containers / Modals / Cards**: 16px (rounded-2xl)
- **Pills / Badges**: 9999px (rounded-full)
- **Shadows**:
  - Subtle: `0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)`
  - Card/Floating: `0 10px 25px -5px rgba(99, 102, 241, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.05)`
  - Hover Lift: `0 20px 40px -10px rgba(0, 0, 0, 0.1)`
