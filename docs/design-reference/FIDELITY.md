# Design Fidelity Ledger

The concept images in this directory guided the visual direction. The corresponding production-JAR captures are in [`../screenshots/`](../screenshots/).

| Comparison point | Concept intent | Implemented result |
| --- | --- | --- |
| Public navigation | White top bar, compact blue brand mark, active Products state, cart count, authentication links | Preserved on desktop; mobile replaces the link row with an accessible menu button while retaining a separate cart shortcut. |
| Product hierarchy | Product identity first, followed by price, stock, weight, and a strong blue action | Preserved with semantic headings and definition lists. Live stock state controls the indicator and whether Add to cart is available. |
| Search and stock filter | One clear search control plus an in-stock toggle | Preserved. Search supports case-insensitive partial ID or name matching; the toggle is keyboard accessible and defaults to showing the full catalog. |
| Desktop density | Full-width, single-row product cards with aligned facts | Preserved at wide breakpoints with a 1200 px content limit, consistent dividers, and stable action placement. |
| Mobile adaptation | Compact header and stacked product cards with full-width actions | Preserved at a native 390 px test viewport. Facts reflow without horizontal overflow and navigation remains available through the menu drawer. |
| Admin information architecture | Persistent sidebar, six summary metrics, recent orders, and a low-stock panel | Preserved. Values come from authenticated APIs; the low-stock list and badges use the threshold returned by the backend configuration. |
| Visual system | Cool neutral page, white surfaces, restrained borders, blue primary actions, green stock signals | Preserved through shared CSS tokens, consistent radii, spacing, status colors, and visible focus treatments. |
| Functional realism | Concepts communicate layout rather than complete behavior | The running UI adds loading, empty, error, validation, confirmation, toast, role-guard, and disabled states without introducing decorative or non-functional controls. |

The final captures were reviewed at 1440 x 900 and 390 x 844. The mobile document width matched its viewport, with no horizontal overflow.
