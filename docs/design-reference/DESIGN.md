# Smart Inventory UI Design Reference

The three reference images in this directory define the visual direction for the React application. The application itself must use code-native React components, CSS Modules, accessible controls, Lucide icons, and real API data.

## Design tokens

- Page background: `#f6f8fb`
- Surface: `#ffffff`
- Primary text: `#172033`
- Muted text: `#647084`
- Border: `#d9e0e9`
- Accent: `#0969da`
- Accent hover: `#0759bb`
- Success: `#1f9d55`
- Warning: `#c57a00`
- Danger: `#c9362b`
- Radius: 10px for controls, 12px for surfaces
- Shadow: restrained, used only for elevated navigation/dialogs
- Content width: 1200px maximum
- Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Yu Gothic", "Hiragino Sans", sans-serif`

## Component model

- Public/customer pages use a quiet top navigation and open max-width content.
- Products use structured rows on desktop and compact cards on mobile.
- Admin pages use a desktop sidebar and mobile drawer; product management remains table-based.
- Forms, dialogs, toasts, empty states, loading skeletons, and errors share one restrained component family.
- Outline icons use Lucide React at consistent 18–24px sizes and roughly 2px stroke width.

## Responsive behavior

- Desktop reference: 1440px wide.
- Public navigation collapses below 760px.
- Admin sidebar becomes a drawer below 900px.
- Product rows become single-column cards below 720px.
- Admin tables may scroll inside their own container, but the page must not overflow horizontally.
- Touch targets are at least 44px and focus rings remain visible.

## Copy and content constraints

- No marketing hero, eyebrow labels, decorative badges, fake charts, fake dates, or invented metrics.
- Prices, stock, orders, and dashboard metrics come from API responses.
- Product imagery uses a consistent Package icon rather than unrelated stock photography.
- The mobile reference shows only layout treatment; API data remains authoritative where the generated concept differs.
