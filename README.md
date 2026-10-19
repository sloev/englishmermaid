# Plainpath

Describe screens, layout and interactions in plain English and get a live
[Mermaid](https://mermaid.js.org) diagram behind your text.

**App:** https://sloev.github.io/englishmermaid/. It installs as an app and works
offline. Save and open `.plainpath` files, export SVG, PNG or Mermaid, or copy a
share link.

**AI agents:** see [`public/agents.md`](public/agents.md) (served at
`/agents.md`). In short, link people to `…/englishmermaid/#text=<url-encoded script>`.

```
Title: Shop
Screen: Products
  Show Header
    Show Logo, Search, Cart Icon
  For each product in products
    Show Product Card
  If cart is empty
    Show Empty Hint
  Else
    Show Checkout Button
  On tap Cart Icon go to Cart

Component: Product Card
  Show Image, Title, Price
  On tap Add go to Cart
```

| Line                                               | Meaning                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `Screen: Name` / `Popup: Name` / `Component: Name` | A page, a modal, or a reusable part. Indented lines belong to it.    |
| `Show A, B`                                        | Parts of the layout. Indent under a Show to nest.                    |
| `Text: …` / `Headline: …`                          | Words on the screen.                                                 |
| `Image: hero photo` / `Video: tour`                | A picture or video placeholder; `(square)` / `(tall)` for the shape. |
| `Button Buy goes to Cart`                          | A button and where it leads.                                         |
| `Choose roast flow:`                               | A select; one `Option: description [goes to X]` per indented line.   |
| `For each x in y`                                  | A repeated part. Children indented, or `… show Row` inline.          |
| `If …` / `Else if …` / `Else`                      | Choices. Children indented, or end with `go to X` / `show X`.        |
| `When they tap Buy go to Cart`                     | An event (also `On`, `After`). `If`/`Else` lines can go below.       |
| `Step: Weigh the beans`                            | Numbered steps in a screen; `go to next step` / `go to step 3`.      |
| `Go to X` / `Open X`                               | A link to another screen.                                            |
| `Loop … until … then go to X`                      | Wait or repeat, then move on.                                        |
| `Title:`, `Note:`, `//`                            | Diagram title and comments.                                          |

Two views: **Storyboard** (each screen with its layout) and **Flow** (only how
screens connect). The round button in the lower left, Esc or Ctrl/⌘+E switches
between the editor and the full-screen map (drag, scroll or pinch to zoom,
double-click to fit).

## Develop

```sh
npm install
npm run dev     # http://localhost:8080
npm test        # parser tests
npm run build   # static PWA in docs/ (served by GitHub Pages)
```
